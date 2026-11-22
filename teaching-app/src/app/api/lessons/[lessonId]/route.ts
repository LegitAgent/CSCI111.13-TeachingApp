import { getAdminAuth, getAdminFirestore } from '@app-firebase/admin'
import type { LessonConcept, LessonData } from '@/lessonData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) {
    return Response.json({ error: 'Sign in to view this lesson.' }, { status: 401, headers })
  }

  try {
    const adminAuth = getAdminAuth()
    let uid: string
    try {
      uid = (await adminAuth.verifyIdToken(token)).uid
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      if (typeof code === 'string' && [
        'auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
        'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found',
      ].includes(code)) {
        return Response.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401, headers })
      }
      throw error
    }

    const { lessonId } = await params
    if (!lessonId || lessonId.includes('/') || lessonId === '.' || lessonId === '..') {
      return Response.json({ error: 'Lesson not found.' }, { status: 404, headers })
    }

    const db = getAdminFirestore()
    const lessonRef = db.collection('lessons').doc(lessonId)
    const snapshot = await lessonRef.get()
    const lesson = snapshot.data()
    if (!snapshot.exists || lesson?.published !== true) {
      return Response.json({ error: 'Lesson not found.' }, { status: 404, headers })
    }

    const [conceptSnapshot, progressSnapshot] = await Promise.all([
      lessonRef.collection('concepts').get(),
      db.collection('users').doc(uid).collection('progress').doc(lessonId).get(),
    ])

    const concepts: LessonConcept[] = conceptSnapshot.docs.map((doc) => {
      const concept = doc.data()
      return {
        id: doc.id,
        title: typeof concept.title === 'string' ? concept.title : doc.id,
        order: typeof concept.order === 'number' && Number.isFinite(concept.order) ? concept.order : 0,
        required: concept.required === true,
        starterQuestion: typeof concept.starterQuestion === 'string' ? concept.starterQuestion : '',
      }
    }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    const progress = progressSnapshot.data()
    const conceptIds = new Set(concepts.map((concept) => concept.id))
    const demonstratedConcepts = Array.isArray(progress?.demonstratedConcepts)
      ? [...new Set(progress.demonstratedConcepts.filter((id): id is string => typeof id === 'string' && conceptIds.has(id)))] : []

    return Response.json({
      lesson: {
        id: snapshot.id,
        title: typeof lesson.title === 'string' ? lesson.title : snapshot.id,
        description: typeof lesson.description === 'string' ? lesson.description : '',
        passingScorePercent: typeof lesson.passingScorePercent === 'number' && Number.isFinite(lesson.passingScorePercent)
          ? lesson.passingScorePercent : 80,
        concepts,
      },
      demonstratedConcepts,
    } satisfies LessonData, { headers })
  } catch {
    return Response.json({ error: 'Could not load this lesson. Please try again.' }, { status: 500, headers })
  }
}
