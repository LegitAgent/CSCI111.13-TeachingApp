import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/app/api/lessons/[lessonId]/route.ts', import.meta.url), 'utf8')
let sequence = 0

async function setup({ published = true, exists = true, invalidToken = false, databaseError = false } = {}) {
  const calls = []
  const lesson = { published, title: 'Rational Inequalities', privateRubric: 'SECRET' }
  const lessonRef = {
    get: async () => ({ exists, id: 'rational-inequalities', data: () => exists ? lesson : undefined }),
    collection: (name) => {
      assert.equal(name, 'concepts')
      calls.push('concepts')
      return { get: async () => ({ docs: [
        { id: 'second', data: () => ({ title: 'Second', order: 2, required: true, starterQuestion: 'Why?', successCriteria: 'SECRET' }) },
        { id: 'first', data: () => ({ title: 'First', order: 1, required: true, starterQuestion: 'How?', misconception: 'SECRET' }) },
      ] }) }
    },
  }
  const mocks = {
    getAdminAuth: () => ({ verifyIdToken: async () => {
      if (invalidToken) throw { code: 'auth/invalid-id-token' }
      return { uid: 'verified-user' }
    } }),
    getAdminFirestore: () => ({ collection: (name) => {
      calls.push(name)
      if (databaseError) throw new Error('SECRET')
      if (name === 'lessons') return { doc: () => lessonRef }
      assert.equal(name, 'users')
      return { doc: (uid) => {
        assert.equal(uid, 'verified-user')
        return { collection: (name) => {
          assert.equal(name, 'progress')
          return { doc: () => ({ get: async () => ({ data: () => ({ demonstratedConcepts: ['first', 'first', 'unknown'] }) }) }) }
        } }
      } }
    } }),
  }
  const key = `__lessonTest${sequence++}`
  globalThis[key] = mocks
  const patched = source.replace(
    /import \{ getAdminAuth, getAdminFirestore \} from '@app-firebase\/admin'/,
    `const { getAdminAuth, getAdminFirestore } = globalThis[${JSON.stringify(key)}]`,
  )
  const compiled = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  delete globalThis[key]
  return {
    calls,
    run: (token = 'valid') => route.GET(new Request('http://localhost/api/lessons/rational-inequalities?uid=other', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }), { params: Promise.resolve({ lessonId: 'rational-inequalities' }) }),
  }
}

test('lesson requires a valid token before database access', async () => {
  const missing = await setup()
  assert.equal((await missing.run('')).status, 401)
  assert.deepEqual(missing.calls, [])
  const invalid = await setup({ invalidToken: true })
  assert.equal((await invalid.run()).status, 401)
  assert.deepEqual(invalid.calls, [])
})

test('missing and unpublished lessons return 404 without reading concepts or progress', async () => {
  for (const options of [{ exists: false }, { published: false }]) {
    const { run, calls } = await setup(options)
    assert.equal((await run()).status, 404)
    assert.deepEqual(calls, ['lessons'])
  }
})

test('published lesson returns ordered student-facing concepts and only verified user progress', async () => {
  const { run } = await setup()
  const response = await run()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const data = await response.json()
  assert.deepEqual(data.lesson.concepts.map((concept) => concept.id), ['first', 'second'])
  assert.deepEqual(data.demonstratedConcepts, ['first'])
  assert.ok(!JSON.stringify(data).includes('SECRET'))
})

test('lesson database errors do not disclose internals', async () => {
  const { run } = await setup({ databaseError: true })
  const response = await run()
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Could not load this lesson. Please try again.' })
})
