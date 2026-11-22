import 'server-only'
import { getAdminAuth, getAdminFirestore } from '@app-firebase/admin'
import type { ChatMessage, ChatState } from '@/chatData'

export class TutorError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function authenticate(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) throw new TutorError(401, 'Sign in to use the tutor.')
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (typeof code === 'string' && ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
      'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code)) {
      throw new TutorError(401, 'Your session has expired. Sign in again.')
    }
    throw new TutorError(500, 'Could not verify your session. Please try again.')
  }
}

export async function loadTutor(uid: string, lessonId: string) {
  if (!lessonId || lessonId.includes('/') || lessonId === '.' || lessonId === '..') throw new TutorError(404, 'Lesson not found.')
  const db = getAdminFirestore()
  const lessonRef = db.collection('lessons').doc(lessonId)
  const lessonSnapshot = await lessonRef.get()
  const lesson = lessonSnapshot.data()
  if (!lessonSnapshot.exists || lesson?.published !== true) throw new TutorError(404, 'Lesson not found.')

  const userRef = db.collection('users').doc(uid)
  const progressRef = userRef.collection('progress').doc(lessonId)
  const sessionRef = userRef.collection('socraticSessions').doc(lessonId)
  const [conceptSnapshot, progressSnapshot, sessionSnapshot, messageSnapshot] = await Promise.all([
    lessonRef.collection('concepts').get(), progressRef.get(), sessionRef.get(),
    sessionRef.collection('messages').orderBy('sequence', 'desc').limit(40).get(),
  ])
  const concepts = conceptSnapshot.docs.map((doc) => {
    const value = doc.data()
    return {
      id: doc.id, title: String(value.title ?? doc.id), order: Number(value.order) || 0,
      required: value.required === true, starterQuestion: String(value.starterQuestion ?? ''),
      successCriteria: String(value.successCriteria ?? ''), misconception: String(value.misconception ?? ''),
    }
  }).filter((concept) => concept.required).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  if (!concepts.length) throw new TutorError(409, 'This lesson has no required concept questions yet.')

  const progress = progressSnapshot.data()
  if (!progressSnapshot.exists) throw new TutorError(409, 'Open the lesson again to start your progress.')
  const ids = new Set(concepts.map((concept) => concept.id))
  const demonstratedConcepts: string[] = Array.isArray(progress?.demonstratedConcepts)
    ? [...new Set<string>(progress.demonstratedConcepts.filter((id: unknown): id is string => typeof id === 'string' && ids.has(id)))] : []
  const current = concepts.find((concept) => !demonstratedConcepts.includes(concept.id)) ?? null
  const revision = sessionSnapshot.data()?.revision ?? 0
  const messages: ChatMessage[] = messageSnapshot.docs.reverse().map((doc) => {
    const value = doc.data()
    return { id: doc.id, role: value.role === 'user' ? 'user' : 'assistant', content: String(value.content ?? '') }
  })
  if (!messages.length) messages.push({ id: 'opening', role: 'assistant', content: current?.starterQuestion || 'Your conceptual section is complete.' })

  const state: ChatState = {
    messages, revision, demonstratedConcepts,
    currentConcept: current ? { id: current.id, title: current.title } : null,
    completed: current === null,
  }
  return { db, lesson, lessonRef, lessonId, progressRef, sessionRef, concepts, current, state }
}

export type TutorContext = Awaited<ReturnType<typeof loadTutor>>

