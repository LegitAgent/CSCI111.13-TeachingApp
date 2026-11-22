import { authenticate, TutorError } from '@/server/tutor'
import { assessmentContext, currentAssessment, startAssessment, submitAssessment } from '@/server/assessment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
type Context = { params: Promise<{ lessonId: string }> }

function failure(error: unknown) {
  if (!(error instanceof TutorError)) console.error('Assessment request failed', { name: error instanceof Error ? error.name : 'UnknownError' })
  return Response.json({ error: error instanceof TutorError ? error.message : 'Could not load or save your test. Please try again.' }, {
    status: error instanceof TutorError ? error.status : 500, headers,
  })
}

export async function GET(request: Request, { params }: Context) {
  try {
    const uid = await authenticate(request)
    const { lessonId } = await params
    return Response.json(await currentAssessment(await assessmentContext(uid, lessonId)), { headers })
  } catch (error) { return failure(error) }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const uid = await authenticate(request)
    let body
    try { body = await request.json() } catch { throw new TutorError(400, 'Send a valid test request.') }
    if (!body || !['start', 'retry', 'submit'].includes(body.action)) throw new TutorError(400, 'Choose a valid test action.')
    const { lessonId } = await params
    const context = await assessmentContext(uid, lessonId)
    const result = body.action === 'submit'
      ? await submitAssessment(context, body.attemptId, body.answers)
      : await startAssessment(context, body.action === 'retry')
    return Response.json(result, { headers })
  } catch (error) { return failure(error) }
}
