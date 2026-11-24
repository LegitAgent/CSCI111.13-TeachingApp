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
import AppHeader from '@/components/layout/AppHeader'
import LearningSteps from '@/components/layout/LearningSteps'
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

  if (checkingAuth) return <main className="page-loading"><p role="status">Getting your lesson ready…</p></main>
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
    <>
    <AppHeader user={user} />
    <main id="main-content" className={`dashboard-page lesson-page${chatOnly ? ' dedicated-tutor-page' : ''}`}>
      <nav className="lesson-navigation" aria-label="Lesson navigation">
        <Link href={dashboardPath}>← Your learning plan</Link>
        {(chatOnly || assessmentOnly) && <Link href={lessonPath}>Lesson overview</Link>}
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
            <p className="eyebrow">INEQUALITIES <span aria-hidden="true"> / </span> {chatOnly ? 'TUTOR PRACTICE' : assessmentOnly ? 'ASSESSMENT' : 'READ & LEARN'}</p>
            <h1>{data.lesson.title}</h1>
            {chatOnly ? (
              <p className="tutor-progress"><strong>{demonstrated} / {required.length}</strong> required concepts demonstrated</p>
            ) : <p>{data.lesson.description}</p>}
          </header>

          <div className="learning-layout">
          <LearningSteps lessonPath={lessonPath} current={chatOnly ? 'tutor' : assessmentOnly ? 'assessment' : 'learn'} conceptsComplete={required.length > 0 && demonstrated === required.length} />
          <div className="learning-content">

          {!chatOnly && !assessmentOnly && <section className="lesson-section" aria-labelledby="mastery-heading">
            <p className="eyebrow">YOUR PATH TO MASTERY</p>
            <h2 id="mastery-heading">Understand it. Explain it. Apply it.</h2>
            <p>Demonstrate every required concept, then score at least {data.lesson.passingScorePercent}% on the problem-solving assessment.</p>
            <p><strong>{demonstrated} of {required.length} required concepts demonstrated</strong></p>
          </section>}

          {!chatOnly && !assessmentOnly && lessonId === 'rational-inequalities' && <RationalIntroduction />}

          {assessmentOnly ? <LessonAssessment key={lessonId} user={user} lessonId={lessonId} lessonPath={lessonPath} /> : chatOnly ? <TutorChat key={lessonId} user={user} lessonId={lessonId} assessmentHref={`${lessonPath}/assessment`} onProgress={(demonstratedConcepts) => {
            setData((current) => current ? { ...current, demonstratedConcepts } : current)
          }} /> : <TutorPopup key={lessonId} user={user} lessonId={lessonId} assessmentHref={`${lessonPath}/assessment`} completed={required.length > 0 && demonstrated === required.length} onProgress={(demonstratedConcepts) => {
            setData((current) => current ? { ...current, demonstratedConcepts } : current)
          }} />}
          </div>
          </div>
        </>
      ) : null}
    </main>
    </>
  )
}



