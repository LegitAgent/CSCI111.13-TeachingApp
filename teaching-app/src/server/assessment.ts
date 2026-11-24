import 'server-only'
import { randomInt } from 'node:crypto'
import { getAdminFirestore } from '@app-firebase/admin'
import { TutorError } from './tutor'
import { parseIntervals, readAnswerKey, sameIntervals } from './intervals'
import type { AssessmentAttempt, AssessmentChoice, AssessmentData, QuestionResult } from '@/types/assessment'
import type { DocumentSnapshot } from 'firebase-admin/firestore'

export async function assessmentContext(uid: string, lessonId: string) {
  if (!lessonId || lessonId.includes('/') || lessonId === '.' || lessonId === '..') throw new TutorError(404, 'Lesson not found.')
  const db = getAdminFirestore()
  const lessonRef = db.collection('lessons').doc(lessonId)
  const userRef = db.collection('users').doc(uid)
  const progressRef = userRef.collection('progress').doc(lessonId)
  const attempts = userRef.collection('assessmentAttempts')
  const [lesson, concepts, progress] = await Promise.all([lessonRef.get(), lessonRef.collection('concepts').get(), progressRef.get()])
  if (lesson.data()?.published !== true) throw new TutorError(404, 'Lesson not found.')
  const required = concepts.docs.filter((doc) => doc.data().required === true).map((doc) => doc.id)
  function checkProgress(value: Record<string, unknown> | undefined) {
    const demonstrated = Array.isArray(value?.demonstratedConcepts) ? value.demonstratedConcepts : []
    if (!required.length || !required.every((id) => demonstrated.includes(id))) {
      throw new TutorError(403, 'Complete every required tutor concept before starting the test.')
    }
  }
  checkProgress(progress.data())
  return { db, lessonRef, lesson: lesson.data()!, lessonId, progressRef, progress, attempts, checkProgress }
}

export function publicAttempt(snapshot: DocumentSnapshot): AssessmentAttempt {
  const value = snapshot.data()
  if (!value) throw new TutorError(404, 'Test attempt not found.')
  return {
    id: snapshot.id,
    status: value.status === 'submitted' ? 'submitted' : 'in-progress',
    questions: value.questions.map((question: { id: string; prompt: string; format?: string; choices?: AssessmentChoice[] }) => ({
      id: question.id, prompt: question.prompt,
      ...(question.format === 'multiple-choice' ? { format: 'multiple-choice' as const,
        choices: (question.choices ?? []).map(({ id, text }) => ({ id, text })) } : {}),
    })),
    passingScorePercent: value.passingScorePercent,
    score: value.status === 'submitted' ? value.score : null,
    passed: value.status === 'submitted' ? value.passed : null,
    results: value.status === 'submitted' ? value.results : [],
  }
}

type AssessmentContext = Awaited<ReturnType<typeof assessmentContext>>

export async function currentAssessment(context: AssessmentContext): Promise<AssessmentData> {
  const id = context.progress.data()?.activeAssessmentId
  if (typeof id !== 'string') return { attempt: null }
  const snapshot = await context.attempts.doc(id).get()
  if (!snapshot.exists || snapshot.data()?.lessonId !== context.lessonId) return { attempt: null }
  return { attempt: publicAttempt(snapshot) }
}

