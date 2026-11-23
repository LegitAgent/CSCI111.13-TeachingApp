'use client'

import { memo, useMemo } from 'react'
import { renderToString } from 'katex'
import { splitMath } from '@/lib/mathText'

const Formula = memo(function Formula({ expression, display }: { expression: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      return renderToString(expression, {
        displayMode: display, throwOnError: false, trust: false,
        strict: 'ignore', maxExpand: 200, maxSize: 12, output: 'htmlAndMathml',
      })
    } catch { return null }
  }, [expression, display])
  if (html === null) return <span>{expression}</span>
  // Only KaTeX-generated markup is inserted. Surrounding text stays React-escaped.
  return <span className={display ? 'tutor-math-display' : 'tutor-math-inline'} dangerouslySetInnerHTML={{ __html: html }} />
})

export default function MathText({ text }: { text: string }) {
  return <span className="tutor-rich-text">{splitMath(text).map((part, index) => part.type === 'math'
    ? <Formula key={index} expression={part.value} display={part.display} />
    : <span key={index}>{part.value.split(/(\*\*[^*]+\*\*)/g).map((value, item) => value.startsWith('**') && value.endsWith('**')
      ? <strong key={item}>{value.slice(2, -2)}</strong> : value)}</span>)}</span>
}
