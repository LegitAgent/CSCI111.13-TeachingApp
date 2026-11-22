'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from '@app-firebase/config'
import { getDashboardPath } from '@/lib/dashboardPath'
import Brand from './Brand'

export default function AppHeader({ user, active = 'dashboard' }: { user?: User; active?: 'home' | 'dashboard' }) {
  const router = useRouter()
  const [session, setSession] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (user) return
    return onAuthStateChanged(auth, setSession)
  }, [user])
  const currentUser = user ?? session
  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" aria-label="PreCalPal home"><Brand /></Link>
        <nav className="app-nav" aria-label="Main navigation">
          <Link href="/" aria-current={active === 'home' ? 'page' : undefined}>Home</Link>
          <Link href={currentUser ? getDashboardPath(currentUser) ?? '/signup' : '/login'} aria-current={active === 'dashboard' ? 'page' : undefined}>Dashboard</Link>
        </nav>
        <div className="app-header-account">
          {currentUser ? <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError('')
            try { await signOut(auth); router.replace('/login') }
            catch { setError('Could not sign out. Please try again.'); setBusy(false) }
          }}>{busy ? 'Logging out…' : 'Log out'} <span aria-hidden="true">↗</span></button> : <Link href="/login">Log in <span aria-hidden="true">↗</span></Link>}
        </div>
      </div>
      {error && <p role="alert" className="app-header-error">{error}</p>}
    </header>
  </>
}
