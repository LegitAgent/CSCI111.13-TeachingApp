import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function importSource(path, replacements = []) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  source = source.replace("import 'server-only'", '')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const muse = await importSource('../src/server/muse.ts')

function providerStream(parts, finish = 'stop') {
  const payload = parts.map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\r\n\r\n`).join('')
    + (finish ? `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n` : '')
  const bytes = new TextEncoder().encode(payload)
  // Split inside JSON, CRLF delimiters, and multibyte characters.
  return new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7))
    controller.close()
  } })
}

test('provider SSE parser handles arbitrary byte boundaries and Unicode', async () => {
  let text = ''
  for await (const delta of muse.readProviderText(providerStream(['Correct. ', 'x ≥ 2']))) text += delta
  assert.equal(text, 'Correct. x ≥ 2')
})

test('truncated or token-limited provider responses cannot be saved', async () => {
  for (const reason of [null, 'length']) {
    await assert.rejects(async () => {
      for await (const chunk of muse.readProviderText(providerStream(['partial'], reason))) void chunk
    })
  }
})

test('passing evaluations require literal evidence from the newest student answer', () => {
  assert.deepEqual(muse.parseEvaluation('{"passed":true,"evidence":"division by zero"}', 'It is undefined because of division by zero.'), {
    passed: true, evidence: 'division by zero',
  })
  for (const invalid of ['{"passed":true,"evidence":""}', '{"passed":true,"evidence":"invented"}', '{"passed":"true","evidence":"zero"}', '```json']) {
    assert.throws(() => muse.parseEvaluation(invalid, 'division by zero'))
  }
  assert.equal(muse.parseEvaluation('{"passed":false,"evidence":""}', 'I do not know.').passed, false)
})

test('structured streaming extracts only visible reply text, including escaped characters', () => {
  const reply = 'Correct: "zero".\nTry x ≥ 2.\\'
  const full = JSON.stringify({ reply, passed: true, evidence: 'private evidence' })
  assert.equal(muse.readReplyPrefix(full), reply)
  let previous = ''
  for (let index = 0; index <= full.length; index++) {
    const text = muse.readReplyPrefix(full.slice(0, index))
    assert.ok(text.startsWith(previous))
    assert.ok(reply.startsWith(text))
    previous = text
  }
  assert.equal(muse.readReplyPrefix('{"reply":"Use \\u226'), 'Use ')
  assert.equal(muse.readReplyPrefix('{"reply":"Use \\u2265'), 'Use ≥')
  assert.equal(muse.readReplyPrefix('{"passed":true,"evidence":"private","reply":"Visible"}'), 'Visible')
})

let instance = 0
async function setup() {
  const documents = new Map([
    ['lessons/rational', { published: true, title: 'Rational inequalities', version: 1 }],
    ['lessons/rational/concepts/domain', { title: 'Domain', order: 1, required: true, starterQuestion: 'Why exclude zero denominators?', successCriteria: 'Division by zero is undefined.', misconception: 'SECRET' }],
    ['lessons/rational/concepts/signs', { title: 'Signs', order: 2, required: true, starterQuestion: 'Why test intervals?', successCriteria: 'The sign is constant between critical numbers.' }],
    ['users/student/progress/rational', { stage: 'socratic', demonstratedConcepts: [], bestScore: 90, mastered: false }],
  ])
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: documents.has(path), data: () => structuredClone(documents.get(path)) })
  const ref = (path) => ({ path, collection: (name) => collection(`${path}/${name}`), get: async () => snapshot(path) })
  const collection = (path) => {
    const query = { field: null, direction: null, limit: Infinity }
    const result = {
      doc: (id) => ref(`${path}/${id}`),
      orderBy: (field, direction) => { query.field = field; query.direction = direction; return result },
      limit: (count) => { query.limit = count; return result },
      async get() {
        let paths = [...documents.keys()].filter((key) => key.startsWith(path + '/') && key.slice(path.length + 1).split('/').length === 1)
        if (query.field) paths.sort((a, b) => (documents.get(a)[query.field] - documents.get(b)[query.field]) * (query.direction === 'desc' ? -1 : 1))
        paths = paths.slice(0, query.limit)
        return { docs: paths.map(snapshot) }
      },
    }
    return result
  }
  const db = {
    collection,
    async runTransaction(callback) {
      const writes = []
      const result = await callback({
        get: async (ref) => snapshot(ref.path),
        set: (ref, value, options) => writes.push(() => documents.set(ref.path, options?.merge ? { ...documents.get(ref.path), ...value } : value)),
        update: (ref, value) => writes.push(() => { assert.ok(documents.has(ref.path)); documents.set(ref.path, { ...documents.get(ref.path), ...value }) }),
        create: (ref, value) => writes.push(() => { assert.ok(!documents.has(ref.path)); documents.set(ref.path, value) }),
      })
      for (const write of writes) write()
      return result
    },
  }
  const key = `__tutorTest${instance++}`
  globalThis[key] = {
    getAdminFirestore: () => db,
    getAdminAuth: () => ({ verifyIdToken: async (token) => {
      if (token !== 'valid') throw { code: 'auth/invalid-id-token' }
      return { uid: 'student' }
    } }),
  }
  const tutor = await importSource('../src/server/tutor.ts', [[
    /import \{ getAdminAuth, getAdminFirestore \} from '@app-firebase\/admin'/,
    `const { getAdminAuth, getAdminFirestore } = globalThis[${JSON.stringify(key)}]`,
  ]])
  delete globalThis[key]
  return { tutor, documents }
}

