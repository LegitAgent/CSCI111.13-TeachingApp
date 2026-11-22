'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '@app-firebase/config'
import { getDashboardPath } from '@/lib/dashboardPath'
import type { LessonData } from '@/types/lesson'
import TutorChat from '@/components/tutor/TutorChat'
import TutorPopup from '@/components/tutor/TutorPopup'
import LessonAssessment from '@/components/assessment/LessonAssessment'
import '@/components/dashboard/DashboardPage.css'
import '@/components/lessons/LessonPage.css'

export default function LessonPage({ dashboardSlug, lessonId, chatOnly = false, assessmentOnly = false }: {
  dashboardSlug: string
  lessonId: string
  chatOnly?: boolean
  assessmentOnly?: boolean
}) {
  const [user, setUser] = useState<User | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [data, setData] = useState<LessonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser)
    setCheckingAuth(false)
  }), [])

  useEffect(() => {
    if (!user || getDashboardPath(user) !== `/${dashboardSlug}`) return
    const controller = new AbortController()

    async function loadLesson(currentUser: User) {
      setLoading(true)
      setData(null)
      setError('')
      setNotFound(false)

      try {
        const token = await currentUser.getIdToken()
        if (controller.signal.aborted) return
        const startResponse = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (startResponse.status === 404) {
          setNotFound(true)
          return
        }
        if (!startResponse.ok) {
          const result = await startResponse.json()
          throw new Error(typeof result.error === 'string' ? result.error : 'Could not save your lesson progress.')
        }

        const response = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        const result = await response.json()
        if (controller.signal.aborted) return
        if (response.status === 404) {
          setNotFound(true)
        } else if (!response.ok) {
          throw new Error(typeof result.error === 'string' ? result.error : 'Could not load this lesson.')
        } else {
          setData(result)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : 'Could not load this lesson.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadLesson(user)
    return () => controller.abort()
  }, [user, dashboardSlug, lessonId, attempt])

  if (checkingAuth) return <main className="dashboard-page"><p role="status">Checking sign-in status…</p></main>
  if (!user) redirect('/login')
  const dashboardPath = getDashboardPath(user)
  if (!dashboardPath) redirect('/signup')
  if (`/${dashboardSlug}` !== dashboardPath) {
    redirect(`${dashboardPath}/lessons/${encodeURIComponent(lessonId)}${chatOnly ? '/chat' : assessmentOnly ? '/assessment' : ''}`)
  }

  const required = data?.lesson.concepts.filter((concept) => concept.required) ?? []
  const demonstrated = required.filter((concept) => data?.demonstratedConcepts.includes(concept.id)).length
  const lessonPath = `${dashboardPath}/lessons/${encodeURIComponent(lessonId)}`

  return (
    <main className={`dashboard-page lesson-page${chatOnly ? ' dedicated-tutor-page' : ''}`}>
      <nav className="lesson-navigation" aria-label="Lesson navigation">
        {(chatOnly || assessmentOnly) && <Link href={lessonPath}>← Lesson overview</Link>}
        <Link href={dashboardPath}>{chatOnly || assessmentOnly ? 'Dashboard' : '← Back to dashboard'}</Link>
      </nav>
      {loading ? <p role="status">Loading lesson…</p> : notFound ? (
        <section><h1>Lesson unavailable</h1><p>This lesson could not be found or is not published.</p></section>
      ) : error ? (
        <div className="dashboard-notice">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </div>
      ) : data ? (
        <>
          <header className="lesson-introduction">
            <p className="dashboard-brand">PreCalPal · Inequalities</p>
            <h1>{data.lesson.title}</h1>
            {chatOnly ? (
              <p className="tutor-progress"><strong>{demonstrated} / {required.length}</strong> required concepts demonstrated</p>
            ) : <p>{data.lesson.description}</p>}
          </header>

          {!chatOnly && !assessmentOnly && <section className="lesson-section" aria-labelledby="mastery-heading">
            <h2 id="mastery-heading">Your learning goals</h2>
            <p>Demonstrate every required concept, then score at least {data.lesson.passingScorePercent}% on the problem-solving assessment.</p>
            <p><strong>{demonstrated} of {required.length} required concepts demonstrated</strong></p>
          </section>}

          {!chatOnly && !assessmentOnly && lessonId === 'rational-inequalities' && <RationalIntroduction />}

          {assessmentOnly ? <LessonAssessment key={lessonId} user={user} lessonId={lessonId} lessonPath={lessonPath} /> : chatOnly ? <TutorChat key={lessonId} user={user} lessonId={lessonId} assessmentHref={`${lessonPath}/assessment`} onProgress={(demonstratedConcepts) => {
            setData((current) => current ? { ...current, demonstratedConcepts } : current)
          }} /> : <TutorPopup key={lessonId} user={user} lessonId={lessonId} assessmentHref={`${lessonPath}/assessment`} completed={required.length > 0 && demonstrated === required.length} onProgress={(demonstratedConcepts) => {
            setData((current) => current ? { ...current, demonstratedConcepts } : current)
          }} />}
        </>
      ) : null}
    </main>
  )
}

function RationalIntroduction() {
  return (
    <section className="lesson-section lesson-reading" aria-labelledby="introduction-heading">
      <h2 id="introduction-heading">Understanding rational inequalities</h2>
      <p>A rational expression is a quotient of two polynomials. A rational inequality compares such an expression with another value using &lt;, &gt;, ≤, or ≥.</p>
      <p>The denominator must never be zero. Keep all restrictions from the original expression, even when factors cancel.</p>
      <h3>A method you can use</h3>
      <ol>
        <li>Record the original denominator restrictions. Move all terms to one side and combine them into one quotient compared with zero.</li>
        <li>Find the real zeros of the numerator and denominator. Keep the original restrictions too.</li>
        <li>Put these critical numbers in order to divide the number line into intervals.</li>
        <li>Test a value inside each interval and record the sign of the quotient. Signs do not necessarily alternate across every boundary.</li>
        <li>Select the intervals satisfying the inequality. Include valid numerator zeros only when equality is allowed, and exclude every original denominator zero.</li>
      </ol>
      <h3>Worked example</h3>
      <p>Solve <strong>(x − 2)/(x + 1) ≥ 0</strong>.</p>
      <p>The critical numbers are −1 and 2. The value −1 is excluded because the denominator is zero.</p>
      <div className="lesson-table-scroll">
        <table>
          <caption>Testing the three intervals</caption>
          <thead><tr><th scope="col">Interval</th><th scope="col">Test value</th><th scope="col">Quotient</th><th scope="col">Sign</th></tr></thead>
          <tbody>
            <tr><td>(−∞, −1)</td><td>−2</td><td>4</td><td>Positive</td></tr>
            <tr><td>(−1, 2)</td><td>0</td><td>−2</td><td>Negative</td></tr>
            <tr><td>(2, ∞)</td><td>3</td><td>1/4</td><td>Positive</td></tr>
          </tbody>
        </table>
      </div>
      <p>Choose the positive intervals and include 2, where the expression equals zero. The solution is <strong>(−∞, −1) ∪ [2, ∞)</strong>.</p>
      <p>In set-builder notation: <strong>{'{x ∈ ℝ | x < −1 or x ≥ 2}'}</strong>.</p>
      <p><a href="https://math.libretexts.org/Courses/Monroe_Community_College/MTH_165_College_Algebra_MTH_175_Precalculus/03:_Polynomial_and_Rational_Functions/3.08:_Polynomial_and_Rational_Inequalities">Reference: Polynomial and Rational Inequalities, LibreTexts</a></p>
    </section>
  )
}
