import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { auth } from '@firebase/config'
import { getDashboardPath, getUsername } from './dashboardPath'
import './LoginPage.css'

function DashboardPage() {
  const { dashboardSlug } = useParams()
  const navigate = useNavigate()
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
      navigate('/login', { replace: true })
    } catch {
      setMessage('Could not sign out. Please try again.')
    }
  }

  if (!dashboardSlug?.startsWith('dashboard-')) {
    return <main>Page not found. <Link to="/">Home</Link></main>
  }

  if (isCheckingAuth) {
    return <main className="login-page"><p role="status">Checking sign-in status...</p></main>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const dashboardPath = getDashboardPath(user)

  if (!dashboardPath) {
    return <Navigate to="/signup" replace />
  }

  if (`/${dashboardSlug}` !== dashboardPath) {
    return <Navigate to={dashboardPath} replace />
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
