import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

async function sourceUrl(path, replacements = []) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  let compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  for (const name of ['react', 'react/jsx-runtime', 'katex']) {
    const url = JSON.stringify(import.meta.resolve(name))
    compiled = compiled.replaceAll("'" + name + "'", url).replaceAll('"' + name + '"', url)
  }
  return 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
}
const mathUrl = await sourceUrl('../src/lib/mathText.ts')
const { splitMath, toSpokenText } = await import(mathUrl)
const { default: MathText } = await import(await sourceUrl('../src/components/tutor/MathText.tsx',
  [["'@/lib/mathText'", JSON.stringify(mathUrl)]]))

test('math delimiters survive streamed partial formulas and do not mistake currency for math', () => {
  assert.deepEqual(splitMath(String.raw`Use \(\frac{x-1}{x+2}\ge0\) here.`), [
    { type: 'text', value: 'Use ' }, { type: 'math', value: String.raw`\frac{x-1}{x+2}\ge0`, display: false },
    { type: 'text', value: ' here.' },
  ])
  for (const text of [String.raw`Try \(\frac{x`, 'A $5 and $10 budget', String.raw`An escaped \$x$`]) {
    assert.deepEqual(splitMath(text), [{ type: 'text', value: text }])
  }
  assert.equal(splitMath(String.raw`\[x>0\]`)[0].display, true)
  assert.equal(splitMath('$$x>0$$')[0].display, true)
})

test('AI formulas render as accessible math while prose and unsafe TeX stay escaped', () => {
  const html = renderToStaticMarkup(createElement(MathText, { text: String.raw`<script>alert(1)</script> \(\frac{x-1}{x+2}\ge0\)` }))
  assert.ok(html.includes('katex-mathml'))
  assert.ok(html.includes('<mfrac>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
  const unsafe = renderToStaticMarkup(createElement(MathText, { text: String.raw`\(\href{javascript:alert(1)}{click}\)` }))
  assert.ok(!unsafe.includes('<a '))
  assert.ok(!unsafe.includes('href="javascript:'))
  assert.doesNotThrow(() => renderToStaticMarkup(createElement(MathText, { text: String.raw`\(\unknowncommand{x}\)` })))
})

test('read-aloud converts fractions, inequalities and sets without speaking TeX commands', () => {
  const spoken = toSpokenText(String.raw`Use \(\frac{x-1}{x+2}\ge0\), then \(\{x\in\mathbb{R}\mid x>2\}\).`)
  assert.ok(spoken.includes('(x-1) divided by (x+2) greater than or equal to 0'))
  assert.ok(spoken.includes('belongs to real numbers such that x greater than 2'))
  assert.ok(!spoken.includes('\\'))
})
