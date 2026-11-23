import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function loadSource(path, replacements = []) {
  let source = (await readFile(new URL(path, import.meta.url), 'utf8')).replace("import 'server-only'", '')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const intervals = await loadSource('../src/server/intervals.ts')

test('interval grading accepts equivalent unions, fractions, singleton points, and empty sets', () => {
  for (const [a, b] of [
    ['(3, infinity) U (-infinity, -7)', '(-∞, -7) ∪ (3, ∞)'],
    ['(-infinity, -0.25) U [3,3]', '(-∞, -1/4) ∪ {3}'],
    ['[1, 2] U (2, 4)', '[1, 4)'],
    ['[1, 5] U (2, 3)', '[1, 5]'],
    ['∅', '{}'],
    ['{ }', 'empty set'],
    ['(-inf, 3)', '(-infinity, 3)'],
    ['(−∞, 3) union [4, +inf)', '(-inf, 3) U [4, infinity)'],
    ['{3}', '[3]'],
    ['[3]', '[3,3]'],
    ['{3, 1/2, 3}', '[0.5] ∪ [3,3]'],
    ['[3] U (-inf,-1/4)', '(-∞,-0.25) ∪ {3}'],
  ]) assert.equal(intervals.sameIntervals(intervals.parseIntervals(a), intervals.parseIntervals(b)), true)
  assert.equal(intervals.sameIntervals(intervals.parseIntervals('(-2,1)'), intervals.parseIntervals('(-2,1]')), false)
  assert.equal(intervals.sameIntervals(intervals.parseIntervals('[1,2) U (2,3]'), intervals.parseIntervals('[1,3]')), false)
})

test('invalid answer notation is rejected without evaluating code', () => {
  for (const value of ['', '[infinity, infinity]', '[-infinity, 3)', '(3,1)', '(1,1)', '(0,1/0)', 'process.exit()', 'x > 3', '[inf]', '{-inf}', '{3,}', '[3,4,5]', '(3)']) {
    assert.throws(() => intervals.parseIntervals(value))
  }
})

test('alternative infinity and singleton notation is graded against the stored answer key', async () => {
  const { api, context } = await setup()
  const { attempt } = await api.startAssessment(await context(), false)
  const result = await api.submitAssessment(await context(), attempt.id, {
    ...answers, q1: '(-inf,-7) union (3,+inf)', q3: '[3] U (-∞,-0.25)',
  })
  assert.equal(result.attempt.score, 100)
})

let instance = 0
const answers = { q1: '(-infinity,-7) U (3,infinity)', q2: '(-2,1)', q3: '(-infinity,-1/4) U {3}', q4: '[-2,6)', q5: '(4,19]' }
const keys = [
  [{ lower: '-infinity', upper: '-7', lowerInclusive: false, upperInclusive: false }, { lower: '3', upper: 'infinity', lowerInclusive: false, upperInclusive: false }],
  [{ lower: '-2', upper: '1', lowerInclusive: false, upperInclusive: false }],
  [{ lower: '-infinity', upper: '-1/4', lowerInclusive: false, upperInclusive: false }, { lower: '3', upper: '3', lowerInclusive: true, upperInclusive: true }],
  [{ lower: '-2', upper: '6', lowerInclusive: true, upperInclusive: false }],
  [{ lower: '4', upper: '19', lowerInclusive: false, upperInclusive: true }],
]

async function addNotationQuestions(docs) {
  const bank = JSON.parse(await readFile(new URL('../scripts/data/set-builder-questions.json', import.meta.url), 'utf8'))
  for (const q of bank.questions) {
    docs.set('lessons/rational/questions/' + q.id, { active: true, version: 1,
      format: 'multiple-choice', prompt: q.prompt, choices: q.choices })
    docs.set('answerKeys/' + q.id + '-v1', { lessonId: 'rational', questionId: q.id, questionVersion: 1,
      correctChoiceId: q.correctChoiceId, explanation: q.explanation })
  }
}

test('mixed assessments select three interval problems and two notation MCQs without exposing keys', async () => {
  const { api, context, docs } = await setup()
  await addNotationQuestions(docs)
  const { attempt } = await api.startAssessment(await context(), false)
  assert.equal(attempt.questions.filter((q) => q.format === 'multiple-choice').length, 2)
  assert.equal(attempt.questions.filter((q) => q.format !== 'multiple-choice').length, 3)
  assert.ok(!JSON.stringify(attempt).includes('correctChoiceId'))
  assert.ok(!JSON.stringify(attempt).includes('explanation'))
  const stored = docs.get('users/student/assessmentAttempts/' + attempt.id)
  const submitted = Object.fromEntries(stored.questions.map((q) => [q.id, q.correctChoiceId ?? answers[q.id]]))
  // An attempted fabricated choice cannot alter scores or submit the attempt.
  const mcq = stored.questions.find((q) => q.format === 'multiple-choice')
  const current = await context()
  await assert.rejects(() => api.submitAssessment(current, attempt.id, { ...submitted, [mcq.id]: 'invented-choice' }), { status: 400 })
  assert.equal(docs.get('users/student/assessmentAttempts/' + attempt.id).status, 'in-progress')
  // Grade against the original snapshot even if the bank later changes.
  docs.get('answerKeys/' + mcq.id + '-v1').correctChoiceId = 'different'
  const result = await api.submitAssessment(await context(), attempt.id, submitted)
  assert.equal(result.attempt.score, 100)
  assert.equal(result.attempt.passed, true)
  const reviewed = result.attempt.results.find((q) => q.questionId === mcq.id)
  assert.equal(reviewed.answer, mcq.choices.find((c) => c.id === mcq.correctChoiceId).text)
  assert.ok(!JSON.stringify(result).includes('correctChoiceId'))
})

test('MCQs with invalid private keys cannot start an assessment', async () => {
  const { api, context, docs } = await setup()
  await addNotationQuestions(docs)
  for (const [path, value] of docs) {
    if (path.startsWith('answerKeys/rational-set-')) value.correctChoiceId = 'not-a-choice'
  }
  const current = await context()
  await assert.rejects(() => api.startAssessment(current, false), { status: 409 })
  assert.equal([...docs.keys()].filter((path) => path.includes('/assessmentAttempts/')).length, 0)
})

async function setup({ completed = true } = {}) {
  const docs = new Map([
    ['lessons/rational', { title: 'Rational', published: true, version: 1, passingScorePercent: 80 }],
    ['users/student/progress/rational', { demonstratedConcepts: completed ? ['c1', 'c2', 'c3', 'c4', 'c5'] : ['c1'], stage: 'assessment', mastered: false, bestScore: null }],
  ])
  for (let index = 1; index <= 5; index++) {
    const id = `q${index}`
    docs.set(`lessons/rational/concepts/c${index}`, { required: true })
    docs.set(`lessons/rational/questions/${id}`, { active: true, format: 'interval-input', version: 1, prompt: `Question ${index}` })
    docs.set(`answerKeys/${id}-v1`, { questionId: id, lessonId: 'rational', questionVersion: 1, intervals: keys[index - 1], answerDisplay: answers[id], explanation: 'Reviewed explanation' })
  }
  let nextId = 0
  const ref = (path) => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path), collection: (name) => collection(`${path}/${name}`) })
  const snapshot = (path) => ({ id: path.split('/').at(-1), ref: ref(path), exists: docs.has(path), data: () => structuredClone(docs.get(path)) })
  const collection = (path) => {
    let filter
    const query = {
      doc: (id = `attempt${++nextId}`) => ref(`${path}/${id}`),
      where: (...args) => { filter = args; return query },
      get: async () => ({ docs: [...docs.keys()].filter((key) => key.startsWith(path + '/') && key.slice(path.length + 1).split('/').length === 1)
        .filter((key) => !filter || docs.get(key)[filter[0]] === filter[2]).map(snapshot) }),
    }
    return query
  }
  const db = {
    collection,
    async runTransaction(callback) {
      const writes = []
      const result = await callback({
        get: async (ref) => snapshot(ref.path),
        create: (ref, value) => writes.push(() => { assert.ok(!docs.has(ref.path)); docs.set(ref.path, value) }),
        update: (ref, value) => writes.push(() => { assert.ok(docs.has(ref.path)); docs.set(ref.path, { ...docs.get(ref.path), ...value }) }),
      })
      writes.forEach((write) => write())
      return result
    },
  }
  class TutorError extends Error { constructor(status, message) { super(message); this.status = status } }
  const key = `__assessmentTest${instance++}`
  globalThis[key] = { ...intervals, getAdminFirestore: () => db, TutorError }
  const api = await loadSource('../src/server/assessment.ts', [
    [/import \{ getAdminFirestore \} from '@app-firebase\/admin'/, `const { getAdminFirestore } = globalThis[${JSON.stringify(key)}]`],
    [/import \{ TutorError \} from '\.\/tutor'/, `const { TutorError } = globalThis[${JSON.stringify(key)}]`],
    [/import \{ parseIntervals, readAnswerKey, sameIntervals \} from '\.\/intervals'/, `const { parseIntervals, readAnswerKey, sameIntervals } = globalThis[${JSON.stringify(key)}]`],
  ])
  delete globalThis[key]
  return { api, docs, context: () => api.assessmentContext('student', 'rational') }
}