export async function startAssessment(context: AssessmentContext, retry: boolean): Promise<AssessmentData> {
  const questions = await context.lessonRef.collection('questions').where('active', '==', true).get()
  const bank = questions.docs.filter((doc) => ['interval-input', 'multiple-choice'].includes(doc.data().format))
  if (bank.length < 5) throw new TutorError(409, 'This lesson needs five active test questions before its test can start.')
  for (let index = bank.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1)
    ;[bank[index], bank[swap]] = [bank[swap], bank[index]]
  }
  // Include conceptual notation questions when both formats are available.
  const intervalQuestions = bank.filter((doc) => doc.data().format === 'interval-input')
  const choiceQuestions = bank.filter((doc) => doc.data().format === 'multiple-choice')
  const mixed = intervalQuestions.length && choiceQuestions.length
    ? [...intervalQuestions.slice(0, 3), ...choiceQuestions.slice(0, 2)] : []
  const selectedIds = new Set(mixed.map((doc) => doc.id))
  const chosen = mixed.length ? [...mixed, ...bank.filter((doc) => !selectedIds.has(doc.id))].slice(0, 5) : bank.slice(0, 5)
  for (let index = chosen.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1)
    ;[chosen[index], chosen[swap]] = [chosen[swap], chosen[index]]
  }
  const selected = await Promise.all(chosen.map(async (doc) => {
    const question = doc.data()
    const version = question.version ?? 1
    const key = (await context.db.collection('answerKeys').doc(`${doc.id}-v${version}`).get()).data()
    if (!key || key.lessonId !== context.lessonId || key.questionId !== doc.id || key.questionVersion !== version) {
      throw new TutorError(409, 'A test question needs a matching answer key before the test can start.')
    }
    if (typeof question.prompt !== 'string' || !question.prompt.trim() || typeof key.explanation !== 'string') {
      throw new TutorError(409, 'A test question is missing its prompt, answer, or explanation.')
    }
    if (question.format === 'multiple-choice') {
      const raw: unknown = question.choices
      if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6 || raw.some((choice) =>
        !choice || typeof choice.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(choice.id)
        || typeof choice.text !== 'string' || !choice.text.trim() || choice.text.length > 1000)) {
        throw new TutorError(409, 'A multiple-choice question needs two to six valid choices.')
      }
      const choices: AssessmentChoice[] = raw.map(({ id, text }) => ({ id, text }))
      if (new Set(choices.map((choice) => choice.id)).size !== choices.length
        || typeof key.correctChoiceId !== 'string' || !choices.some((choice) => choice.id === key.correctChoiceId)) {
        throw new TutorError(409, 'A multiple-choice question needs a matching correct choice in its private answer key.')
      }
      return { id: doc.id, prompt: question.prompt, version, format: 'multiple-choice', choices,
        correctChoiceId: key.correctChoiceId, answerDisplay: choices.find((choice) => choice.id === key.correctChoiceId)!.text, explanation: key.explanation }
    }
    try { readAnswerKey(key.intervals) } catch { throw new TutorError(409, 'A test answer key has invalid interval data.') }
    if (typeof key.answerDisplay !== 'string') throw new TutorError(409, 'A test answer key needs a display answer.')
    return { id: doc.id, prompt: question.prompt, version, intervals: key.intervals, answerDisplay: key.answerDisplay, explanation: key.explanation }
  }))
  const attemptRef = context.attempts.doc()
  const threshold = Number(context.lesson.passingScorePercent)
  const passingScorePercent = Number.isFinite(threshold) && threshold > 0 && threshold <= 100 ? threshold : 80

  const ref = await context.db.runTransaction(async (transaction) => {
    const [progress, lesson] = await Promise.all([transaction.get(context.progressRef), transaction.get(context.lessonRef)])
    context.checkProgress(progress.data())
    if (lesson.data()?.published !== true || lesson.data()?.version !== context.lesson.version) throw new TutorError(409, 'The lesson changed. Reload before starting the test.')
    const activeId = progress.data()?.activeAssessmentId
    if (typeof activeId === 'string') {
      const active = await transaction.get(context.attempts.doc(activeId))
      if (active.exists && active.data()?.lessonId === context.lessonId && (!retry || active.data()?.status !== 'submitted')) return active.ref
    }
    transaction.create(attemptRef, {
      lessonId: context.lessonId, lessonVersion: context.lesson.version ?? 1,
      status: 'in-progress', questions: selected, passingScorePercent, startedAt: new Date(),
    })
    transaction.update(context.progressRef, { activeAssessmentId: attemptRef.id, ...(!progress.data()?.mastered ? { stage: 'assessment' } : {}) })
    return attemptRef
  })
  return { attempt: publicAttempt(await ref.get()) }
}

export async function submitAssessment(context: AssessmentContext, attemptId: unknown, answers: unknown): Promise<AssessmentData> {
  if (typeof attemptId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(attemptId)
    || !answers || typeof answers !== 'object' || Array.isArray(answers)) throw new TutorError(400, 'Send a valid test attempt and answers.')
  const submitted = answers as Record<string, unknown>
  const attemptRef = context.attempts.doc(attemptId)

  await context.db.runTransaction(async (transaction) => {
    const [attempt, progress] = await Promise.all([transaction.get(attemptRef), transaction.get(context.progressRef)])
    context.checkProgress(progress.data())
    const data = attempt.data()
    if (!data || data.lessonId !== context.lessonId) throw new TutorError(404, 'Test attempt not found.')
    if (data.status === 'submitted') return
    if (progress.data()?.activeAssessmentId !== attemptId) throw new TutorError(409, 'Open your current test attempt before submitting.')
    if (Object.keys(submitted).length !== data.questions.length) throw new TutorError(400, 'Answer every question before submitting.')
    const results: QuestionResult[] = data.questions.map((question: { id: string; intervals: unknown; answerDisplay: string; explanation: string;
      format?: string; choices?: AssessmentChoice[]; correctChoiceId?: string }, index: number) => {
      const answer = submitted[question.id]
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 500) throw new TutorError(400, `Enter an answer for question ${index + 1}.`)
      if (question.format === 'multiple-choice') {
        const choice = question.choices?.find((choice) => choice.id === answer.trim())
        if (!choice) throw new TutorError(400, `Select one of the listed choices for question ${index + 1}.`)
        return { questionId: question.id, answer: choice.text, correct: choice.id === question.correctChoiceId,
          correctAnswer: question.answerDisplay, explanation: question.explanation }
      }
      let parsed
      try { parsed = parseIntervals(answer) } catch { throw new TutorError(400, `Check the interval notation for question ${index + 1}. Use parentheses, brackets, and U for union.`) }
      return { questionId: question.id, answer: answer.trim(), correct: sameIntervals(parsed, readAnswerKey(question.intervals)), correctAnswer: question.answerDisplay, explanation: question.explanation }
    })
    const score = results.filter((result) => result.correct).length / results.length * 100
    const passed = score >= data.passingScorePercent
    const previous = progress.data()
    transaction.update(attemptRef, { status: 'submitted', submittedAt: new Date(), results, score, passed })
    transaction.update(context.progressRef, {
      bestScore: Math.max(typeof previous?.bestScore === 'number' ? previous.bestScore : 0, score),
      mastered: previous?.mastered === true || passed,
      stage: previous?.mastered === true || passed ? 'completed' : 'assessment',
      lastOpenedAt: new Date(),
    })
  })
  return { attempt: publicAttempt(await attemptRef.get()) }
}
