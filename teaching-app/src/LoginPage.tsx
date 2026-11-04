import { useState, type SubmitEvent } from 'react'
import { auth } from './firebase.ts'
import { signInWithEmailAndPassword } from 'firebase/auth'
import './LoginPage.css'


function LoginPage() {
  const [message, setMessage] = useState('')

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    // stops the browser from executing its default built-in action for a specific user interaction
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    
    try {
      await signInWithEmailAndPassword(auth, email, password)
      setMessage('Signed In')
    } catch {
      setMessage('Failed, Incorrect credentials')
    }
  }

  return (
    <main className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>Login</h1>

        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <button type="submit">Login</button>
        {message && <p role="status">{message}</p>}
      </form>
    </main>
  )
}

export default LoginPage
