import { useEffect, useState, type SubmitEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { auth } from './firebase'
import {
  getDashboardPath,
  getDashboardPathFor,
  getUsername,
  isValidUsername,
} from './dashboardPath'
import './LoginPage.css'

type AuthPageProps = {
  mode: 'login' | 'signup'
}

function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setIsCheckingAuth(false)
    })
  }, [])

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    const username = String(formData.get('username') ?? '').trim()

    if (mode === 'signup' && password !== formData.get('confirmPassword')) {
      setMessage('Passwords do not match.')
      return
    }

    if (mode === 'signup' && !isValidUsername(username)) {
      setMessage('Use 3 to 24 letters, numbers, or underscores for your username.')
      return
    }

    setIsSubmitting(true)
    setMessage('')

    let accountCreated = false

    try {
      if (mode === 'signup') {
        const result = await createUserWithEmailAndPassword(auth, email, password)
        accountCreated = true
        await updateProfile(result.user, { displayName: `@${username}` })
        navigate(getDashboardPathFor(username, result.user.uid), { replace: true })
      } else {
        const result = await signInWithEmailAndPassword(auth, email, password)
        navigate(getDashboardPath(result.user) ?? '/signup', { replace: true })
      }
    } catch {
      setMessage(
        accountCreated
          ? 'Account created, but your username could not be saved. Please try again.'
          : mode === 'signup'
          ? 'Could not create an account. Check your details or try another email.'
          : 'Sign-in failed. Check your email and password.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGoogleSignIn() {
    setIsSubmitting(true)
    setMessage('')

    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      navigate(getDashboardPath(result.user) ?? '/signup', { replace: true })
    } catch {
      setMessage('Google sign-in was not completed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUsernameSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    const formData = new FormData(event.currentTarget)
    const username = String(formData.get('username') ?? '').trim()

    if (!isValidUsername(username)) {
      setMessage('Use 3 to 24 letters, numbers, or underscores for your username.')
      return
    }

    setIsSubmitting(true)
    setMessage('')

    try {
      await updateProfile(user, { displayName: `@${username}` })
      navigate(getDashboardPathFor(username, user.uid), { replace: true })
    } catch {
      setMessage('Could not save your username. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSignOut() {
    setIsSubmitting(true)
    setMessage('')

    try {
      await signOut(auth)
    } catch {
      setMessage('Could not sign out. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-form">
        {isCheckingAuth ? (
          <p role="status">Checking sign-in status...</p>
        ) : user && !getUsername(user) ? (
          <>
            <h1>Choose a username</h1>
            <form className="login-fields" onSubmit={handleUsernameSubmit}>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                pattern="[A-Za-z0-9_]{3,24}"
                minLength={3}
                maxLength={24}
                title="3 to 24 letters, numbers, or underscores"
                required
              />
              <button type="submit" disabled={isSubmitting}>Save username</button>
            </form>
            <button type="button" onClick={handleSignOut} disabled={isSubmitting}>
              Sign out
            </button>
          </>
        ) : user ? (
          <>
            <h1>Signed in</h1>
            <p>@{getUsername(user)}</p>
            <Link to={getDashboardPath(user) ?? '/signup'}>Go to dashboard</Link>
            <button type="button" onClick={handleSignOut} disabled={isSubmitting}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <h1>{mode === 'signup' ? 'Sign up' : 'Login'}</h1>
            <form className="login-fields" onSubmit={handleSubmit}>
              {mode === 'signup' && (
                <>
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    pattern="[A-Za-z0-9_]{3,24}"
                    minLength={3}
                    maxLength={24}
                    title="3 to 24 letters, numbers, or underscores"
                    required
                  />
                </>
              )}

              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 6 : undefined}
                required
              />

              {mode === 'signup' && (
                <>
                  <label htmlFor="confirmPassword">Confirm password</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </>
              )}

              <button type="submit" disabled={isSubmitting}>
                {mode === 'signup' ? 'Create account' : 'Login'}
              </button>
            </form>

            <button type="button" onClick={handleGoogleSignIn} disabled={isSubmitting}>
              Continue with Google
            </button>
            <p>
              {mode === 'signup' ? 'Already have an account? ' : 'Need an account? '}
              <Link to={mode === 'signup' ? '/login' : '/signup'}>
                {mode === 'signup' ? 'Login' : 'Sign up'}
              </Link>
            </p>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </main>
  )
}

export default AuthPage
