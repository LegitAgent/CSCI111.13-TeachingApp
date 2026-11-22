import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const routeSource = await readFile(new URL('../src/app/api/dashboard/route.ts', import.meta.url), 'utf8')
let moduleId = 0

async function loadRoute({ verify, lessons = [], progress = [], databaseError } = {}) {
  const calls = []
  const mocks = {
    getAdminAuth: () => ({ verifyIdToken: async (token) => {
      calls.push(['verify', token])
      return verify ? verify(token) : { uid: 'verified-student' }
    } }),
    getAdminFirestore: () => ({ collection(name) {
      calls.push(['collection', name])
      if (databaseError) throw new Error('Internal database details')
      if (name === 'lessons') return { where: (...args) => {
        calls.push(['where', ...args])
        return { get: async () => ({ docs: lessons }) }
      } }
      assert.equal(name, 'users')
      return { doc: (uid) => {
        calls.push(['uid', uid])
        return { collection: (name) => {
          assert.equal(name, 'progress')
          return { get: async () => ({ docs: progress }) }
        } }
      } }
    } }),
  }
  const key = `__dashboardTest${moduleId++}`
  globalThis[key] = mocks
  const source = routeSource.replace(
    /import \{ getAdminAuth, getAdminFirestore \} from '@app-firebase\/admin'/,
    `const { getAdminAuth, getAdminFirestore } = globalThis[${JSON.stringify(key)}]`,
  )
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  delete globalThis[key]
  return { GET: route.GET, calls }
}

function request(token, query = '') {
  return new Request(`http://localhost/api/dashboard${query}`, {
    headers: token ? { Authorization: token } : {},
  })
}

test('missing or malformed bearer tokens are rejected before Firebase access', async () => {
  const { GET, calls } = await loadRoute()
  for (const token of [undefined, 'Basic abc', 'Bearer', 'Bearer one two']) {
    const response = await GET(request(token))
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
  assert.deepEqual(calls, [])
})

test('invalid and expired tokens return 401 without querying Firestore', async () => {
  for (const code of ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired']) {
    const { GET, calls } = await loadRoute({ verify: () => { throw { code } } })
    assert.equal((await GET(request('Bearer invalid'))).status, 401)
    assert.deepEqual(calls, [['verify', 'invalid']])
  }
})

test('uses verified UID, filters published lessons, sorts, and returns only dashboard fields', async () => {
  const { GET, calls } = await loadRoute({
    lessons: [
      { id: 'second', data: () => ({ title: 'Second', order: 6, requiredConceptCount: 5, answerKey: 'private' }) },
      { id: 'first', data: () => ({ title: 'First', order: 1, requiredConceptCount: 3 }) },
    ],
    progress: [{ id: 'second', data: () => ({
      stage: 'assessment', bestScore: 80, mastered: false,
      demonstratedConcepts: ['domain', 'signs', 'domain'], privateConversation: 'private',
    }) }],
  })
  const response = await GET(request('Bearer valid', '?uid=another-student'))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.lessons.map((lesson) => lesson.id), ['first', 'second'])
  assert.equal(data.lessons[0].progress, null)
  assert.deepEqual(data.lessons[1].progress, {
    stage: 'assessment', bestScore: 80, mastered: false, demonstratedConceptCount: 2,
  })
  assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(['where', 'published', '==', true])))
  assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(['uid', 'verified-student'])))
  assert.ok(!JSON.stringify(data).includes('private'))
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('no lessons returns an empty list', async () => {
  const { GET } = await loadRoute()
  assert.deepEqual(await (await GET(request('Bearer valid'))).json(), { lessons: [] })
})

test('database failures return a generic 500 without internal details', async () => {
  const { GET } = await loadRoute({ databaseError: true })
  const response = await GET(request('Bearer valid'))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Could not load your dashboard. Please try again.' })
})

test('credential failures are server errors rather than invalid student sessions', async () => {
  const { GET } = await loadRoute({ verify: () => { throw { code: 'app/invalid-credential' } } })
  assert.equal((await GET(request('Bearer valid'))).status, 500)
})
