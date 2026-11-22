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
const rubricLibrary = await importSource('../src/server/tutorRubric.ts')
const teachingLibrary = await importSource('../src/server/tutorTeaching.ts')

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

test('cumulative evaluation requires every criterion and quotes only student sources', () => {
  const rubric = rubricLibrary.buildRubric('Identify the critical numbers. Explain why intervals keep one sign.')
  const sources = new Map([['earlier', ['The critical numbers are 1 and 3.']], ['newest', ['There are no zeros or undefined points inside, so the sign stays the same.']]])
  const value = { reply: 'Correct.', criteria: {
    'criterion-1': { met: true, evidence: [{ messageId: 'earlier', quote: 'critical numbers are 1 and 3' }] },
    'criterion-2': { met: true, evidence: [{ messageId: 'newest', quote: 'no zeros or undefined points inside' }] },
  }, example: '(x-1)/(x-3)' }
  assert.equal(rubricLibrary.parseConceptAssessment(JSON.stringify(value), rubric, sources).passed, true)
  const missing = structuredClone(value)
  missing.criteria['criterion-2'] = { met: false, evidence: [] }
  assert.equal(rubricLibrary.parseConceptAssessment(JSON.stringify(missing), rubric, sources).passed, false)
  const invented = structuredClone(value)
  invented.criteria['criterion-2'].evidence[0].messageId = 'assistant'
  const recovered = rubricLibrary.parseConceptAssessment(JSON.stringify(invented), rubric, sources)
  assert.equal(recovered.passed, false)
  assert.equal(recovered.incompleteEvidence, true)
  assert.equal(recovered.assessment.criteria['criterion-1'].met, true)
  assert.deepEqual(recovered.assessment.criteria['criterion-2'], { met: false, evidence: [] })
  const noEvidence = structuredClone(value)
  noEvidence.criteria['criterion-2'].evidence = []
  assert.equal(rubricLibrary.parseConceptAssessment(JSON.stringify(noEvidence), rubric, sources).passed, false)
  const omitted = structuredClone(value)
  delete omitted.criteria['criterion-2']
  assert.throws(() => rubricLibrary.parseConceptAssessment(JSON.stringify(omitted), rubric, sources))
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
async function setup(stage = 'independent') {
  const documents = new Map([
    ['lessons/rational', { published: true, title: 'Rational inequalities', version: 1 }],
    ['lessons/rational/concepts/domain', { title: 'Domain', order: 1, required: true, starterQuestion: 'Why exclude zero denominators?', successCriteria: 'Division by zero is undefined.', misconception: 'SECRET' }],
    ['lessons/rational/concepts/signs', { title: 'Signs', order: 2, required: true, starterQuestion: 'Why test intervals?', successCriteria: 'The sign is constant between critical numbers.' }],
    ['users/student/progress/rational', { stage: 'socratic', demonstratedConcepts: [], bestScore: 90, mastered: false }],
  ])
  if (stage) documents.set('users/student/socraticSessions/rational', {
    revision: 0, conceptTeaching: { domain: { stage }, signs: { stage } },
  })
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
    ...teachingLibrary,
    buildRubric: rubricLibrary.buildRubric,
    getAdminFirestore: () => db,
    getAdminAuth: () => ({ verifyIdToken: async (token) => {
      if (token !== 'valid') throw { code: 'auth/invalid-id-token' }
      return { uid: 'student' }
    } }),
  }
  const tutor = await importSource('../src/server/tutor.ts', [[
    /import \{ getAdminAuth, getAdminFirestore \} from '@app-firebase\/admin'/,
    `const { getAdminAuth, getAdminFirestore } = globalThis[${JSON.stringify(key)}]`,
  ], [
    /import \{ buildRubric, type ConceptAssessment \} from '\.\/tutorRubric'/,
    `const { buildRubric } = globalThis[${JSON.stringify(key)}]`,
  ], [
    /import \{ familiarityQuestion, type LearningStage \} from '\.\/tutorTeaching'/,
    `const { familiarityQuestion } = globalThis[${JSON.stringify(key)}]`,
  ]])
  delete globalThis[key]
  return { tutor, documents }
}

async function chatRoute(tutor, streamMuse, completeMuse = async () => { throw new Error('Fallback unavailable.') }) {
  const key = `__chatRoute${instance++}`
  globalThis[key] = { ...tutor, ...rubricLibrary, ...teachingLibrary, readReplyPrefix: muse.readReplyPrefix, streamMuse, completeMuse }
  const route = await importSource('../src/app/api/lessons/[lessonId]/chat/route.ts', [
    [/import \{ authenticate, loadTutor, acquireTurn, releaseTurn, saveTurn, TutorError \} from '@\/server\/tutor'/,
      `const { authenticate, loadTutor, acquireTurn, releaseTurn, saveTurn, TutorError } = globalThis[${JSON.stringify(key)}]`],
    [/import \{ completeMuse, readReplyPrefix, streamMuse \} from '@\/server\/muse'/,
      `const { completeMuse, readReplyPrefix, streamMuse } = globalThis[${JSON.stringify(key)}]`],
    [/import \{ assessmentSchema, buildTutorMessages, isClarificationRequest, isProgressQuestion, parseConceptAssessment, progressReply \} from '@\/server\/tutorRubric'/,
      `const { assessmentSchema, buildTutorMessages, isClarificationRequest, isProgressQuestion, parseConceptAssessment, progressReply } = globalThis[${JSON.stringify(key)}]`],
    [/import \{ buildTeachingMessages, familiarityQuestion, knowsTopic, needsHelp, parseTeachingResponse, teachingSchema \} from '@\/server\/tutorTeaching'/,
      `const { buildTeachingMessages, familiarityQuestion, knowsTopic, needsHelp, parseTeachingResponse, teachingSchema } = globalThis[${JSON.stringify(key)}]`],
  ])
  delete globalThis[key]
  return route
}

function chatRequest(message = 'Division by zero is undefined.', revision = 0, requestId = '12345678-1234-1234-1234-123456789012') {
  return new Request('http://localhost/api/lessons/rational/chat', {
    method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, requestId, revision }),
  })
}

