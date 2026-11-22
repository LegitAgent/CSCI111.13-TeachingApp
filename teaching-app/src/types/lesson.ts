export type LessonConcept = {
  id: string
  title: string
  order: number
  required: boolean
  starterQuestion: string
}

export type LessonData = {
  lesson: {
    id: string
    title: string
    description: string
    passingScorePercent: number
    concepts: LessonConcept[]
  }
  demonstratedConcepts: string[]
}
