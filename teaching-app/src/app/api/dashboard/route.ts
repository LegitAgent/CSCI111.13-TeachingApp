import { getAdminAuth, getAdminFirestore } from '@app-firebase/admin'
import type { DashboardData, DashboardLesson } from '@/types/dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store' }

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]

  if (!token) {
    return Response.json({ error: 'Sign in to view your dashboard.' }, { status: 401, headers })
  }

  try {
    const adminAuth = getAdminAuth()
    let uid: string

    try {
      const decodedToken = await adminAuth.verifyIdToken(token)
      uid = decodedToken.uid
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

    const db = getAdminFirestore()
    const [lessonSnapshot, progressSnapshot] = await Promise.all([
      db.collection('lessons').where('published', '==', true).get(),
      db.collection('users').doc(uid).collection('progress').get(),
    ])
    const progressByLesson = new Map(progressSnapshot.docs.map((doc) => [doc.id, doc.data()]))

    const lessons: DashboardLesson[] = lessonSnapshot.docs.map((doc) => {
      const lesson = doc.data()
      const progress = progressByLesson.get(doc.id)
      const requiredConceptCount = Math.max(0, finiteNumber(lesson.requiredConceptCount, 0))
      const concepts = Array.isArray(progress?.demonstratedConcepts) ? progress.demonstratedConcepts : []

      return {
        id: doc.id,
        title: typeof lesson.title === 'string' ? lesson.title : doc.id,
        description: typeof lesson.description === 'string' ? lesson.description : '',
        order: finiteNumber(lesson.order, 0),
        requiredConceptCount,
        passingScorePercent: finiteNumber(lesson.passingScorePercent, 80),
        progress: progress ? {
          stage: typeof progress.stage === 'string' ? progress.stage : 'socratic',
          demonstratedConceptCount: Math.min(requiredConceptCount, new Set(concepts.filter((value) => typeof value === 'string')).size),
          bestScore: typeof progress.bestScore === 'number' && Number.isFinite(progress.bestScore)
            ? Math.max(0, Math.min(100, progress.bestScore)) : null,
          mastered: progress.mastered === true,
        } : null,
      }
    }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))

    return Response.json({ lessons } satisfies DashboardData, { headers })
  } catch {
    return Response.json({ error: 'Could not load your dashboard. Please try again.' }, { status: 500, headers })
  }
}