async function lastEvent(response) {
  return (await response.text()).trim().split('\n').map((line) => JSON.parse(line)).at(-1)
}

test('a new lesson checks familiarity; yes skips the introduction without an AI call or mastery credit', async () => {
  const { tutor, documents } = await setup(null)
  const opening = await tutor.loadTutor('student', 'rational')
  assert.equal(opening.teachingStage, 'familiarity')
  assert.match(opening.state.messages[0].content, /are you familiar/)
  const route = await chatRoute(tutor, async () => { throw new Error('No AI call is needed to accept familiarity.') })
  const response = await route.POST(chatRequest('yeah'), { params: Promise.resolve({ lessonId: 'rational' }) })
  const { state } = await response.json()
  assert.deepEqual(state.demonstratedConcepts, [])
  assert.match(state.messages.at(-1).content, /Why exclude zero denominators/)
  const resumed = await tutor.loadTutor('student', 'rational')
  assert.equal(resumed.teachingStage, 'independent')
  assert.equal(resumed.evidenceSources.has('12345678-1234-1234-1234-123456789012-user'), false)
  assert.equal(documents.get('users/student/socraticSessions/rational').conceptAssessments, undefined)
})

test('unfamiliar students receive teaching and guided practice before a fresh independent question', async () => {
  const { tutor, documents } = await setup(null)
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  let calls = 0
  const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003']
  try {
    const route = await chatRoute(tutor, async (messages) => {
      calls++
      if (calls < 3) assert.ok(messages[0].content.includes('TEACHING AND GUIDED PRACTICE'))
      else {
        assert.ok(messages[0].content.includes('independent assessment'))
        const evidence = messages[0].content.split('Student evidence sources for this concept: ')[1].split('\n')[0]
        assert.ok(!evidence.includes(`${ids[1]}-user`))
      }
      const values = [
        { reply: 'A denominator is the bottom of a fraction. In 1/(x-2), x=2 would require division by zero. Can 2 be used?', nextStep: 'guided', independentQuestion: '', example: '1/(x-2)' },
        { reply: 'You have identified the restriction in our practice example.', nextStep: 'independent', independentQuestion: 'For 1/(x+4), which input must be excluded, and why?', example: '1/(x+4)' },
        { reply: 'Correct: the excluded input makes division by zero.', criteria: { 'criterion-1': { met: true, evidence: [{ messageId: `${ids[2]}-user`, quote: 'Division by zero is undefined' }] } }, example: '1/(x+4)', needsGuidance: false },
      ]
      return (async function* () { yield JSON.stringify(values[calls - 1]) })()
    })
    let event = await lastEvent(await route.POST(chatRequest('no, never seen it', 0, ids[0]), { params: Promise.resolve({ lessonId: 'rational' }) }))
    assert.equal(event.type, 'done')
    assert.deepEqual(event.state.demonstratedConcepts, [])
    assert.equal((await tutor.loadTutor('student', 'rational')).teachingStage, 'guided')
    event = await lastEvent(await route.POST(chatRequest('No, division by zero is undefined.', 1, ids[1]), { params: Promise.resolve({ lessonId: 'rational' }) }))
    assert.equal(event.type, 'done')
    assert.match(event.state.messages.at(-1).content, /Now try this independently/)
    assert.deepEqual(event.state.demonstratedConcepts, [])
    const resumed = await tutor.loadTutor('student', 'rational')
    assert.equal(resumed.teachingStage, 'independent')
    assert.equal(resumed.activeExample, '1/(x+4)')
    assert.equal(resumed.evidenceSources.has(`${ids[1]}-user`), false)
    event = await lastEvent(await route.POST(chatRequest('-4. Division by zero is undefined.', 2, ids[2]), { params: Promise.resolve({ lessonId: 'rational' }) }))
    assert.equal(event.type, 'done')
    assert.deepEqual(event.state.demonstratedConcepts, ['domain'])
    assert.match(event.state.messages.at(-1).content, /Before we start Signs/)
    assert.equal((await tutor.loadTutor('student', 'rational')).teachingStage, 'familiarity')
    assert.equal(documents.get(`users/student/socraticSessions/rational/messages/${ids[1]}-user`).learningStage, 'guided')
  } finally {
    if (originalKey === undefined) delete process.env.MUSE_CODE_API
    else process.env.MUSE_CODE_API = originalKey
  }
})

