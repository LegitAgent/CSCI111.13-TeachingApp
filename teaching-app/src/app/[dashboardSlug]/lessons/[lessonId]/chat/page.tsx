import { notFound } from 'next/navigation'
import LessonPage from '@/components/lessons/LessonPage'

export default async function Page({ params }: {
  params: Promise<{ dashboardSlug: string; lessonId: string }>
}) {
  const { dashboardSlug, lessonId } = await params
  if (!dashboardSlug.startsWith('dashboard-')) notFound()

  return <LessonPage dashboardSlug={dashboardSlug} lessonId={lessonId} chatOnly />
}
