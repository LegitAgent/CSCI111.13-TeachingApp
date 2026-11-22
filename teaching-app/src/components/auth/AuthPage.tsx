'use client'

import { useEffect, useState, type SubmitEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
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
import { auth } from '@app-firebase/config'
import {
  getDashboardPath,
  getDashboardPathFor,
  getUsername,
  isValidUsername,
} from '@/lib/dashboardPath'
import '@/components/auth/LoginPage.css'
import Brand from '@/components/layout/Brand'
import MathBackdrop from '@/components/layout/MathBackdrop'

type AuthPageProps = {
  mode: 'login' | 'signup'
}

function AuthPage({ mode }: AuthPageProps) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

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
        router.replace(getDashboardPathFor(username, result.user.uid))
      } else {
        const result = await signInWithEmailAndPassword(auth, email, password)
        router.replace(getDashboardPath(result.user) ?? '/signup')
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
      router.replace(getDashboardPath(result.user) ?? '/signup')
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
      router.replace(getDashboardPathFor(username, user.uid))
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
    <main className="login-page" id="main-content">
      <aside className="auth-art" aria-label="Welcome to PreCalPal">
        <Link href="/" className="auth-art-brand" aria-label="PreCalPal home"><Brand /></Link>
        <MathBackdrop />
        <div className="auth-art-center">
          <Image src="/favicon.svg" alt="Your friendly PreCalPal mascot" width={260} height={260} preload />
          <h2>A little curiosity.<br />A lot of possibility.</h2>
          <p>Understand the why.<br />Build your confidence, one idea at a time.</p>
        </div>
        <span className="auth-art-note">YOUR PRECALCULUS LEARNING COMPANION</span>
      </aside>
      <section className="login-panel" aria-label={mode === 'signup' ? 'Create your account' : 'Sign in to your account'}>
      <Link className="auth-back" href="/">← Back to home</Link>
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
            <Link href={getDashboardPath(user) ?? '/signup'}>Go to dashboard</Link>
            <button type="button" onClick={handleSignOut} disabled={isSubmitting}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">LET’S MAKE MATH MAKE SENSE</p>
            <h1>{mode === 'signup' ? 'Your next chapter starts here.' : 'Welcome back!'}</h1>
            <p className="auth-wordmark">PreCalPal<span aria-hidden="true">.</span></p>
            <p className="auth-subtitle">{mode === 'signup' ? 'Create an account and learn at your own pace.' : 'A fresh start, or right where you left off.'}</p>
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
              <div className="password-field">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 6 : undefined}
                required
              />
              <button type="button" className="password-toggle" aria-controls="password" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button>
              </div>

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
                {isSubmitting ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Log in'} <span aria-hidden="true">→</span>
              </button>
            </form>

            <div className="auth-divider"><span>or</span></div>
            <button className="google-button" type="button" onClick={handleGoogleSignIn} disabled={isSubmitting}>
              <span aria-hidden="true" className="google-letter">G</span> Continue with Google
            </button>
            <p>
              {mode === 'signup' ? 'Already have an account? ' : 'Need an account? '}
              <Link href={mode === 'signup' ? '/login' : '/signup'}>
                {mode === 'signup' ? 'Login' : 'Sign up'}
              </Link>
            </p>
          </>
        )}
        {message && <p className="auth-message" role="alert">{message}</p>}
      </div>
      <p className="auth-footer">Small steps. Real understanding.</p>
      </section>
    </main>
  )
}

export default AuthPage