test('assessment stays locked until every required concept has passed', async () => {
  const { context, docs } = await setup({ completed: false })
  await assert.rejects(context, { status: 403 })
  docs.get('users/student/progress/rational').demonstratedConcepts = ['c1', 'c2', 'c3', 'c4', 'unknown']
  await assert.rejects(context, { status: 403 })
})

test('starting a test returns five public questions, hides keys, and resumes the same attempt', async () => {
  const { api, context } = await setup()
  const first = await api.startAssessment(await context(), false)
  assert.equal(first.attempt.questions.length, 5)
  assert.equal(new Set(first.attempt.questions.map((q) => q.id)).size, 5)
  assert.deepEqual(first.attempt.results, [])
  assert.ok(!JSON.stringify(first).includes('intervals'))
  assert.ok(!JSON.stringify(first).includes('Reviewed explanation'))
  const second = await api.startAssessment(await context(), false)
  assert.equal(second.attempt.id, first.attempt.id)
})

test('four correct answers pass at 80 percent and mastery is saved; resubmission is idempotent', async () => {
  const { api, context, docs } = await setup()
  const { attempt } = await api.startAssessment(await context(), false)
  const result = await api.submitAssessment(await context(), attempt.id, { ...answers, q1: '∅' })
  assert.equal(result.attempt.score, 80)
  assert.equal(result.attempt.passed, true)
  const progress = docs.get('users/student/progress/rational')
  assert.equal(progress.mastered, true)
  assert.equal(progress.bestScore, 80)
  assert.equal(progress.stage, 'completed')
  const repeated = await api.submitAssessment(await context(), attempt.id, answers)
  assert.equal(repeated.attempt.score, 80)
})