async function chatRoute(tutor, streamMuse) {
  const key = `__chatRoute${instance++}`
  globalThis[key] = { ...tutor, parseEvaluation: muse.parseEvaluation, readReplyPrefix: muse.readReplyPrefix, streamMuse }
  const route = await importSource('../src/app/api/lessons/[lessonId]/chat/route.ts', [
    [/import \{ authenticate, loadTutor, acquireTurn, releaseTurn, saveTurn, TutorError \} from '@\/server\/tutor'/,
      `const { authenticate, loadTutor, acquireTurn, releaseTurn, saveTurn, TutorError } = globalThis[${JSON.stringify(key)}]`],
    [/import \{ parseEvaluation, readReplyPrefix, streamMuse, type ModelMessage \} from '@\/server\/muse'/,
      `const { parseEvaluation, readReplyPrefix, streamMuse } = globalThis[${JSON.stringify(key)}]`],
  ])
  delete globalThis[key]
  return route
}

function chatRequest(message = 'Division by zero is undefined.') {
  return new Request('http://localhost/api/lessons/rational/chat', {
    method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, requestId: '12345678-1234-1234-1234-123456789012', revision: 0 }),
  })
}

test('chat route streams feedback and saves a passing turn before reporting completion', async () => {
  const { tutor, documents } = await setup()
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  try {
    const route = await chatRoute(tutor, async (messages) => {
      assert.ok(messages[0].content.includes('Division by zero is undefined.'))
      return (async function* () {
        yield '{"reply":"Correct. '
        yield 'That is undefined.","passed":true,'
        yield '"evidence":"Division by zero"}'
      })()
    })
    const response = await route.POST(chatRequest(), { params: Promise.resolve({ lessonId: 'rational' }) })
    assert.equal(response.status, 200)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(events.at(-1).type, 'done')
    assert.deepEqual(events.at(-1).state.demonstratedConcepts, ['domain'])
    assert.ok(events.filter((event) => event.type === 'delta').map((event) => event.text).join('').endsWith('Why test intervals?'))
    assert.deepEqual(documents.get('users/student/progress/rational').demonstratedConcepts, ['domain'])
    assert.ok(!JSON.stringify(events).includes('evidence'))
  } finally {
    if (originalKey === undefined) delete process.env.MUSE_CODE_API
    else process.env.MUSE_CODE_API = originalKey
  }
})

test('interrupted model streams do not save messages or progress and release the turn lock', async () => {
  const { tutor, documents } = await setup()
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  try {
    const route = await chatRoute(tutor, async () => (async function* () {
      yield '{"reply":"Partial reply'
      throw new Error('private provider detail')
    })())
    const response = await route.POST(chatRequest(), { params: Promise.resolve({ lessonId: 'rational' }) })
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(events.at(-1).type, 'error')
    assert.ok(!JSON.stringify(events).includes('private provider detail'))
    assert.deepEqual(documents.get('users/student/progress/rational').demonstratedConcepts, [])
    assert.equal(documents.get('users/student/socraticSessions/rational').pendingTurn, null)
    assert.ok(![...documents.keys()].some((key) => key.includes('/turns/') || key.includes('/messages/')))
  } finally {
    if (originalKey === undefined) delete process.env.MUSE_CODE_API
    else process.env.MUSE_CODE_API = originalKey
  }
})

test('chat authenticates tokens and loads only the verified student history', async () => {
  const { tutor } = await setup()
  await assert.rejects(() => tutor.authenticate(new Request('http://localhost')), { status: 401 })
  await assert.rejects(() => tutor.authenticate(new Request('http://localhost', { headers: { Authorization: 'Bearer bad' } })), { status: 401 })
  const uid = await tutor.authenticate(new Request('http://localhost?uid=someone-else', { headers: { Authorization: 'Bearer valid' } }))
  assert.equal(uid, 'student')
  const context = await tutor.loadTutor(uid, 'rational')
  assert.equal(context.state.messages[0].content, 'Why exclude zero denominators?')
  assert.equal(context.state.currentConcept.id, 'domain')
  assert.ok(!JSON.stringify(context.state).includes('SECRET'))
  assert.ok(!JSON.stringify(context.state).includes('successCriteria'))
})

