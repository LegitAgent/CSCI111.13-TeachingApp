import { notFound } from 'next/navigation'
import DashboardPage from '@/components/dashboard/DashboardPage'

export default async function Page({
  params,
}: {
  params: Promise<{ dashboardSlug: string }>
}) {
  const { dashboardSlug } = await params

  if (!dashboardSlug.startsWith('dashboard-')) {
    notFound()
  }

  return <DashboardPage dashboardSlug={dashboardSlug} />
}
