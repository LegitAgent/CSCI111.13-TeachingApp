'use client'

import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { redirect, useRouter } from 'next/navigation'
import { auth } from '@app-firebase/config'
import { getDashboardPath, getUsername } from './dashboardPath'
import type { DashboardData } from './dashboardData'
import './LoginPage.css'
import './DashboardPage.css'

function DashboardPage({ dashboardSlug }: { dashboardSlug: string }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [message, setMessage] = useState('')
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [isSigningOut, setIsSigningOut] = useState(false)

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
        if (!controller.signal.aborted) setDashboard(data)
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

  async function handleSignOut() {
    setIsSigningOut(true)
    setMessage('')
    try {
      await signOut(auth)
      router.replace('/login')
    } catch {
      setMessage('Could not sign out. Please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  if (isCheckingAuth) {
    return <main className="login-page"><p role="status">Checking sign-in status...</p></main>
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

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-brand">PreCalPal</p>
          <h1>Hello {getUsername(user)}</h1>
          <p>Your inequalities learning plan.</p>
        </div>
        <button type="button" onClick={handleSignOut} disabled={isSigningOut}>
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>
      {message && <p role="alert">{message}</p>}

      <section aria-labelledby="lessons-heading" aria-busy={isLoading}>
        <h2 id="lessons-heading">Your lessons</h2>
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
              {dashboard.lessons.filter((lesson) => lesson.progress?.mastered).length} of {dashboard.lessons.length} lessons mastered
            </p>
            <ol className="dashboard-lessons">
              {dashboard.lessons.map((lesson) => {
                const progress = lesson.progress
                const status = progress?.mastered ? 'Mastered' : !progress ? 'Not started'
                  : progress.stage === 'assessment' ? 'Assessment' : 'In progress'

                return (
                  <li key={lesson.id}>
                    <article className="dashboard-lesson">
                      <div className="dashboard-lesson-heading">
                        <h3>{lesson.title}</h3>
                        <span className="dashboard-status">{status}</span>
                      </div>
                      <p>{lesson.description}</p>
                      <dl className="dashboard-metrics">
                        <div><dt>Concepts demonstrated</dt><dd>{progress?.demonstratedConceptCount ?? 0} / {lesson.requiredConceptCount}</dd></div>
                        <div><dt>Best assessment score</dt><dd>{progress?.bestScore == null ? 'Not assessed' : `${progress.bestScore}%`}</dd></div>
                        <div><dt>Assessment target</dt><dd>{lesson.passingScorePercent}%</dd></div>
                      </dl>
                    </article>
                  </li>
                )
              })}
            </ol>
          </>
        ) : null}
      </section>
    </main>
  )
}

export default DashboardPage
