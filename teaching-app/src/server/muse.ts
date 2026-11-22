import 'server-only'

export type ModelMessage = { role: 'developer' | 'assistant' | 'user'; content: string }
export type Evaluation = { passed: boolean; evidence: string }

// Both the provider stream and our browser stream use newline-delimited frames.
export async function* readProviderText(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  function parseLine(line: string): string | null {
    if (!line.startsWith('data:')) return null
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return null
    const chunk = JSON.parse(payload)
    if (chunk.error) throw new Error('The AI service could not complete its response.')
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason === 'stop') finished = true
    else if (choice?.finish_reason) throw new Error('The AI response was incomplete. Please try again.')
    return typeof choice?.delta?.content === 'string' ? choice.delta.content : null
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const text = parseLine(buffer.slice(0, newline).replace(/\r$/, ''))
        buffer = buffer.slice(newline + 1)
        if (text) yield text
      }
      if (done) break
      if (buffer.length > 64_000) throw new Error('The AI response was invalid.')
    }
    if (buffer.trim()) {
      const text = parseLine(buffer.trim())
      if (text) yield text
    }
    if (!finished) throw new Error('The AI connection ended early. Please try again.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function parseEvaluation(line: string, answer: string): Evaluation {
  let value: unknown
  try { value = JSON.parse(line.trim()) } catch { throw new Error('The tutor could not evaluate this reply. Please try again.') }
  if (!value || typeof value !== 'object' || !('passed' in value) || typeof value.passed !== 'boolean'
    || !('evidence' in value) || typeof value.evidence !== 'string' || value.evidence.length > 300) {
    throw new Error('The tutor returned an invalid evaluation. Please try again.')
  }
  // A passing verdict must cite a literal excerpt from this student's answer.
  if (value.passed && (!value.evidence.trim() || !answer.toLowerCase().includes(value.evidence.trim().toLowerCase()))) {
    throw new Error('The tutor could not support its evaluation. Please try again.')
  }
  return { passed: value.passed, evidence: value.evidence }
}

// Decode just the reply string while the schema-constrained JSON is still arriving.
// Private evaluation fields are never forwarded to the browser.
export function readReplyPrefix(json: string) {
  const match = /"reply"\s*:\s*"/.exec(json)
  if (!match) return ''
  let text = ''
  const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
  for (let index = match.index + match[0].length; index < json.length; index++) {
    const character = json[index]
    if (character === '"') break
    if (character !== '\\') { text += character; continue }
    const escaped = json[++index]
    if (!escaped) break
    if (escaped === 'u') {
      const hex = json.slice(index + 1, index + 5)
      if (hex.length < 4) break
      if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error('The tutor returned an invalid response.')
      text += String.fromCharCode(parseInt(hex, 16))
      index += 4
    } else if (escaped in escapes) text += escapes[escaped]
    else throw new Error('The tutor returned an invalid response.')
  }
  return text
}

export async function streamMuse(messages: ModelMessage[], signal: AbortSignal) {
  const apiKey = process.env.MUSE_CODE_API
  if (!apiKey) throw new Error('The tutor is not configured. Set MUSE_CODE_API on the server.')

  const response = await fetch('https://api.meta.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model: process.env.MUSE_MODEL || 'muse-spark-1.3',
      messages,
      stream: true,
      reasoning_effort: 'low',
      max_completion_tokens: 1200,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'socratic_reply',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              reply: { type: 'string', description: 'Brief student-facing feedback, with one follow-up if not passed.' },
              passed: { type: 'boolean' },
              evidence: { type: 'string', description: 'A short literal excerpt from the newest answer supporting a pass; empty otherwise.' },
            },
            required: ['reply', 'passed', 'evidence'],
            additionalProperties: false,
          },
        },
      },
    }),
    signal,
    cache: 'no-store',
  })

  if (!response.ok || !response.body) {
    await response.body?.cancel()
    if (response.status === 429) throw new Error('The tutor is busy. Wait a moment and try again.')
    if (response.status === 401 || response.status === 403) throw new Error('The AI service rejected the server API key. Check the Muse API credentials.')
    if (response.status === 404) throw new Error('The configured Muse model is unavailable. Check MUSE_MODEL on the server.')
    throw new Error('The AI service is unavailable. Please try again.')
  }
  return readProviderText(response.body)
}
