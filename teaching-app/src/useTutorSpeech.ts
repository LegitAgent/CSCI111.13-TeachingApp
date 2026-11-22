'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatMessage } from './chatData'

const subscribe = () => () => {}
const supportedInBrowser = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

function spokenText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`#]/g, '')
    .replace(/≤|<=/g, ' less than or equal to ')
    .replace(/≥|>=/g, ' greater than or equal to ')
    .replace(/≠|!=/g, ' not equal to ')
    .replace(/</g, ' less than ')
    .replace(/>/g, ' greater than ')
    .replace(/=/g, ' equals ')
    .replace(/−/g, ' minus ')
    .replace(/∞/g, ' infinity ')
    .replace(/∪/g, ' union ')
    .replace(/∩/g, ' intersection ')
    .replace(/∅/g, ' empty set ')
    .replace(/²/g, ' squared ')
    .replace(/³/g, ' cubed ')
    .replace(/\s+/g, ' ').trim()
}

export function useTutorSpeech(active: boolean) {
  const supported = useSyncExternalStore(subscribe, supportedInBrowser, () => false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = useCallback(() => {
    if (utterance.current && supportedInBrowser()) {
      utterance.current = null
      window.speechSynthesis.cancel()
    }
    setSpeakingId(null)
  }, [])

  const speak = useCallback((message: ChatMessage) => {
    if (!supported || !active || message.role !== 'assistant') return
    stop()
    setError('')
    const request = new SpeechSynthesisUtterance(spokenText(message.content))
    const voices = window.speechSynthesis.getVoices()
    const voice = voices.find((voice) => voice.localService && /^en\b/i.test(voice.lang))
      ?? voices.find((voice) => /^en\b/i.test(voice.lang))
    if (voice) request.voice = voice
    request.lang = voice?.lang ?? 'en-US'
    request.rate = 1
    utterance.current = request
    setSpeakingId(message.id)
    request.onend = () => {
      if (utterance.current !== request) return
      utterance.current = null
      setSpeakingId(null)
    }
    request.onerror = (event) => {
      if (utterance.current !== request) return
      utterance.current = null
      setSpeakingId(null)
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        setError('Audio could not play. Try the Read aloud button, or check your browser’s speech settings.')
      }
    }
    try { window.speechSynthesis.speak(request) } catch {
      utterance.current = null
      setSpeakingId(null)
      setError('Audio could not play in this browser. You can continue reading the conversation.')
    }
  }, [active, supported, stop])

  useEffect(() => {
    if (!active) return
    return () => stop()
  }, [active, stop])

  return { supported, speakingId, error, speak, stop }
}
