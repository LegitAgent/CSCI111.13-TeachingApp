export type AssessmentChoice = { id: string; text: string }
export type AssessmentQuestion = { id: string; prompt: string } & (
  | { format?: 'interval-input'; choices?: never }
  | { format: 'multiple-choice'; choices: AssessmentChoice[] }
)
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
