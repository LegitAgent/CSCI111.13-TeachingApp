export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type ChatState = {
  messages: ChatMessage[]
  revision: number
  demonstratedConcepts: string[]
  currentConcept: { id: string; title: string } | null
  completed: boolean
}

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; state: ChatState }
  | { type: 'error'; message: string }
