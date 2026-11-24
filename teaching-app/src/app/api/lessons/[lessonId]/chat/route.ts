import { authenticate, loadTutor, acquireTurn, releaseTurn, saveTurn, TutorError } from '@/server/tutor'
import { completeMuse, readReplyPrefix, streamMuse } from '@/server/muse'
import { assessmentSchema, buildTutorMessages, collectStudentEvidence, isClarificationRequest, isProgressQuestion, parseConceptAssessment, progressReply } from '@/server/tutorRubric'
import { buildTeachingMessages, knowsTopic, needsHelp, parseTeachingResponse, teachingSchema } from '@/server/tutorTeaching'
import type { ConceptAssessment } from '@/server/tutorRubric'
import type { LearningStage } from '@/server/tutorTeaching'
import { rememberTerms, wantsIndependentAttempt, wantsThinkingSpace } from '@/server/tutorPedagogy'
import type { ChatEvent } from '@/types/chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90
const headers = { 'Cache-Control': 'private, no-store' }
type Context = { params: Promise<{ lessonId: string }> }

function logFailure(error: unknown, phase: string) {
  console.error('Tutor request failed', {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
    status: error instanceof TutorError ? error.status : undefined,
  })
}

function failure(error: unknown, phase: string) {
  if (!(error instanceof TutorError) || error.status >= 500) logFailure(error, phase)
  return Response.json({ error: error instanceof TutorError ? error.message : 'Could not load the tutor. Please try again.' }, {
    status: error instanceof TutorError ? error.status : 500, headers,
  })
}

export async function GET(request: Request, { params }: Context) {
  try {
    const uid = await authenticate(request)
    const { lessonId } = await params
    return Response.json((await loadTutor(uid, lessonId)).state, { headers })
  } catch (error) { return failure(error, 'load-conversation') }
}