test('unpublished lessons cannot be used for tutoring', async () => {
  const { tutor, documents } = await setup()
  documents.get('lessons/rational').published = false
  await assert.rejects(() => tutor.loadTutor('student', 'rational'), { status: 404 })
})

test('one passing turn saves messages, evidence, and only the current concept', async () => {
  const { tutor, documents } = await setup()
  const context = await tutor.loadTutor('student', 'rational')
  assert.equal(await tutor.acquireTurn(context, 'turn-one', 0, 'Division by zero is undefined.'), true)
  const saved = await tutor.saveTurn(context, 'turn-one', 'Division by zero is undefined.', 'Correct.', true, 'Division by zero', 'model')
  assert.equal(saved.state.revision, 1)
  assert.deepEqual(saved.state.demonstratedConcepts, ['domain'])
  assert.equal(saved.state.currentConcept.id, 'signs')
  assert.ok(saved.state.messages.at(-1).content.endsWith('Why test intervals?'))
  assert.equal(documents.get('users/student/progress/rational').bestScore, 90)
  assert.equal(documents.get('users/student/progress/rational').mastered, false)
  assert.equal(documents.get('users/student/socraticSessions/rational/turns/turn-one').evidence, 'Division by zero')
  const resumed = await tutor.loadTutor('student', 'rational')
  assert.equal(resumed.state.messages.length, 3)
  assert.equal(resumed.current.id, 'signs')
})

test('failed answers retain the concept and a single idempotent retry cannot earn it twice', async () => {
  const { tutor } = await setup()
  const context = await tutor.loadTutor('student', 'rational')
  await tutor.acquireTurn(context, 'turn-one', 0, 'I do not know.')
  const saved = await tutor.saveTurn(context, 'turn-one', 'I do not know.', 'What does division by zero mean?', false, '', 'model')
  assert.deepEqual(saved.state.demonstratedConcepts, [])
  assert.equal(saved.state.currentConcept.id, 'domain')
  const resumed = await tutor.loadTutor('student', 'rational')
  assert.equal(await tutor.acquireTurn(resumed, 'turn-one', 0, 'I do not know.'), false)
  await assert.rejects(() => tutor.acquireTurn(resumed, 'turn-one', 0, 'Different answer'), { status: 409 })
})

test('overlapping turns and stale tabs are rejected; released failures can retry', async () => {
  const { tutor } = await setup()
  const context = await tutor.loadTutor('student', 'rational')
  await tutor.acquireTurn(context, 'first', 0, 'Answer')
  await assert.rejects(() => tutor.acquireTurn(context, 'other', 0, 'Answer'), { status: 409 })
  await tutor.releaseTurn(context, 'first')
  assert.equal(await tutor.acquireTurn(context, 'first', 0, 'Answer'), true)
  await tutor.saveTurn(context, 'first', 'Answer', 'Try again.', false, '', 'model')
  await assert.rejects(() => tutor.acquireTurn(context, 'stale', 0, 'Answer'), { status: 409 })
})

test('all concepts advance the stage to assessment without granting overall mastery', async () => {
  const { tutor, documents } = await setup()
  documents.get('users/student/progress/rational').demonstratedConcepts = ['domain']
  const context = await tutor.loadTutor('student', 'rational')
  await tutor.acquireTurn(context, 'last', 0, 'The sign is constant.')
  const saved = await tutor.saveTurn(context, 'last', 'The sign is constant.', 'Correct.', true, 'sign is constant', 'model')
  assert.equal(saved.state.completed, true)
  assert.equal(saved.state.currentConcept, null)
  const progress = documents.get('users/student/progress/rational')
  assert.equal(progress.stage, 'assessment')
  assert.equal(progress.mastered, false)
  assert.equal(progress.bestScore, 90)
})

test('a changed lesson cannot commit a stale model evaluation', async () => {
  const { tutor, documents } = await setup()
  const context = await tutor.loadTutor('student', 'rational')
  await tutor.acquireTurn(context, 'one', 0, 'Answer')
  documents.get('lessons/rational').version = 2
  await assert.rejects(() => tutor.saveTurn(context, 'one', 'Answer', 'Correct', true, 'Answer', 'model'), { status: 409 })
  assert.deepEqual(documents.get('users/student/progress/rational').demonstratedConcepts, [])
})