test('failed tests keep mastery false and retries preserve prior attempt results and best score', async () => {
  const { api, context, docs } = await setup()
  const { attempt } = await api.startAssessment(await context(), false)
  const result = await api.submitAssessment(await context(), attempt.id, { ...answers, q1: '∅', q2: '∅' })
  assert.equal(result.attempt.score, 60)
  assert.equal(docs.get('users/student/progress/rational').mastered, false)
  const retried = await api.startAssessment(await context(), true)
  assert.notEqual(retried.attempt.id, attempt.id)
  assert.equal(docs.get(`users/student/assessmentAttempts/${attempt.id}`).score, 60)
  await api.submitAssessment(await context(), retried.attempt.id, answers)
  assert.equal(docs.get('users/student/progress/rational').bestScore, 100)
})

test('bad notation, missing answers, and another user attempt cannot change scores', async () => {
  const { api, context, docs } = await setup()
  const { attempt } = await api.startAssessment(await context(), false)
  const current = await context()
  await assert.rejects(() => api.submitAssessment(current, attempt.id, {}), { status: 400 })
  await assert.rejects(() => api.submitAssessment(current, attempt.id, { ...answers, q1: 'bad input' }), { status: 400 })
  await assert.rejects(() => api.submitAssessment(current, 'someone-elses-attempt', answers), { status: 404 })
  assert.equal(docs.get('users/student/progress/rational').bestScore, null)
  assert.equal(docs.get(`users/student/assessmentAttempts/${attempt.id}`).status, 'in-progress')
})
