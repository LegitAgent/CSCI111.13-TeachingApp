import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/app/api/lessons/[lessonId]/route.ts', import.meta.url), 'utf8')
let sequence = 0

async function setup({ published = true, exists = true, invalidToken = false, initialProgress, failWrite = false } = {}) {
  let progress = initialProgress ? { ...initialProgress } : undefined
  const writes = []
  const lessonRef = { kind: 'lesson' }
  const progressRef = { kind: 'progress' }
  const mocks = {
    getAdminAuth: () => ({ verifyIdToken: async () => {
      if (invalidToken) throw { code: 'auth/invalid-id-token' }
      return { uid: 'verified-student' }
    } }),
    getAdminFirestore: () => ({
      collection(name) {
        if (name === 'lessons') return { doc: () => lessonRef }
        assert.equal(name, 'users')
        return { doc: (uid) => {
          assert.equal(uid, 'verified-student')
          return { collection: (name) => {
            assert.equal(name, 'progress')
            return { doc: (id) => {
              assert.equal(id, 'rational-inequalities')
              return progressRef
            } }
          } }
        } }
      },
      async runTransaction(callback) {
        return callback({
          get: async (ref) => ref === lessonRef
            ? { exists, data: () => exists ? { published, version: 2 } : undefined }
            : { exists: progress !== undefined, data: () => progress },
          create(ref, data) {
            assert.equal(ref, progressRef)
            if (failWrite) throw new Error('private database failure')
            assert.equal(progress, undefined)
            writes.push('create')
            progress = data
          },
          update(ref, data) {
            assert.equal(ref, progressRef)
            if (failWrite) throw new Error('private database failure')
            writes.push('update')
            progress = { ...progress, ...data }
          },
        })
      },
    }),
  }
  const key = `__lessonStartTest${sequence++}`
  globalThis[key] = mocks
  const patched = source.replace(
    /import \{ getAdminAuth, getAdminFirestore \} from '@app-firebase\/admin'/,
    `const { getAdminAuth, getAdminFirestore } = globalThis[${JSON.stringify(key)}]`,
  )
  const compiled = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  delete globalThis[key]
  return {
    writes,
    progress: () => progress,
    run: (token = 'valid') => route.POST(new Request('http://localhost/api/lessons/rational-inequalities?uid=someone-else', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ mastered: true, bestScore: 100 }),
    }), { params: Promise.resolve({ lessonId: 'rational-inequalities' }) }),
  }
}

test('start rejects missing and invalid authentication without writing progress', async () => {
  for (const options of [{ token: '' }, { invalidToken: true }]) {
    const { run, writes } = await setup(options)
    assert.equal((await run(options.token)).status, 401)
    assert.deepEqual(writes, [])
  }
})

test('starting a published lesson creates initial progress for the verified student', async () => {
  const { run, writes, progress } = await setup()
  const response = await run()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { created: true })
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(writes, ['create'])
  assert.equal(progress().stage, 'socratic')
  assert.equal(progress().lessonVersion, 2)
  assert.deepEqual(progress().demonstratedConcepts, [])
  assert.equal(progress().bestScore, null)
  assert.equal(progress().mastered, false)
  assert.ok(progress().startedAt instanceof Date)
  assert.ok(progress().lastOpenedAt instanceof Date)
})

test('reopening preserves assessment results, mastery, stage, version, and start time', async () => {
  const existing = {
    stage: 'completed', lessonVersion: 1, demonstratedConcepts: ['domain-restrictions'],
    bestScore: 100, mastered: true, startedAt: 'original', lastOpenedAt: 'previous',
  }
  const { run, writes, progress } = await setup({ initialProgress: existing })
  const response = await run()
  assert.deepEqual(await response.json(), { created: false })
  assert.deepEqual(writes, ['update'])
  assert.deepEqual({ ...progress(), lastOpenedAt: 'previous' }, existing)
  assert.ok(progress().lastOpenedAt instanceof Date)
})

test('repeated starts create only one record', async () => {
  const { run, writes, progress } = await setup()
  await run()
  const startedAt = progress().startedAt
  await run()
  assert.deepEqual(writes, ['create', 'update'])
  assert.equal(progress().startedAt, startedAt)
})

test('missing and unpublished lessons never create progress', async () => {
  for (const options of [{ exists: false }, { published: false }]) {
    const { run, writes } = await setup(options)
    assert.equal((await run()).status, 404)
    assert.deepEqual(writes, [])
  }
})

test('failed progress saves return a generic server error', async () => {
  const { run } = await setup({ failWrite: true })
  const response = await run()
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Could not save your lesson progress. Please try again.' })
})
