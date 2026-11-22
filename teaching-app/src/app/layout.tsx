import type { Metadata } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'PreCalPal',
  description: 'Learn precalculus with guided lessons and practice.',
  icons: {
    icon: { url: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
