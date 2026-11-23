'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { redirect } from 'next/navigation'
import { auth } from '@app-firebase/config'
import { getDashboardPath, getUsername } from '@/lib/dashboardPath'
import type { DashboardData } from '@/types/dashboard'
import DashboardConfetti from './DashboardConfetti'
import AppHeader from '@/components/layout/AppHeader'
import '@/components/dashboard/DashboardPage.css'

function DashboardPage({ dashboardSlug }: { dashboardSlug: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [celebration, setCelebration] = useState<string[]>([])

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setIsCheckingAuth(false)
    })
  }, [])

  useEffect(() => {
    if (!user || getDashboardPath(user) !== `/${dashboardSlug}`) return

    const controller = new AbortController()

    async function loadDashboard(currentUser: User) {
      setIsLoading(true)
      setLoadError('')
      setDashboard(null)
      setCelebration([])

      try {
        const token = await currentUser.getIdToken()
        if (controller.signal.aborted) return

        const response = await fetch('/api/dashboard', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Could not load your dashboard.')
        }
        if (!controller.signal.aborted) {
          const dashboardData = data as DashboardData
          const masteredIds = dashboardData.lessons.filter((lesson) => lesson.progress?.mastered).map((lesson) => lesson.id)
          let celebratedIds: string[] = []
          const storageKey = `precalpal:celebrated:${currentUser.uid}`
          try {
            const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
            if (Array.isArray(stored)) celebratedIds = stored.filter((id): id is string => typeof id === 'string')
          } catch { /* Celebration still works when browser storage is unavailable. */ }
          setCelebration(masteredIds.filter((id) => !celebratedIds.includes(id)))
          setDashboard(dashboardData)
          try {
            localStorage.setItem(storageKey, JSON.stringify([...new Set([...celebratedIds, ...masteredIds])]))
          } catch { /* Saving learning progress does not depend on this visual preference. */ }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : 'Could not load your dashboard.')
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void loadDashboard(user)
    return () => controller.abort()
  }, [user, dashboardSlug, loadAttempt])

  if (isCheckingAuth) {
    return <main className="page-loading"><p role="status">Getting your learning space ready…</p></main>
  }

  if (!user) {
    redirect('/login')
  }

  const dashboardPath = getDashboardPath(user)

  if (!dashboardPath) {
    redirect('/signup')
  }

  if (`/${dashboardSlug}` !== dashboardPath) {
    redirect(dashboardPath)
  }

  const masteredLessons = dashboard?.lessons.filter((lesson) => lesson.progress?.mastered) ?? []
  const allMastered = !!dashboard?.lessons.length && masteredLessons.length === dashboard.lessons.length
  const celebratedLesson = dashboard?.lessons.find((lesson) => celebration.includes(lesson.id))

  return (
    <>
    <AppHeader user={user} />
    <main id="main-content" className={`dashboard-page${masteredLessons.length ? ' dashboard-page-celebrating' : ''}`}>
      {celebration.length > 0 && <DashboardConfetti key={celebration.join(',')} />}
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">YOUR LEARNING SPACE</p>
          <h1>Hey, {getUsername(user)}<span className="dashboard-greeting-dot">.</span></h1>
          <p>A little practice today. A little more confidence tomorrow.</p>
        </div>
        <span className="dashboard-course-tag">University precalculus <span aria-hidden="true">↗</span></span>
      </header>

      <div className="dashboard-layout">
      <aside className="dashboard-profile" aria-label="Your learning profile">
        <div className="profile-avatar" aria-hidden="true">{getUsername(user)?.slice(0, 1).toUpperCase()}</div>
        <h2>@{getUsername(user)}</h2>
        <p className="profile-role">Precalculus explorer</p>
        <div className="profile-divider" />
        <p className="eyebrow">A NOTE FOR YOUR JOURNEY</p>
        <p className="profile-note">You don’t have to know it all.<br />You just have to start.</p>
        <div className="profile-stats">
          <div><strong>{masteredLessons.length}</strong><span>Mastered</span></div>
          <div><strong>{dashboard?.lessons.length ?? '—'}</strong><span>Available</span></div>
        </div>
        <div className="profile-tip"><span aria-hidden="true">✧</span><p>Stuck on an idea? Your tutor can break it into smaller steps.</p></div>
      </aside>
      <div className="dashboard-main">

      {masteredLessons.length > 0 && (
        <section className="dashboard-celebration" aria-labelledby="celebration-heading" role="status">
          <span className="dashboard-celebration-star" aria-hidden="true">✦</span>
          <div>
            <p className="dashboard-celebration-eyebrow">You earned this</p>
            <h2 id="celebration-heading">{allMastered ? 'Learning plan complete. Look at you go!' : celebratedLesson && celebration.length === 1
              ? `You mastered ${celebratedLesson.title}!` : 'Your hard work is adding up!'}</h2>
            <p>{allMastered ? 'Every lesson mastered. Take a moment to celebrate how far you’ve come.'
              : `${masteredLessons.length} ${masteredLessons.length === 1 ? 'lesson mastered' : 'lessons mastered'} through understanding and practice. Keep that momentum going.`}</p>
            <span className="dashboard-celebration-badge">{masteredLessons.length} / {dashboard?.lessons.length} lessons mastered</span>
          </div>
        </section>
      )}

      <section aria-labelledby="lessons-heading" aria-busy={isLoading}>
        <div className="dashboard-section-heading"><div><p className="eyebrow">ONE IDEA AT A TIME</p><h2 id="lessons-heading">Your learning plan</h2></div><span className="dashboard-subject">Inequalities</span></div>
        {isLoading ? <p role="status">Loading your lessons…</p> : loadError ? (
          <div className="dashboard-notice">
            <p role="alert">{loadError}</p>
            <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button>
          </div>
        ) : dashboard && dashboard.lessons.length === 0 ? (
          <p className="dashboard-notice">No lessons are available yet. Check back soon.</p>
        ) : dashboard ? (
          <>
            <p className="dashboard-summary">
              Pick up where you left off, or explore something new.
            </p>
            <ol className="dashboard-lessons">
              {dashboard.lessons.map((lesson, index) => {
                const progress = lesson.progress
                const status = progress?.mastered ? 'Mastered' : !progress ? 'Not started'
                  : progress.stage === 'assessment' ? 'Assessment' : 'In progress'
                const conceptPercent = lesson.requiredConceptCount > 0
                  ? Math.min(100, Math.round((progress?.demonstratedConceptCount ?? 0) / lesson.requiredConceptCount * 100)) : 0

                return (
                  <li key={lesson.id}>
                    <article className={`dashboard-lesson${progress?.mastered ? ' dashboard-lesson-mastered' : ''}`}>
                      <div className="dashboard-lesson-art" aria-hidden="true"><span>{['x ≥ a', 'f(x)', 'a < x < b', 'x²', 'log x'][index % 5]}</span><small>PRECALCULUS</small></div>
                      <div className="dashboard-lesson-body">
                      <div className="dashboard-lesson-heading">
                        <p className="dashboard-lesson-number">LESSON {index + 1 < 10 ? '0' : ''}{index + 1}</p>
                        <span className="dashboard-status">{progress?.mastered && <span aria-hidden="true">✦ </span>}{status}</span>
                      </div>
                      <h3><Link href={`${dashboardPath}/lessons/${encodeURIComponent(lesson.id)}`}>{lesson.title}</Link></h3>
                      <p>{lesson.description}</p>
                      <div className="dashboard-progress-label"><span>Concept practice</span><strong>{conceptPercent}%</strong></div>
                      <progress className="dashboard-progress" aria-label={`${lesson.title}: concepts demonstrated`} value={conceptPercent} max={100} />
                      <dl className="dashboard-metrics">
                        {/* Hello this a practice comment */}
                        <div><dt>Concepts demonstrated</dt><dd>{progress?.demonstratedConceptCount ?? 0} / {lesson.requiredConceptCount}</dd></div>
                        <div><dt>Best assessment score</dt><dd>{progress?.bestScore == null ? 'Not assessed' : `${progress.bestScore}%`}</dd></div>
                        <div><dt>Passing target</dt><dd>{lesson.passingScorePercent}%</dd></div>
                      </dl>
                      <Link className="dashboard-link" href={`${dashboardPath}/lessons/${encodeURIComponent(lesson.id)}`}>
                        {progress?.mastered ? 'Review lesson' : progress ? 'Continue lesson' : 'Start lesson'} <span aria-hidden="true">→</span>
                      </Link>
                      </div>
                    </article>
                  </li>
                )
              })}
            </ol>
          </>
        ) : null}
      </section>
      </div>
      </div>
    </main>
    </>
  )
}

export default DashboardPage
