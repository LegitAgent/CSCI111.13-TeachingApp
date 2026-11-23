export type MathPart = { type: 'text'; value: string } | { type: 'math'; value: string; display: boolean }

function escaped(text: string, index: number) {
  let slashes = 0
  while (index > 0 && text[--index] === '\\') slashes++
  return slashes % 2 === 1
}

export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = []
  let plainStart = 0
  let index = 0
  while (index < text.length) {
    const opening = !escaped(text, index) && ['\\(', '\\[', '$$', '$'].find((delimiter) => text.startsWith(delimiter, index))
    if (!opening) { index++; continue }
    const closing = opening === '\\(' ? '\\)' : opening === '\\[' ? '\\]' : opening
    const contentStart = index + opening.length
    let end = text.indexOf(closing, contentStart)
    while (end !== -1 && escaped(text, end)) end = text.indexOf(closing, end + closing.length)
    const content = end === -1 ? '' : text.slice(contentStart, end).trim()
    // Models sometimes put spaces inside $ ... $. Accept actual math while keeping
    // ordinary prices such as "$5 and $10" as text.
    const spacedMath = /\\[a-zA-Z]+|[=<>≤≥∈∪∩^_{}+*/]|^[a-zA-Z]$|^[+-]?\d+(?:\.\d+)?$/.test(content)
    if (end === -1 || !content
      || (opening === '$' && (/\s/.test(text[contentStart]) || /\s/.test(text[end - 1])) && !spacedMath)) {
      index += opening.length
      continue
    }
    if (index > plainStart) parts.push({ type: 'text', value: text.slice(plainStart, index) })
    parts.push({ type: 'math', value: content, display: opening === '\\[' || opening === '$$' })
    index = end + closing.length
    plainStart = index
  }
  if (plainStart < text.length) parts.push({ type: 'text', value: text.slice(plainStart) })
  return parts
}

export function toSpokenText(text: string) {
  let value = splitMath(text).map((part) => part.value).join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\\(?:dfrac|tfrac)/g, '\\frac')
  for (let pass = 0; pass < 12 && /\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/.test(value); pass++) {
    value = value.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1) divided by ($2)')
  }
  return value
    .replace(/\\mathbb\s*\{R\}/g, ' real numbers ')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'square root of ($1)')
    .replace(/\\(?:text|mathrm)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:begin|end)\{[^}]+\}(?:\{[clr|]+\})?/g, ' ')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\(?:geq|ge)(?![a-zA-Z])|≥|>=/g, ' greater than or equal to ')
    .replace(/\\(?:leq|le)(?![a-zA-Z])|≤|<=/g, ' less than or equal to ')
    .replace(/\\(?:neq|ne)(?![a-zA-Z])|≠|!=/g, ' not equal to ')
    .replace(/\\notin\b/g, ' does not belong to ')
    .replace(/\\in\b|∈/g, ' belongs to ')
    .replace(/\\(?:mid|vert)\b|\|/g, ' such that ')
    .replace(/\\infty\b|∞/g, ' infinity ')
    .replace(/\\cup\b|∪/g, ' union ')
    .replace(/\\cap\b|∩/g, ' intersection ')
    .replace(/\\(?:emptyset|varnothing)\b|∅/g, ' empty set ')
    .replace(/\\(?:times|cdot)\b|×/g, ' times ')
    .replace(/\\lt(?![a-zA-Z])|</g, ' less than ')
    .replace(/\\gt(?![a-zA-Z])|>/g, ' greater than ')
    .replace(/=/g, ' equals ')
    .replace(/−/g, ' minus ')
    .replace(/\^\{?2\}?|²/g, ' squared ')
    .replace(/\^\{?3\}?|³/g, ' cubed ')
    .replace(/\\[{}]|[{}]/g, ' ')
    .replace(/\\\\|&/g, ', ')
    .replace(/\\[,;! ]/g, ' ')
    .replace(/[*`#]/g, '')
    .replace(/\s+/g, ' ').trim()
}
