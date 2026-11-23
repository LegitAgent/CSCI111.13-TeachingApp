import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/readApiResponse.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const { readApiResponse } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('empty and HTML server failures show an actionable error instead of a JSON parsing exception', async () => {
  for (const body of ['', '<html>Function crashed</html>']) {
    await assert.rejects(readApiResponse(new Response(body, { status: 500 }), 'Dashboard unavailable'), /Dashboard unavailable \(HTTP 500\)/)
  }
  await assert.rejects(readApiResponse(new Response('{', { status: 502, headers: { 'content-type': 'application/json' } }), 'Dashboard unavailable'), /HTTP 502/)
})

test('valid JSON errors keep their sign-in guidance and successful dashboard data is returned', async () => {
  await assert.rejects(readApiResponse(Response.json({ error: 'Sign in again.' }, { status: 401 }), 'Dashboard unavailable'), { message: 'Sign in again.' })
  assert.deepEqual(await readApiResponse(Response.json({ lessons: [] }), 'Dashboard unavailable'), { lessons: [] })
})
