'use client'

import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { redirect, useRouter } from 'next/navigation'
import { auth } from '@app-firebase/config'
import { getDashboardPath, getUsername } from './dashboardPath'
import './LoginPage.css'

function DashboardPage({ dashboardSlug }: { dashboardSlug: string }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setIsCheckingAuth(false)
    })
  }, [])

  async function handleSignOut() {
    try {
      await signOut(auth)
      router.replace('/login')
    } catch {
      setMessage('Could not sign out. Please try again.')
    }
  }

  if (isCheckingAuth) {
    return <main className="login-page"><p role="status">Checking sign-in status...</p></main>
  }

  if (!user) {
    redirect('/login')
  }

  const dashboardPath = getDashboardPath(user)

  if (!dashboardPath) {
    redirect('/signup')
  }

  if (`/${dashboardSlug}` !== dashboardPath) {
    redirect(dashboardPath)
  }

  return (
    <main className="login-page">
      <div className="login-form">
        <h1>Hello {getUsername(user)}</h1>
        <button type="button" onClick={handleSignOut}>Sign out</button>
        {message && <p role="status">{message}</p>}
      </div>
    </main>
  )
}

export default DashboardPage