function RationalIntroduction() {
  return (
    <section
      className="lesson-section lesson-reading"
      aria-labelledby="introduction-heading"
    >
      <h2 id="introduction-heading">What are rational inequalities?</h2>

      <p>
        <strong>Recall:</strong> A rational expression is the ratio of
        two polynomials, written in the form p(x)/q(x). Take note that
        q(x) must not be zero, as the expression would then be undefined.
      </p>

      <p>
        Rational inequalities are inequalities involving rational
        expressions. They compare rational expressions using the
        inequality symbols &lt;, &gt;, ≤, or ≥.
      </p>

      <p>
        Solving rational inequalities is similar to solving linear
        inequalities, except we must also exclude values that make
        the rational expression undefined. These are the values that
        make the denominator zero.
      </p>

      <h3>Steps to solving rational inequalities</h3>

      <ol>
        <li>
          <strong>Write the inequality as one quotient.</strong>
          <p>Rearrange the inequality so that one rational expression
            is on the left and zero is on the right.</p>
        </li>

        <li>
          <strong>Determine the critical numbers.</strong>
          <ul>
            <li>Find the values that make the numerator equal to zero.</li>
            <li>Find the values that make the denominator equal to zero.
              These are restrictions and are never included in the solution.</li>
          </ul>
        </li>

        <li>
          <strong>Divide the number line into intervals.</strong>
          <p>Arrange the critical numbers from least to greatest.
            Use these numbers to divide the number line into intervals.</p>
        </li>

        <li>
          <strong>Create a sign chart.</strong>
          <p>Choose a test value for each interval, including the
            intervals to the left and right of all critical numbers.
            Evaluate the expression and record whether the result is
            positive or negative.</p>
        </li>

        <li>
          <strong>Determine the solution set.</strong>
          <p>Identify the intervals where the inequality is satisfied.
            Include numerator zeros only when equality is allowed,
            and always exclude denominator restrictions.</p>
        </li>
      </ol>

      <h3>Worked example</h3>

      <p><strong>Solve:</strong></p>
      <p className="math-expression">
        (x − 4)(x + 2) / (x − 1) ≥ 0
      </p>

      <h3>Solution</h3>

      <p><strong>Step 1. Write the inequality as one quotient.</strong></p>
      <p>The inequality is already written as one rational expression
        compared with zero.</p>

      <p><strong>Step 2. Determine the critical numbers.</strong></p>
      <p>The numerator zeros and denominator restrictions are:</p>

      <div className="lesson-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Roots (Numerator)</th>
              <th>Restriction (Denominator)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>x − 4 = 0 or x + 2 = 0</td>
              <td>x − 1 = 0</td>
            </tr>
            <tr>
              <td>x = 4 or x = −2</td>
              <td>x = 1</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        Therefore, the critical numbers are −2, 1, and 4.
        Because the inequality is ≥, use closed dots for −2 and 4.
        Use an open dot for 1 because it makes the denominator zero.
      </p>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg viewBox="0 0 760 100" width="100%" role="img"
          aria-label="Critical numbers negative two, one, and four">
          <line x1="30" y1="48" x2="730" y2="48"
            stroke="currentColor" strokeWidth="2" />
          {Array.from({ length: 14 }, (_, i) => {
            const x = 55 + i * 50;
            return (
              <g key={i}>
                <line x1={x} y1="43" x2={x} y2="53"
                  stroke="currentColor" />
                <text x={x} y="72" textAnchor="middle"
                  fontSize="15" fill="currentColor">
                  {i - 6}
                </text>
              </g>
            );
          })}
          <circle cx="255" cy="48" r="7" fill="#268044" />
          <circle cx="405" cy="48" r="7" fill="none"
            stroke="#268044" strokeWidth="3" />
          <circle cx="555" cy="48" r="7" fill="#268044" />
        </svg>
      </div>

      <p><strong>Step 3. Divide the number line into intervals.</strong></p>
      <p>These critical numbers divide the number line into four intervals:</p>

      <ul>
        <li>(−∞, −2)</li>
        <li>(−2, 1)</li>
        <li>(1, 4)</li>
        <li>(4, ∞)</li>
      </ul>

      <p><strong>Step 4. Create a sign chart.</strong></p>
      <p>Use test values x = −4, 0, 2, and 6.</p>

      <div className="lesson-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Interval</th>
              <th>Test value</th>
              <th>Substitution</th>
              <th>Sign</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>(−∞, −2)</td>
              <td>−4</td>
              <td>(−8)(−2)/(−5)</td>
              <td>Negative (−)</td>
            </tr>
            <tr>
              <td>(−2, 1)</td>
              <td>0</td>
              <td>(−4)(2)/(−1)</td>
              <td>Positive (+)</td>
            </tr>
            <tr>
              <td>(1, 4)</td>
              <td>2</td>
              <td>(−2)(4)/(1)</td>
              <td>Negative (−)</td>
            </tr>
            <tr>
              <td>(4, ∞)</td>
              <td>6</td>
              <td>(2)(8)/(5)</td>
              <td>Positive (+)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p><strong>Sign chart:</strong></p>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg viewBox="0 0 760 115" width="100%" role="img"
          aria-label="Sign chart showing negative, positive, negative, and positive intervals">
          <g fontSize="22" fontWeight="bold"
            fill="currentColor" textAnchor="middle">
            <text x="155" y="25">− − −</text>
            <text x="330" y="25">+ + +</text>
            <text x="480" y="25">− − −</text>
            <text x="655" y="25">+ + +</text>
          </g>
          <line x1="30" y1="65" x2="730" y2="65"
            stroke="currentColor" strokeWidth="2" />
          {[255, 405, 555].map(x => (
            <line key={x} x1={x} y1="10" x2={x} y2="65"
              stroke="#888" strokeWidth="2" />
          ))}
          {Array.from({ length: 14 }, (_, i) => {
            const x = 55 + i * 50;
            return (
              <g key={i}>
                <line x1={x} y1="60" x2={x} y2="70"
                  stroke="currentColor" />
                <text x={x} y="90" textAnchor="middle"
                  fontSize="15" fill="currentColor">
                  {i - 6}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p><strong>Step 5. Determine the solution set.</strong></p>
      <p>
        We need the values for which the expression is positive or zero.
        Therefore, select the positive intervals and include the
        numerator zeros −2 and 4. Exclude the restriction 1.
      </p>

      <p><strong>Answer in interval notation:</strong></p>
      <p className="math-expression">
        [−2, 1) ∪ [4, ∞)
      </p>

      <p><strong>In set-builder notation:</strong></p>
      <p className="math-expression">
        {"{x ∈ ℝ | −2 ≤ x < 1 or x ≥ 4}"}
      </p>

      <p>
        <a
          href="https://math.libretexts.org/Courses/Monroe_Community_College/MTH_165_College_Algebra_MTH_175_Precalculus/03:_Polynomial_and_Rational_Functions/3.08:_Polynomial_and_Rational_Inequalities"
          target="_blank"
          rel="noopener noreferrer"
        >
          Reference: Polynomial and Rational Inequalities, LibreTexts
        </a>
      </p>
    </section>
  );
}