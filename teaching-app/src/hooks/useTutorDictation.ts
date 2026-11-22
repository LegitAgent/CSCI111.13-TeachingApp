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
  const transcriptCallback = useRef(onTranscript)
  useEffect(() => { transcriptCallback.current = onTranscript }, [onTranscript])

  const abort = useCallback(() => {
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
    // stop() allows the final result to arrive; abort() is for closing the chat.
    try { recognition.current?.stop() } catch { abort() }
  }, [abort])

  const start = useCallback((existingDraft: string) => {
    const Constructor = recognitionConstructor()
    if (!active || !Constructor || recognition.current || existingDraft.length >= 3000) return
    if (!window.isSecureContext) {
      setError('Microphone input requires HTTPS or localhost. You can still type your answer.')
      return
    }
    setError('')
    const current = new Constructor()
    current.lang = 'en-US'
    current.continuous = false
    current.interimResults = true
    current.maxAlternatives = 1
    recognition.current = current
    current.onresult = (event) => {
      if (recognition.current !== current) return
      // Results contain the whole session, including revised interim text.
      // Rebuild from the original draft so repeated events never duplicate words.
      const spoken = Array.from(event.results, (result) => result[0]?.transcript ?? '').join(' ').trim()
      const text = [existingDraft.trimEnd(), spoken].filter(Boolean).join(' ')
      transcriptCallback.current(text.slice(0, 3000))
      if (text.length >= 3000) current.stop()
    }
    current.onend = () => {
      if (recognition.current !== current) return
      recognition.current = null
      setListening(false)
    }
    current.onerror = (event) => {
      if (recognition.current !== current) return
      const messages: Record<string, string> = {
        'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser’s site settings, then try again.',
        'service-not-allowed': 'Speech recognition is blocked by your browser. You can type your answer instead.',
        'audio-capture': 'No working microphone was found. Check your microphone connection and system settings.',
        'no-speech': 'No speech was detected. Try the microphone again and speak clearly.',
        network: 'The speech recognition service could not connect. Check your connection or type your answer.',
        'language-not-supported': 'English dictation is unavailable in this browser. You can type your answer instead.',
      }
      if (event.error !== 'aborted') setError(messages[event.error] ?? 'Could not transcribe your speech. Try again or type your answer.')
      abort()
    }
    setListening(true)
    try { current.start() } catch {
      abort()
      setError('The microphone could not start. Check your browser permissions and try again.')
    }
  }, [active, abort])

  useEffect(() => {
    if (!active) return
    return () => abort()
  }, [active, abort])

  return { supported, listening, error, start, stop, abort }
}