export async function POST(request: Request, { params }: Context) {
  let context: Awaited<ReturnType<typeof loadTutor>> | undefined
  let requestId = ''
  let acquired = false
  try {
    const uid = await authenticate(request)
    if (Number(request.headers.get('content-length')) > 16_000) throw new TutorError(413, 'Please keep your answer under 3,000 characters.')
    let body
    try { body = await request.json() } catch { throw new TutorError(400, 'Send a valid reply.') }
    if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 3000
      || typeof body.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.requestId)
      || !Number.isSafeInteger(body.revision) || body.revision < 0) {
      throw new TutorError(400, 'Send an answer of 1 to 3,000 characters and a valid conversation revision.')
    }
    const answer = body.message.trim()
    requestId = body.requestId
    const { lessonId } = await params
    context = await loadTutor(uid, lessonId)
    acquired = await acquireTurn(context, requestId, body.revision, answer)
    if (!acquired) return Response.json({ state: context.state }, { headers })
    if (!context.current) throw new TutorError(409, 'You have already completed the conceptual section.')
    if (!context.current.successCriteria || !context.current.starterQuestion) throw new TutorError(409, 'This concept needs a question and evaluation criteria before tutoring can start.')
    const current = context.current
    if (isProgressQuestion(answer)) {
      const reply = progressReply(context.completedTitles, current.title)
      const saved = await saveTurn(context, requestId, answer, reply, false, '', 'progress-status')
      return Response.json({ state: saved.state }, { headers })
    }
    if (wantsThinkingSpace(answer)) {
      const saved = await saveTurn(context, requestId, answer, 'Of course—take your time. I’ll wait for your next thought.', false, '', 'thinking-space')
      return Response.json({ state: saved.state }, { headers })
    }
    if (context.teachingStage === 'familiarity' && knowsTopic(answer)) {
      const reply = `Let’s try a short question to check your understanding. Explain your reasoning in your own words.\n\n${current.starterQuestion}`
      const saved = await saveTurn(context, requestId, answer, reply, false, '', 'familiarity-check', undefined,
        { stage: 'independent', example: '' })
      return Response.json({ state: saved.state }, { headers })
    }
    if (!process.env.MUSE_CODE_API) throw new TutorError(503, 'The tutor is not configured. Set MUSE_CODE_API on the server.')
    const answerId = `${requestId}-user`
    const sources = new Map(context.evidenceSources)
    for (const [id, texts] of collectStudentEvidence(context.evidenceMessages, { id: answerId, content: answer })) sources.set(id, texts)
    const helpRequested = isClarificationRequest(answer) || needsHelp(answer)
    const teachingTurn = context.teachingStage !== 'independent' || helpRequested
    const messages = teachingTurn ? buildTeachingMessages({
      title: String(context.lesson.title ?? context.lessonId), current, stage: context.teachingStage,
      activeExample: context.activeExample, history: context.state.messages, answer, helpRequested,
      introducedTerms: context.introducedTerms, completedTitles: context.completedTitles,
    }) : buildTutorMessages({
      title: String(context.lesson.title ?? context.lessonId), current, rubric: context.rubric,
      previous: context.previousAssessment, completedTitles: context.completedTitles, activeExample: context.activeExample,
      history: context.state.messages, sources, answer, answerId,
      introducedTerms: context.introducedTerms,
    })

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
    const schema = teachingTurn ? teachingSchema() : assessmentSchema(context.rubric)
    // Establish the upstream request before returning headers so provider errors stay actionable.
    let upstream
    try { upstream = await streamMuse(messages, signal, schema) } catch (error) {
      throw new TutorError(502, signal.aborted ? 'The tutor took too long. Please try again.' : error instanceof Error ? error.message : 'The tutor is unavailable.')
    }
    const activeContext = context
    const turnId = requestId
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let connected = true
        function send(event: ChatEvent) {
          if (!connected) return
          try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')) } catch { connected = false }
        }
        let json = ''
        let reply = ''
        let savedSuccessfully = false
        let phase = 'read-ai-response'
        try {
          try {
            for await (const delta of upstream) {
              signal.throwIfAborted()
              json += delta
              if (json.length > 12_000) throw Object.assign(new Error('Muse reply too large.'), { code: 'muse-reply-too-large' })
              const nextReply = readReplyPrefix(json)
              const text = nextReply.slice(reply.length)
              reply = nextReply
              if (text) send({ type: 'delta', text })
            }
            if (!reply.trim()) throw Object.assign(new Error('Muse reply missing.'), { code: 'muse-empty-stream-reply' })
          } catch (error) {
            signal.throwIfAborted()
            if (error && typeof error === 'object' && 'code' in error && error.code === 'muse-content-filter') throw error
            logFailure(error, phase)
            phase = 'retry-ai-response'
            send({ type: 'reset' })
            json = await completeMuse(messages, signal, schema)
            if (json.length > 12_000) throw Object.assign(new Error('Muse reply too large.'), { code: 'muse-reply-too-large' })
            const completion = JSON.parse(json)
            if (typeof completion?.reply !== 'string' || !completion.reply.trim()) {
              throw Object.assign(new Error('Muse reply missing.'), { code: 'muse-empty-completion' })
            }
            reply = completion.reply
            send({ type: 'delta', text: reply })
          }
          signal.throwIfAborted()
          phase = 'validate-evaluation'
          let passed = false
          let evidence = ''
          let assessment: ConceptAssessment | undefined
          let feedback = reply
          let teachingSuffix = ''
          let teaching: { stage: LearningStage; example: string; introducedTerms?: string[] }
          if (teachingTurn) {
            const acknowledgement = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|got it|i understand|makes sense)[.!?\s]*$/i.test(answer)
            const result = parseTeachingResponse(json, activeContext.teachingStage === 'guided' && !helpRequested && (!acknowledgement || wantsIndependentAttempt(answer)))
            teaching = { stage: result.stage, example: result.example,
              introducedTerms: rememberTerms(activeContext.introducedTerms, result.introducedTerms, result.reply + result.suffix) }
            feedback = result.reply
            teachingSuffix = result.suffix
          } else {
            const evaluation = parseConceptAssessment(json, activeContext.rubric, sources)
            teaching = { stage: evaluation.needsGuidance ? 'guided' : 'independent', example: evaluation.assessment.example,
              introducedTerms: rememberTerms(activeContext.introducedTerms, evaluation.introducedTerms, reply) }
            // A request for teaching cannot award or revoke an existing checkpoint.
            if (!evaluation.needsGuidance) {
              assessment = evaluation.assessment
              passed = evaluation.passed
              evidence = evaluation.evidence
              if (evaluation.incompleteEvidence) feedback = 'I couldn’t reliably assess that explanation yet. You can add to your reasoning or ask for help when you’re ready.'
            }
          }
          phase = 'save-conversation'
          const saved = await saveTurn(activeContext, turnId, answer, feedback + teachingSuffix, passed, evidence,
            process.env.MUSE_MODEL || 'muse-spark-1.3', assessment, teaching)
          savedSuccessfully = true
          if (teachingSuffix) send({ type: 'delta', text: teachingSuffix })
          if (saved.suffix) send({ type: 'delta', text: saved.suffix })
          send({ type: 'done', state: saved.state })
        } catch (error) {
          logFailure(error, phase)
          // Never return raw provider bodies, credentials, or database errors.
          const message = error instanceof TutorError ? error.message
            : signal.aborted ? 'The tutor took too long or the connection closed. Retry your answer.'
            : phase === 'save-conversation' ? 'The reply could not be saved. Reload the conversation before retrying.'
            : phase === 'validate-evaluation' ? 'The tutor returned an unreadable evaluation. Your answer is still in the box, so you can retry.'
            : 'The AI reply ended before it was complete. Your answer is still in the box, so you can retry.'
          send({ type: 'error', message })
        } finally {
          if (!savedSuccessfully) await releaseTurn(activeContext, turnId).catch(() => {})
          try { controller.close() } catch { /* Browser disconnected. */ }
        }
      },
    })
    return new Response(stream, { headers: {
      ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no',
    } })
  } catch (error) {
    if (context && acquired) await releaseTurn(context, requestId).catch(() => {})
    return failure(error, 'prepare-reply')
  }
}
