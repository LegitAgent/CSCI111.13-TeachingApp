'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

type RecognitionResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function recognitionConstructor() {
  if (typeof window === 'undefined') return undefined
  const browser = window as Window & {
    SpeechRecognition?: new () => Recognition
    webkitSpeechRecognition?: new () => Recognition
  }
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition
}

const subscribe = () => () => {}
const supportedInBrowser = () => Boolean(recognitionConstructor())

export function useTutorDictation(active: boolean, onTranscript: (text: string) => void) {
  const supported = useSyncExternalStore(subscribe, supportedInBrowser, () => false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recognition = useRef<Recognition | null>(null)
  const keepListening = useRef(false)
  const restartTimer = useRef<number | null>(null)
  const transcriptCallback = useRef(onTranscript)
  useEffect(() => { transcriptCallback.current = onTranscript }, [onTranscript])

  const abort = useCallback(() => {
    keepListening.current = false
    if (restartTimer.current !== null) {
      window.clearTimeout(restartTimer.current)
      restartTimer.current = null
    }
    const current = recognition.current
    recognition.current = null
    if (current) {
      current.onresult = null
      current.onerror = null
      current.onend = null
      try { current.abort() } catch { /* Recognition has already ended. */ }
    }
    setListening(false)
  }, [])

  const stop = useCallback(() => {
    keepListening.current = false
    if (restartTimer.current !== null) {
      window.clearTimeout(restartTimer.current)
      restartTimer.current = null
    }
    // stop() allows the final result to arrive; abort() is for closing the chat.
    if (!recognition.current) setListening(false)
    else try { recognition.current.stop() } catch { abort() }
  }, [abort])

  const start = useCallback((existingDraft: string) => {
    const Constructor = recognitionConstructor()
    if (!active || !Constructor || recognition.current || keepListening.current || existingDraft.length >= 3000) return
    if (!window.isSecureContext) {
      setError('Microphone input requires HTTPS or localhost. You can still type your answer.')
      return
    }
    setError('')
    keepListening.current = true
    setListening(true)
    // Each browser session starts from the last visible transcript, including pauses.
    let latestDraft = existingDraft
    function beginSession() {
      if (!keepListening.current || !Constructor) return
      const prefix = latestDraft
      let restartDelay = 300
      const current = new Constructor()
      current.lang = 'en-US'
      current.continuous = true
      current.interimResults = true
      current.maxAlternatives = 1
      recognition.current = current
      current.onresult = (event) => {
        if (recognition.current !== current) return
        // Results contain the whole session, including revised interim text.
        // Rebuild from the original draft so repeated events never duplicate words.
        const spoken = Array.from(event.results, (result) => result[0]?.transcript ?? '').join(' ').trim()
        const text = [prefix.trimEnd(), spoken].filter(Boolean).join(' ')
        latestDraft = text.slice(0, 3000)
        transcriptCallback.current(latestDraft)
        if (text.length >= 3000) stop()
      }
      current.onend = () => {
        if (recognition.current !== current) return
        recognition.current = null
        if (keepListening.current) {
          restartTimer.current = window.setTimeout(() => {
            restartTimer.current = null
            beginSession()
          }, restartDelay)
        } else setListening(false)
      }
      current.onerror = (event) => {
        if (recognition.current !== current) return
        // Silence is a pause, not a request to turn the microphone off.
        if (event.error === 'no-speech') {
          restartDelay = 1000
          return
        }
        const messages: Record<string, string> = {
          'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser’s site settings, then try again.',
          'service-not-allowed': 'Speech recognition is blocked by your browser. You can type your answer instead.',
          'audio-capture': 'No working microphone was found. Check your microphone connection and system settings.',
          network: 'The speech recognition service could not connect. Check your connection or type your answer.',
          'language-not-supported': 'English dictation is unavailable in this browser. You can type your answer instead.',
        }
        if (event.error !== 'aborted') setError(messages[event.error] ?? 'Could not transcribe your speech. Try again or type your answer.')
        abort()
      }
      try { current.start() } catch {
        abort()
        setError('The microphone could not start. Check your browser permissions and try again.')
      }
    }
    beginSession()
  }, [active, abort, stop])

  useEffect(() => {
    if (!active) return
    return () => abort()
  }, [active, abort])

  return { supported, listening, error, start, stop, abort }
}