test('the server prevents a guided or familiarity turn from granting mastery', async () => {
  for (const stage of ['familiarity', 'guided']) {
    const { tutor } = await setup(stage)
    const context = await tutor.loadTutor('student', 'rational')
    await tutor.acquireTurn(context, 'guided', 0, 'yes')
    await assert.rejects(() => tutor.saveTurn(context, 'guided', 'yes', 'Correct.', true, '', 'model'), { status: 409 })
  }
  const result = teachingLibrary.parseTeachingResponse(JSON.stringify({
    reply: 'Let us practise.', nextStep: 'independent', independentQuestion: 'Which input is excluded from 1/(x-2)?', example: '1/(x-2)',
  }), false)
  assert.equal(result.stage, 'guided')
  assert.ok(!result.suffix.includes('independently'))
  assert.equal(teachingLibrary.knowsTopic('yeah but idk what a sign chart is'), false)
})

test('the model can identify an unfamiliar prerequisite even without a recognized help phrase', async () => {
  const { tutor, documents } = await setup()
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  try {
    const route = await chatRoute(tutor, async () => (async function* () {
      yield JSON.stringify({ reply: 'Let me explain a denominator first. In 1/(x-2), it is x-2. What does it equal at x=2?',
        criteria: { 'criterion-1': { met: true, evidence: [{ messageId: '12345678-1234-1234-1234-123456789012-user', quote: 'The bottom thing' }] } },
        example: '1/(x-2)', needsGuidance: true })
    })())
    const event = await lastEvent(await route.POST(chatRequest('The bottom thing is new to me.'), { params: Promise.resolve({ lessonId: 'rational' }) }))
    assert.equal(event.type, 'done')
    assert.deepEqual(event.state.demonstratedConcepts, [])
    const resumed = await tutor.loadTutor('student', 'rational')
    assert.equal(resumed.teachingStage, 'guided')
    assert.equal(resumed.evidenceSources.size, 0)
    assert.equal(documents.get('users/student/socraticSessions/rational').conceptAssessments, undefined)
  } finally {
    if (originalKey === undefined) delete process.env.MUSE_CODE_API
    else process.env.MUSE_CODE_API = originalKey
  }
})

