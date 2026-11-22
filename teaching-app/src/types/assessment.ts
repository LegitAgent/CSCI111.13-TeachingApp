export type AssessmentQuestion = { id: string; prompt: string }
export type QuestionResult = { questionId: string; answer: string; correct: boolean; correctAnswer: string; explanation: string }
export type AssessmentAttempt = {
  id: string
  status: 'in-progress' | 'submitted'
  questions: AssessmentQuestion[]
  passingScorePercent: number
  score: number | null
  passed: boolean | null
  results: QuestionResult[]
}
export type AssessmentData = { attempt: AssessmentAttempt | null }
