'use client'

import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import type { AssessmentAttempt, AssessmentData } from '@/types/assessment'
import '@/components/assessment/LessonAssessment.css'

export default function LessonAssessment({ user, lessonId, lessonPath }: {
  user: User; lessonId: string; lessonPath: string
}) {
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [reload, setReload] = useState(0)
  const active = useRef(false)
  const endpoint = `/api/lessons/${encodeURIComponent(lessonId)}/assessment`

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const token = await user.getIdToken()
        if (controller.signal.aborted) return
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (controller.signal.aborted) return
        if (response.status === 403) setLocked(true)
        if (!response.ok) throw new Error(data.error || 'Could not load your test.')
        setAttempt(data.attempt)
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load your test.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [user, endpoint, reload])

  async function send(action: 'start' | 'retry' | 'submit') {
    if (active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      const token = await user.getIdToken()
      const response = await fetch(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, attemptId: attempt?.id, answers }),
      })
      const data = await response.json()
      if (response.status === 403) setLocked(true)
      if (!response.ok) throw new Error(data.error || 'Could not save your test.')
      setAttempt((data as AssessmentData).attempt)
      if (action !== 'submit') setAnswers({})
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your test.')
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    void send('submit')
  }

  if (loading) return <p role="status">Loading your test…</p>

  return (
    <section className="lesson-section lesson-assessment" aria-labelledby="test-heading">
      <h2 id="test-heading">Problem-solving test</h2>
      {locked ? (
        <p>Finish the required concepts with your tutor to unlock this test. <Link href={lessonPath}>Return to the lesson</Link>.</p>
      ) : attempt?.status === 'submitted' ? (
        <>
          <div className="assessment-result" role="status">
            <h3>{attempt.passed ? 'Congratulations—you passed!' : 'Keep practicing—you can try again.'}</h3>
            <p>{attempt.results.filter((result) => result.correct).length} / {attempt.questions.length} correct · <strong>{attempt.score}%</strong></p>
            <p>{attempt.passed ? 'You have completed both the conceptual section and the test. This lesson is mastered.' : `You need ${attempt.passingScorePercent}% to pass. Review the feedback below before your next attempt.`}</p>
          </div>
          <ol className="assessment-questions">
            {attempt.questions.map((question) => {
              const result = attempt.results.find((item) => item.questionId === question.id)
              return (
                <li key={question.id}>
                  <h3>{question.prompt}</h3>
                  <p><strong>{result?.correct ? 'Correct' : 'Incorrect'}</strong></p>
                  <p>Your answer: {result?.answer}</p>
                  <p>Correct answer: {result?.correctAnswer}</p>
                  <p>{result?.explanation}</p>
                </li>
              )
            })}
          </ol>
          <button type="button" disabled={busy} onClick={() => void send('retry')}>{busy ? 'Preparing test…' : 'Try a new attempt'}</button>
          <Link className="assessment-back" href={lessonPath}>Back to lesson</Link>
        </>
      ) : attempt ? (
        <form onSubmit={handleSubmit}>
          <p>Answer all {attempt.questions.length} questions. Score at least {attempt.passingScorePercent}% to pass.</p>
          <p>Use interval notation: <strong>(-infinity, -2) U [3, infinity)</strong>. You can also write <strong>-inf</strong> or <strong>-∞</strong>. A single point can be written as <strong>{'{3}'}</strong> or <strong>[3,3]</strong>; the shorthand <strong>[3]</strong> is also accepted. Use <strong>∅</strong> for an empty set. Fractions such as <strong>-1/4</strong> are accepted.</p>
          <ol className="assessment-questions">
            {attempt.questions.map((question, index) => (
              <li key={question.id}>
                <label htmlFor={`answer-${index}`}><strong>{question.prompt}</strong></label>
                <input id={`answer-${index}`} type="text" autoComplete="off" required maxLength={500} disabled={busy}
                  value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
              </li>
            ))}
          </ol>
          <button type="submit" disabled={busy}>{busy ? 'Grading your answers…' : 'Submit test'}</button>
        </form>
      ) : !error ? (
        <>
          <p>Congratulations on completing the conceptual section. Put your understanding into practice with five questions.</p>
          <button type="button" disabled={busy} onClick={() => void send('start')}>{busy ? 'Preparing test…' : 'Start my test'}</button>
        </>
      ) : null}
      {error && <p role="alert" className="assessment-error">{error}</p>}
      {!locked && error && !attempt && <button type="button" disabled={busy} onClick={() => {
        setLoading(true); setError(''); setReload((value) => value + 1)
      }}>Try again</button>}
    </section>
  )
}