test('existing conversations get a familiarity check once while retaining their saved checkpoints', async () => {
  const { tutor, documents } = await setup(null)
  documents.set('users/student/socraticSessions/rational', { revision: 1 })
  documents.set('users/student/socraticSessions/rational/messages/old', { role: 'assistant', content: 'An earlier question.', sequence: 2, conceptId: 'domain' })
  let context = await tutor.loadTutor('student', 'rational')
  assert.equal(context.state.messages.length, 2)
  assert.match(context.state.messages.at(-1).content, /are you familiar/)
  await tutor.acquireTurn(context, 'migration', 1, 'yes')
  await tutor.saveTurn(context, 'migration', 'yes', 'Try the diagnostic question.', false, '', 'familiarity-check', undefined, { stage: 'independent', example: '' })
  context = await tutor.loadTutor('student', 'rational')
  assert.equal(context.state.messages.filter((message) => message.id === 'familiarity-domain').length, 1)
  assert.equal(context.state.messages.at(-1).content, 'Try the diagnostic question.')
  assert.equal(context.state.messages[0].content, 'An earlier question.')
})

test('chat route streams feedback and saves a passing turn before reporting completion', async () => {
  const { tutor, documents } = await setup()
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  try {
    const route = await chatRoute(tutor, async (messages) => {
      assert.ok(messages[0].content.includes('Division by zero is undefined.'))
      return (async function* () {
        yield '{"reply":"Correct. '
        yield 'That is undefined.","criteria":{"criterion-1":{"met":true,'
        yield '"evidence":[{"messageId":"12345678-1234-1234-1234-123456789012-user","quote":"Division by zero"}]}},"example":""}'
      })()
    })
    const response = await route.POST(chatRequest(), { params: Promise.resolve({ lessonId: 'rational' }) })
    assert.equal(response.status, 200)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(events.at(-1).type, 'done')
    assert.deepEqual(events.at(-1).state.demonstratedConcepts, ['domain'])
    assert.ok(events.filter((event) => event.type === 'delta').map((event) => event.text).join('').includes('Before we start Signs'))
    assert.deepEqual(documents.get('users/student/progress/rational').demonstratedConcepts, ['domain'])
    assert.ok(!JSON.stringify(events).includes('evidence'))
  } finally {
    if (originalKey === undefined) delete process.env.MUSE_CODE_API
    else process.env.MUSE_CODE_API = originalKey
  }
})

test('a bad Muse citation saves the answer and asks a follow-up without advancing', async () => {
  const { tutor, documents } = await setup()
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  try {
    const route = await chatRoute(tutor, async () => (async function* () {
      yield JSON.stringify({
        reply: 'That is correct.',
        criteria: { 'criterion-1': { met: true, evidence: [{ messageId: 'unknown', quote: 'Division by zero' }] } },
        example: '',
      })
    })())
    const response = await route.POST(chatRequest(), { params: Promise.resolve({ lessonId: 'rational' }) })
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    const final = events.at(-1)
    assert.equal(final.type, 'done')
    assert.deepEqual(final.state.demonstratedConcepts, [])
    assert.equal(final.state.messages.at(-2).content, 'Division by zero is undefined.')
    assert.match(final.state.messages.at(-1).content, /explain how you reached your conclusion/)
    assert.equal(documents.get('users/student/socraticSessions/rational').pendingTurn, null)
  } finally {
    if (originalKey === undefined) delete process.env.MUSE_CODE_API
    else process.env.MUSE_CODE_API = originalKey
  }
})

