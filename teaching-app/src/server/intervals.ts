export type Interval = { lower: number; upper: number; lowerInclusive: boolean; upperInclusive: boolean }

function endpoint(raw: string) {
  const value = raw.trim().toLowerCase().replaceAll('−', '-')
  if (/^\+?\s*(?:∞|infinity|infty|inf)$/.test(value)) return Infinity
  if (/^-\s*(?:∞|infinity|infty|inf)$/.test(value)) return -Infinity
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))?$/.test(value)) throw new Error('Use numeric endpoints or fractions.')
  const parts = value.split('/').map((part) => Number(part.trim()))
  const number = parts.length === 2 ? parts[0] / parts[1] : parts[0]
  if (!Number.isFinite(number) || Math.abs(number) > 1e12) throw new Error('Invalid endpoint.')
  return number
}

function normalize(intervals: Interval[]) {
  const sorted = intervals.sort((a, b) => a.lower - b.lower || Number(b.lowerInclusive) - Number(a.lowerInclusive))
  const result: Interval[] = []
  for (const item of sorted) {
    const previous = result.at(-1)
    if (!previous || item.lower > previous.upper || (item.lower === previous.upper && !item.lowerInclusive && !previous.upperInclusive)) {
      result.push({ ...item })
    } else if (item.upper > previous.upper) {
      previous.upper = item.upper
      previous.upperInclusive = item.upperInclusive
    } else if (item.upper === previous.upper) previous.upperInclusive ||= item.upperInclusive
  }
  return result
}

function validInterval(lower: number, upper: number, lowerInclusive: boolean, upperInclusive: boolean): Interval {
  if (lower > upper || lower === Infinity || upper === -Infinity
    || (lower === upper && (!lowerInclusive || !upperInclusive))
    || (!Number.isFinite(lower) && lowerInclusive) || (!Number.isFinite(upper) && upperInclusive)) {
    throw new Error('Check endpoint order and brackets; infinity always uses parentheses.')
  }
  return { lower, upper, lowerInclusive, upperInclusive }
}

export function parseIntervals(answer: string) {
  const value = answer.trim().replaceAll('−', '-')
  if (['∅', 'empty', 'empty set'].includes(value.toLowerCase()) || /^\{\s*\}$/.test(value)) return []
  const parts = value.split(/\s*(?:∪|\bU\b|\bunion\b)\s*/i)
  if (!parts.length || parts.length > 20) throw new Error('Use interval notation.')
  return normalize(parts.flatMap((part) => {
    const point = /^\{([^{}]+)\}$/.exec(part.trim())
    if (point) {
      const points = point[1].split(',')
      if (points.length > 20) throw new Error('Use at most 20 points in a finite set.')
      return points.map((raw) => {
        const number = endpoint(raw)
        return validInterval(number, number, true, true)
      })
    }
    // Accept [3] as a student shorthand for the singleton {3}, not an open interval.
    const singleton = /^\[\s*([^,[\]]+)\s*\]$/.exec(part.trim())
    if (singleton) {
      const number = endpoint(singleton[1])
      return [validInterval(number, number, true, true)]
    }
    const match = /^(\(|\[)\s*([^,]+)\s*,\s*([^,]+)\s*(\)|\])$/.exec(part.trim())
    if (!match) throw new Error('Use intervals such as (-infinity, -2) U [3, infinity).')
    return [validInterval(endpoint(match[2]), endpoint(match[3]), match[1] === '[', match[4] === ']')]
  }))
}

export function readAnswerKey(value: unknown) {
  if (!Array.isArray(value)) throw new Error('An answer key needs an intervals array.')
  return normalize(value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.lower !== 'string' || typeof item.upper !== 'string'
      || typeof item.lowerInclusive !== 'boolean' || typeof item.upperInclusive !== 'boolean') throw new Error('Invalid answer key.')
    return validInterval(endpoint(item.lower), endpoint(item.upper), item.lowerInclusive, item.upperInclusive)
  }))
}

export function sameIntervals(left: Interval[], right: Interval[]) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return item.lower === other.lower && item.upper === other.upper
      && item.lowerInclusive === other.lowerInclusive && item.upperInclusive === other.upperInclusive
  })
}
