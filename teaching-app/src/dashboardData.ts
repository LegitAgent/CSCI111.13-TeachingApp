export type LessonProgress = {
  stage: string
  demonstratedConceptCount: number
  bestScore: number | null
  mastered: boolean
}

export type DashboardLesson = {
  id: string
  title: string
  description: string
  order: number
  requiredConceptCount: number
  passingScorePercent: number
  progress: LessonProgress | null
}

export type DashboardData = {
  lessons: DashboardLesson[]
}