export async function acquireTurn(context: TutorContext, requestId: string, revision: number, answer: string) {
  const turnRef = context.sessionRef.collection('turns').doc(requestId)
  return context.db.runTransaction(async (transaction) => {
    const [session, turn] = await Promise.all([transaction.get(context.sessionRef), transaction.get(turnRef)])
    if (turn.exists) {
      if (turn.data()?.answer !== answer) throw new TutorError(409, 'This reply identifier was already used. Reload the conversation.')
      return false
    }
    const data = session.data()
    if ((data?.revision ?? 0) !== revision) throw new TutorError(409, 'This conversation changed in another tab. Reload it before replying.')
    if (data?.pendingTurn?.expiresAt > Date.now()) throw new TutorError(409, 'The tutor is already answering. Wait a moment, then reload the conversation.')
    transaction.set(context.sessionRef, {
      revision, lessonId: context.lessonId,
      pendingTurn: { id: requestId, expiresAt: Date.now() + 90_000 },
    }, { merge: true })
    return true
  })
}

export async function releaseTurn(context: TutorContext, requestId: string) {
  await context.db.runTransaction(async (transaction) => {
    const session = await transaction.get(context.sessionRef)
    if (session.data()?.pendingTurn?.id === requestId) transaction.update(context.sessionRef, { pendingTurn: null })
  })
}

export async function saveTurn(context: TutorContext, requestId: string, answer: string,
  reply: string, passed: boolean, evidence: string, model: string) {
  const current = context.current
  if (!current) throw new TutorError(409, 'The conceptual section is already complete.')
  const demonstratedConcepts = passed
    ? [...new Set([...context.state.demonstratedConcepts, current.id])] : context.state.demonstratedConcepts
  const next = context.concepts.find((concept) => !demonstratedConcepts.includes(concept.id)) ?? null
  const suffix = passed ? next ? `\n\n${next.starterQuestion}` : '\n\nYou have demonstrated every required concept. Your conceptual section is complete.' : ''
  const content = reply.trim() + suffix
  const revision = context.state.revision + 1
  const userMessage: ChatMessage = { id: `${requestId}-user`, role: 'user', content: answer }
  const tutorMessage: ChatMessage = { id: `${requestId}-assistant`, role: 'assistant', content }

  await context.db.runTransaction(async (transaction) => {
    const [session, progress, lesson] = await Promise.all([
      transaction.get(context.sessionRef), transaction.get(context.progressRef), transaction.get(context.lessonRef),
    ])
    if (session.data()?.pendingTurn?.id !== requestId || (session.data()?.revision ?? 0) !== context.state.revision) {
      throw new TutorError(409, 'The conversation changed. Reload to see the saved messages.')
    }
    if (lesson.data()?.published !== true || lesson.data()?.version !== context.lesson.version) throw new TutorError(409, 'This lesson changed. Reload it before continuing.')
    if (!progress.exists) throw new TutorError(409, 'Your lesson progress is unavailable. Reopen the lesson.')
    const now = new Date()
    if (!context.state.revision) {
      transaction.set(context.sessionRef.collection('messages').doc('opening'), {
        role: 'assistant', content: context.state.messages[0].content, sequence: 0, createdAt: now,
      })
    }
    transaction.create(context.sessionRef.collection('messages').doc(userMessage.id), {
      role: 'user', content: answer, sequence: revision * 2 - 1, conceptId: current.id, createdAt: now,
    })
    transaction.create(context.sessionRef.collection('messages').doc(tutorMessage.id), {
      role: 'assistant', content, sequence: revision * 2, conceptId: current.id, createdAt: now,
    })
    transaction.create(context.sessionRef.collection('turns').doc(requestId), {
      answer, conceptId: current.id, passed, evidence, model, createdAt: now,
    })
    transaction.update(context.sessionRef, { revision, pendingTurn: null, updatedAt: now })
    transaction.update(context.progressRef, {
      demonstratedConcepts,
      ...(!progress.data()?.mastered ? { stage: next ? 'socratic' : 'assessment' } : {}),
      lastOpenedAt: now,
    })
  })
  return {
    suffix,
    state: {
      messages: [...context.state.messages, userMessage, tutorMessage].slice(-40),
      revision, demonstratedConcepts,
      currentConcept: next ? { id: next.id, title: next.title } : null,
      completed: next === null,
    } satisfies ChatState,
  }
}
