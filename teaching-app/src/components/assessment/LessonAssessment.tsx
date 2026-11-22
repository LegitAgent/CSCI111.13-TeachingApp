'use client'

import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import type { AssessmentAttempt, AssessmentData } from '@/types/assessment'
import { getDashboardPath } from '@/lib/dashboardPath'
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
      <h2 id="test-heading">{attempt?.status === 'submitted' ? 'Look how far you’ve come.' : 'Your turn to put it together.'}</h2>
      {locked ? (
        <p>Finish the required concepts with your tutor to unlock this test. <Link href={lessonPath}>Return to the lesson</Link>.</p>
      ) : attempt?.status === 'submitted' ? (
        <>
          <div className={`assessment-results-grid${attempt.passed ? ' assessment-passed' : ''}`} role="status">
            <div className="assessment-score-card">
              <p className="eyebrow">YOUR ASSESSMENT</p>
              <h3>Problem-solving score</h3>
              <div className="assessment-score-ring" role="img" aria-label={`${attempt.score}% assessment score`}>
                <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="score-ring-track" cx="60" cy="60" r="52" /><circle className="score-ring-fill" cx="60" cy="60" r="52" pathLength="100" strokeDasharray={`${attempt.score ?? 0} 100`} /></svg>
                <div><strong>{attempt.score}<span>%</span></strong><span>{attempt.passed ? 'You did it!' : 'Keep growing'}</span></div>
              </div>
              <p>{attempt.results.filter((result) => result.correct).length} of {attempt.questions.length} questions correct</p>
              <span className="assessment-score-badge">{attempt.passed ? '✓ Lesson mastered' : `Passing target: ${attempt.passingScorePercent}%`}</span>
            </div>
            <div className="assessment-feedback-card">
              <p className="eyebrow">A NOTE FROM YOUR PAL</p>
              <h3>PreCalPal says…</h3>
              <p className="assessment-feedback-lead">{attempt.passed ? 'That practice paid off.' : 'You’re building something good.'}</p>
              <p>{attempt.passed ? 'You’ve demonstrated the concepts and met the problem-solving target. Take a moment to celebrate—you earned it.' : `You’ve demonstrated the concepts. Your score is ${attempt.score}%; the next step is reaching ${attempt.passingScorePercent}% on problem solving. Review the questions below and give it another go.`}</p>
              <dl className="assessment-feedback-metrics">
                <div><dt>Conceptual understanding</dt><dd><span aria-hidden="true">✓ </span>Required concepts demonstrated</dd></div>
                <div><dt>Applying what you know</dt><dd>{attempt.passed ? 'Passing target reached' : 'More practice will help'}</dd></div>
              </dl>
            </div>
          </div>
          <div className="assessment-result-actions">
            {attempt.passed && <Link className="dashboard-link" href={getDashboardPath(user) ?? lessonPath}>Celebrate on your dashboard <span aria-hidden="true">→</span></Link>}
            <button type="button" disabled={busy} onClick={() => void send('retry')}>{busy ? 'Preparing test…' : 'Try a new attempt'}</button>
            <Link className="assessment-back" href={lessonPath}>Review lesson</Link>
          </div>
          <details className="assessment-review" open={!attempt.passed}>
          <summary>Review your answers <span>{attempt.questions.length} questions</span></summary>
          <ol className="assessment-questions">
            {attempt.questions.map((question, index) => {
              const result = attempt.results.find((item) => item.questionId === question.id)
              return (
                <li className={result?.correct ? 'assessment-answer-correct' : 'assessment-answer-incorrect'} key={question.id}>
                  <p className="assessment-question-number">QUESTION {index + 1} <span>{result?.correct ? '✓ Correct' : 'Review this one'}</span></p>
                  <h3>{question.prompt}</h3>
                  <p><strong>{result?.correct ? 'Correct' : 'Incorrect'}</strong></p>
                  <p>Your answer: {result?.answer}</p>
                  <p>Correct answer: {result?.correctAnswer}</p>
                  <p>{result?.explanation}</p>
                </li>
              )
            })}
          </ol>
          </details>
        </>
      ) : attempt ? (
        <form onSubmit={handleSubmit}>
          <p className="assessment-instructions">Take your time. Answer all {attempt.questions.length} questions and score at least <strong>{attempt.passingScorePercent}%</strong> to pass.</p>
          <div className="assessment-completion"><span>{attempt.questions.filter((question) => answers[question.id]?.trim()).length} of {attempt.questions.length} answered</span><progress max={attempt.questions.length} value={attempt.questions.filter((question) => answers[question.id]?.trim()).length} aria-label="Questions answered" /></div>
          <details className="assessment-notation"><summary>A quick guide to answer notation</summary><p id="notation-help">Use interval notation: <strong>(-infinity, -2) U [3, infinity)</strong>. You can also write <strong>-inf</strong> or <strong>-∞</strong>. A single point can be written as <strong>{'{3}'}</strong> or <strong>[3,3]</strong>; the shorthand <strong>[3]</strong> is also accepted. Use <strong>∅</strong> for an empty set. Fractions such as <strong>-1/4</strong> are accepted.</p></details>
          <ol className="assessment-questions">
            {attempt.questions.map((question, index) => (
              <li key={question.id}>
                <p className="assessment-question-number">QUESTION {index + 1}</p>
                <h3 id={`question-${index}`}>{question.prompt}</h3>
                <label htmlFor={`answer-${index}`}>Your solution</label>
                <input id={`answer-${index}`} aria-describedby={`question-${index}`} placeholder="e.g. (-inf, 2) U {3}" type="text" autoComplete="off" required maxLength={500} disabled={busy}
                  value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
              </li>
            ))}
          </ol>
          <div className="assessment-submit"><p>Ready? Let’s see what you’ve learned.</p><button type="submit" disabled={busy}>{busy ? 'Grading your answers…' : 'Submit my answers'} <span aria-hidden="true">→</span></button></div>
        </form>
      ) : !error ? (
        <>
          <p className="assessment-start-copy">You’ve explored the ideas with your tutor. Now try five questions on your own to see how they fit together.</p>
          <div className="assessment-start-info"><span>5 practice problems</span><span>At your own pace</span><span>Feedback after submission</span></div>
          <button className="assessment-start-button" type="button" disabled={busy} onClick={() => void send('start')}>{busy ? 'Preparing test…' : 'Let’s give it a go'} <span aria-hidden="true">→</span></button>
        </>
      ) : null}
      {error && <p role="alert" className="assessment-error">{error}</p>}
      {!locked && error && !attempt && <button type="button" disabled={busy} onClick={() => {
        setLoading(true); setError(''); setReload((value) => value + 1)
      }}>Try again</button>}
    </section>
  )
}
