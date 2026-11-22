'use client'

import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import type { User } from 'firebase/auth'
import type { ChatEvent, ChatState } from './chatData'
import './TutorChat.css'

export default function TutorChat({ user, lessonId, onProgress }: {
  user: User
  lessonId: string
  onProgress: (conceptIds: string[]) => void
}) {
  const [state, setState] = useState<ChatState | null>(null)
  const [draft, setDraft] = useState('')
  const [answering, setAnswering] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [streamingReply, setStreamingReply] = useState('')
  const [submitted, setSubmitted] = useState('')
  const activeRequest = useRef<AbortController | null>(null)
  const retry = useRef<{ message: string; requestId: string; revision: number } | null>(null)
  const messageList = useRef<HTMLOListElement | null>(null)
  const progressCallback = useRef(onProgress)
  useEffect(() => { progressCallback.current = onProgress }, [onProgress])
  const endpoint = `/api/lessons/${encodeURIComponent(lessonId)}/chat`

  useEffect(() => {
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight
  }, [state?.messages, streamingReply, submitted])

  useEffect(() => {
    const controller = new AbortController()
    activeRequest.current?.abort()
    retry.current = null

    async function load() {
      try {
        const token = await user.getIdToken()
        if (controller.signal.aborted) return
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load the conversation.')
        if (!controller.signal.aborted) {
          setState(data)
          progressCallback.current(data.demonstratedConcepts)
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load the conversation.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => { controller.abort(); activeRequest.current?.abort() }
  }, [user, endpoint, attempt])

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state || state.completed || answering || activeRequest.current || !draft.trim()) return
    const controller = new AbortController()
    activeRequest.current = controller
    const answer = draft.trim()
    const turn = retry.current?.message === answer && retry.current.revision === state.revision
      ? retry.current : { message: answer, requestId: crypto.randomUUID(), revision: state.revision }
    retry.current = turn
    setAnswering(true)
    setError('')
    setStreamingReply('')
    setSubmitted(answer)
    let completed = false

    try {
      const token = await user.getIdToken()
      if (controller.signal.aborted) return
      const response = await fetch(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(turn), signal: controller.signal,
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Could not send your answer.')
      }
      // A replay of a previously saved request returns its latest state directly.
      if (response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.json()
        setState(data.state)
        setSubmitted('')
        setAnswering(false)
        progressCallback.current(data.state.demonstratedConcepts)
        completed = true
      } else {
        if (!response.body) throw new Error('The tutor connection did not start.')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        function receive(line: string) {
          if (!line.trim()) return
          const event = JSON.parse(line) as ChatEvent
          if (event.type === 'delta') setStreamingReply((text) => text + event.text)
          if (event.type === 'error') throw new Error(event.message)
          if (event.type === 'done') {
            completed = true
            setState(event.state)
            setSubmitted('')
            setAnswering(false)
            progressCallback.current(event.state.demonstratedConcepts)
          }
        }
        try {
          while (true) {
            const { value, done } = await reader.read()
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
            let newline: number
            while ((newline = buffer.indexOf('\n')) !== -1) {
              receive(buffer.slice(0, newline))
              buffer = buffer.slice(newline + 1)
            }
            if (done) break
          }
          if (buffer.trim()) receive(buffer)
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      }
      if (!completed) throw new Error('The connection ended before your answer was saved. Retry or reload the conversation.')
      setDraft('')
      retry.current = null
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not send your answer.')
    } finally {
      if (!controller.signal.aborted) {
        setAnswering(false)
        setStreamingReply('')
        setSubmitted('')
      }
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  return (
    <section className="lesson-section tutor-chat" aria-labelledby="tutor-heading">
      <div className="dashboard-lesson-heading">
        <h2 id="tutor-heading">Let’s think it through</h2>
        {state?.currentConcept && <span className="dashboard-status">{state.currentConcept.title}</span>}
      </div>
      {loading ? <p role="status">Loading your conversation…</p> : (
        <>
          {state && (
            <>
              <p>Explain your reasoning in your own words. You can ask for a hint or clarification.</p>
              <p className="tutor-history-note">Your recent conversation is shown below. Completed replies are saved automatically.</p>
              <ol ref={messageList} className="tutor-messages" aria-label="Conversation with your tutor" tabIndex={0}>
                {state.messages.map((message) => (
                  <li className={`tutor-message tutor-message-${message.role}`} key={message.id}>
                    <strong>{message.role === 'user' ? 'You' : 'Tutor'}</strong>
                    <p>{message.content}</p>
                  </li>
                ))}
                {submitted && (
                  <li className="tutor-message tutor-message-user"><strong>You</strong><p>{submitted}</p></li>
                )}
                {answering && (
                  <li className="tutor-message tutor-message-assistant"><strong>Tutor</strong><p>{streamingReply || 'Thinking…'}</p></li>
                )}
              </ol>
              {state.completed ? <p role="status" className="tutor-complete">All required concepts demonstrated. Your conceptual section is complete.</p> : (
                <form className="tutor-form" onSubmit={handleSubmit}>
                  <label htmlFor="tutor-answer">Your answer</label>
                  <textarea id="tutor-answer" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={3000} rows={3} required disabled={answering} />
                  <div className="tutor-actions">
                    <button type="submit" disabled={answering || !draft.trim()}>{answering ? 'Tutor is replying…' : 'Send answer'}</button>
                    <span>{draft.length} / 3000</span>
                  </div>
                  <span className="tutor-status" role="status">{answering ? 'Receiving your tutor’s response…' : ''}</span>
                </form>
              )}
            </>
          )}
          {error && <p role="alert" className="tutor-error">{error}</p>}
          {(error || state) && <button className="tutor-reload" type="button" disabled={answering} onClick={() => {
            setLoading(true)
            setError('')
            setState(null)
            setAttempt((value) => value + 1)
          }}>Reload conversation</button>}
        </>
      )}
    </section>
  )
}
