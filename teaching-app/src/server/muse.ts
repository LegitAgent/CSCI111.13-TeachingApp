import 'server-only'

export type ModelMessage = { role: 'developer' | 'assistant' | 'user'; content: string }

function responseError(code: string) {
  return Object.assign(new Error('Muse returned an incomplete or invalid response.'), { code })
}

function checkFinishReason(reason: unknown) {
  if (reason === 'stop') return
  if (reason === 'length') throw responseError('muse-token-limit')
  if (reason === 'content_filter') throw responseError('muse-content-filter')
  throw responseError('muse-unexpected-finish')
}

// Both the provider stream and our browser stream use newline-delimited frames.
export async function* readProviderText(body: ReadableStream<Uint8Array>, contentType = 'text/event-stream') {
  if (!contentType.includes('text/event-stream')) {
    await body.cancel()
    throw responseError('muse-unexpected-stream-type')
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  function parseLine(line: string): string | null {
    if (!line.startsWith('data:')) return null
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return null
    let chunk
    try { chunk = JSON.parse(payload) } catch { throw responseError('muse-invalid-stream-frame') }
    if (!chunk || chunk.error) throw responseError('muse-stream-error')
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason) {
      checkFinishReason(choice.finish_reason)
      finished = true
    }
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
        if (finished) return
      }
      if (done) break
      if (buffer.length > 64_000) throw responseError('muse-stream-frame-too-large')
    }
    if (buffer.trim()) {
      const text = parseLine(buffer.trim())
      if (text) yield text
    }
    if (!finished) throw responseError('muse-stream-closed-early')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
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
      if (!/^[0-9a-f]{4}$/i.test(hex)) throw responseError('muse-invalid-reply-escape')
      text += String.fromCharCode(parseInt(hex, 16))
      index += 4
    } else if (escaped in escapes) text += escapes[escaped]
    else throw responseError('muse-invalid-reply-escape')
  }
  return text
}

async function requestMuse(messages: ModelMessage[], signal: AbortSignal, schema: object, stream: boolean) {
  const apiKey = process.env.MUSE_CODE_API
  if (!apiKey) throw new Error('The tutor is not configured. Set MUSE_CODE_API on the server.')

  const response = await fetch('https://api.meta.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify({
      model: process.env.MUSE_MODEL || 'muse-spark-1.3',
      messages,
      stream,
      reasoning_effort: stream ? 'minimal' : 'low',
      max_completion_tokens: stream ? 2400 : 4000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'socratic_reply',
          strict: true,
          schema,
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
  return response
}

export async function streamMuse(messages: ModelMessage[], signal: AbortSignal, schema: object) {
  const response = await requestMuse(messages, signal, schema, true)
  return readProviderText(response.body!, response.headers.get('content-type') ?? '')
}

export async function completeMuse(messages: ModelMessage[], signal: AbortSignal, schema: object) {
  const response = await requestMuse(messages, signal, schema, false)
  let data
  try { data = await response.json() } catch { throw responseError('muse-invalid-completion') }
  const choice = data?.choices?.[0]
  checkFinishReason(choice?.finish_reason)
  const content = choice?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw responseError('muse-empty-completion')
  return content
}