test('an interrupted stream retries once and saves only the complete replacement', async () => {
  const { tutor, documents } = await setup()
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  let retries = 0
  try {
    const route = await chatRoute(tutor, async () => (async function* () {
      yield '{"reply":"Partial reply'
      throw Object.assign(new Error('Stream closed.'), { code: 'muse-stream-closed-early' })
    })(), async () => {
      retries++
      return JSON.stringify({
        reply: 'Correct. Division by zero is undefined.',
        criteria: { 'criterion-1': { met: true, evidence: [{ messageId: '12345678-1234-1234-1234-123456789012-user', quote: 'Division by zero' }] } },
        example: '',
      })
    })
    const response = await route.POST(chatRequest(), { params: Promise.resolve({ lessonId: 'rational' }) })
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(retries, 1)
    assert.equal(events[1].type, 'reset')
    assert.equal(events.at(-1).type, 'done')
    assert.match(events.at(-1).state.messages.at(-1).content, /^Correct\./)
    assert.deepEqual(documents.get('users/student/progress/rational').demonstratedConcepts, ['domain'])
    assert.equal([...documents.keys()].filter((path) => path.includes('/turns/')).length, 1)
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
  assert.ok(saved.state.messages.at(-1).content.includes('Before we start Signs'))
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

test('criterion checkpoints survive reload and retain student evidence beyond the history window', async () => {
  const { tutor, documents } = await setup()
  documents.get('lessons/rational/concepts/domain').successCriteria = 'Identify numerator zeros. Identify denominator zeros.'
  let context = await tutor.loadTutor('student', 'rational')
  await tutor.acquireTurn(context, 'partial', 0, 'Numerator zeros make the fraction zero.')
  const assessment = {
    rubricKey: context.rubric.key,
    criteria: {
      'criterion-1': { met: true, evidence: [{ messageId: 'partial-user', quote: 'Numerator zeros make the fraction zero' }] },
      'criterion-2': { met: false, evidence: [] },
    }, example: '(x-1)/(x-3)',
  }
  await tutor.saveTurn(context, 'partial', 'Numerator zeros make the fraction zero.', 'What about denominator zeros?', false, 'Numerator zeros', 'model', assessment)
  for (let index = 0; index < 45; index++) documents.set(`users/student/socraticSessions/rational/messages/later${index}`, {
    role: 'assistant', content: 'A follow-up question.', conceptId: 'domain', sequence: 10 + index,
  })
  context = await tutor.loadTutor('student', 'rational')
  assert.ok(!context.state.messages.some((message) => message.id === 'partial-user'))
  assert.equal(context.previousAssessment.criteria['criterion-1'].met, true)
  assert.ok(context.evidenceSources.get('partial-user').includes('Numerator zeros make the fraction zero'))
  assert.equal(context.activeExample, '(x-1)/(x-3)')
  documents.get('lessons/rational/concepts/domain').successCriteria = 'Explain a different requirement.'
  const changed = await tutor.loadTutor('student', 'rational')
  assert.equal(changed.previousAssessment, null)
})

test('passing a concept announces the transition and the next concept title explicitly', async () => {
  const { tutor } = await setup()
  const context = await tutor.loadTutor('student', 'rational')
  await tutor.acquireTurn(context, 'pass', 0, 'Division by zero is undefined.')
  const saved = await tutor.saveTurn(context, 'pass', 'Division by zero is undefined.', 'Correct.', true, 'Division by zero', 'model')
  assert.ok(saved.suffix.includes('Concept complete: Domain.'))
  assert.ok(saved.suffix.includes('Next: Signs.'))
})

test('asking whether the previous question passed is answered from progress without an AI call or awarding another concept', async () => {
  const { tutor, documents } = await setup()
  documents.get('users/student/progress/rational').demonstratedConcepts = ['domain']
  const route = await chatRoute(tutor, async () => { throw new Error('The model must not be called for a status question.') })
  const response = await route.POST(chatRequest('wait so did i answer the question before'), { params: Promise.resolve({ lessonId: 'rational' }) })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.ok(data.state.messages.at(-1).content.includes('Yes—you completed Domain.'))
  assert.ok(data.state.messages.at(-1).content.includes('now working on Signs'))
  assert.deepEqual(data.state.demonstratedConcepts, ['domain'])
  assert.equal(data.state.currentConcept.id, 'signs')
})

test('the grading prompt keeps saved evidence and explicitly distinguishes calculation from explanation', () => {
  const rubric = rubricLibrary.buildRubric('List the intervals. Explain why one test value works.')
  const messages = rubricLibrary.buildTutorMessages({
    title: 'Rational', current: { title: 'Intervals', starterQuestion: 'Why divide the line?', misconception: '' },
    rubric, previous: null, completedTitles: ['Domain'], activeExample: '(x-1)/(x-3)',
    history: [], sources: new Map([['older', ['(-infinity,1), (1,3), (3,infinity)']]]),
    answer: 'The sign cannot change without a zero or undefined point.', answerId: 'newest',
  })
  assert.ok(messages[0].content.includes('EVERY clause'))
  assert.ok(messages[0].content.includes('Listing intervals does not explain WHY'))
  assert.ok(messages[0].content.includes('older'))
  assert.ok(messages[0].content.includes('Active example: (x-1)/(x-3)'))
})

test('informal clarification and repeated-question complaints are recognized without matching math answers', () => {
  for (const answer of ['wdym', 'huh, dude you jsut repeated the same shit', 'son', 'bro what do you mean by outer ones?', 'you are repeating yourself']) {
    assert.equal(rubricLibrary.isClarificationRequest(answer), true, answer)
  }
  for (const answer of ['positive / negative', 'the root is repeated so the sign stays the same', 'so that we can see where the domain is']) {
    assert.equal(rubricLibrary.isClarificationRequest(answer), false, answer)
  }
})

test('help turns omit grading pressure and repetitive history, and explicitly teach the last step', () => {
  const messages = teachingLibrary.buildTeachingMessages({
    title: 'Rational', current: { title: 'Intervals', starterQuestion: 'Why divide the line?', misconception: '' },
    stage: 'independent', helpRequested: true, activeExample: '(x-1)/(x-3)',
    history: [{ role: 'assistant', content: 'Earlier repeated praise' }, { role: 'user', content: 'wdym' },
      { role: 'assistant', content: 'How would you order 1 and 3 to form the open intervals, including the outer ones?' }],
    answer: 'huh, dude you jsut repeated the same shit',
  })
  assert.equal(messages.length, 4)
  assert.ok(messages[0].content.includes('small worked numerical example'))
  assert.ok(messages[0].content.includes('change representation or demonstrate more'))
  assert.ok(!messages[0].content.includes('EVERY clause'))
  assert.ok(!JSON.stringify(messages).includes('Earlier repeated praise'))
  assert.ok(messages[2].content.includes('How would you order 1 and 3'))
})

for (const answer of ['wdym', 'huh, dude you jsut repeated the same shit', 'son']) {
test(`${answer} requests help without changing progress even if the model awards credit`, async () => {
  const { tutor, documents } = await setup()
  const originalKey = process.env.MUSE_CODE_API
  process.env.MUSE_CODE_API = 'test-placeholder'
  try {
    const context = await tutor.loadTutor('student', 'rational')
    const previous = { rubricKey: context.rubric.key, criteria: {
      'criterion-1': { met: false, evidence: [] },
    }, example: '(x-1)/(x-3)' }
    documents.set('users/student/socraticSessions/rational', { revision: 0, conceptAssessments: { domain: previous } })
    const route = await chatRoute(tutor, async (messages) => {
      assert.ok(messages.some((message) => message.content.includes('TEACHING AND GUIDED PRACTICE')))
      assert.ok(messages.some((message) => message.content.includes('Do not praise a help request')))
      return (async function* () {
        yield JSON.stringify({ reply: 'Undefined means there is no value for the expression. Can we divide a number by zero?',
          nextStep: 'guided', independentQuestion: '', example: '' })
      })()
    })
    const response = await route.POST(chatRequest(answer), { params: Promise.resolve({ lessonId: 'rational' }) })
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(events.at(-1).type, 'done')
    assert.deepEqual(events.at(-1).state.demonstratedConcepts, [])
    assert.deepEqual(documents.get('users/student/socraticSessions/rational').conceptAssessments.domain, previous)
    assert.equal(documents.get('users/student/progress/rational').stage, 'socratic')
  } finally {
    if (originalKey === undefined) delete process.env.MUSE_CODE_API
    else process.env.MUSE_CODE_API = originalKey
  }
})
}
