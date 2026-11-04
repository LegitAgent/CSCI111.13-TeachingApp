import { useState, type SubmitEvent } from 'react'
import './LoginPage.css'

function LoginPage() {
  const [message, setMessage] = useState('')

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('Sign-in is not set up yet.')
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
