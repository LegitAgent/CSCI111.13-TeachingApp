'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import TutorChat from './TutorChat'

export default function TutorPopup({ user, lessonId, onProgress }: {
  user: User
  lessonId: string
  onProgress: (conceptIds: string[]) => void
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
        <h2 id="lesson-ready-heading">Are you ready to start?</h2>
        <p>Let’s work through the ideas together. Your tutor will ask one question at a time, and you can ask for a hint whenever you need one.</p>
        <button className="lesson-start-chat" type="button" aria-haspopup="dialog" onClick={() => {
          setStarted(true)
          setOpen(true)
        }}>{started ? 'Continue with my tutor' : 'Yes, let’s start'}</button>
      </section>

      <dialog ref={dialog} className="tutor-popup" aria-labelledby="tutor-popup-title" onClose={() => setOpen(false)}>
        <header className="tutor-popup-header">
          <h2 id="tutor-popup-title">Your PreCalPal tutor</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close tutor chat">Close ✕</button>
        </header>
        {started && <TutorChat user={user} lessonId={lessonId} onProgress={onProgress} />}
      </dialog>
    </>
  )
}
