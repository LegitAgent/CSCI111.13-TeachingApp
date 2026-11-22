'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import TutorChat from '@/components/tutor/TutorChat'
import Link from 'next/link'

export default function TutorPopup({ user, lessonId, onProgress, assessmentHref, completed }: {
  user: User
  lessonId: string
  onProgress: (conceptIds: string[]) => void
  assessmentHref: string
  completed: boolean
}) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const [open, setOpen] = useState(false)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!open || !element) return
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <>
      <section className="lesson-section lesson-ready" aria-labelledby="lesson-ready-heading">
        <span className="lesson-ready-spark" aria-hidden="true">✧</span>
        <p className="eyebrow">YOUR PAL IS READY WHEN YOU ARE</p>
        <h2 id="lesson-ready-heading">{completed ? 'You’ve got the ideas. Now put them to work.' : 'Let’s make sense of it, together.'}</h2>
        <p>{completed ? 'You have demonstrated every required concept. Now put your understanding into practice.' : 'Let’s work through the ideas together. Your tutor will ask one question at a time, and you can ask for a hint whenever you need one.'}</p>
        {completed && <Link className="dashboard-link" href={assessmentHref}>Continue to test →</Link>}
        <button className="lesson-start-chat" type="button" aria-haspopup="dialog" onClick={() => {
          setStarted(true)
          setOpen(true)
        }}>{completed ? 'Review tutor conversation' : started ? 'Continue with my tutor' : 'Yes, let’s start'}</button>
        <Link className="lesson-full-chat" href={assessmentHref.replace(/\/assessment$/, '/chat')}>Open a full conversation <span aria-hidden="true">↗</span></Link>
      </section>

      <dialog ref={dialog} className="tutor-popup" aria-labelledby="tutor-popup-title" onClose={() => setOpen(false)}>
        <header className="tutor-popup-header">
          <h2 id="tutor-popup-title">Your PreCalPal tutor</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close tutor chat">Close ✕</button>
        </header>
        {started && <TutorChat user={user} lessonId={lessonId} onProgress={onProgress} assessmentHref={assessmentHref} active={open} />}
      </dialog>
    </>
  )
}
