import LoginPage from './LoginPage'

function App() {
  if (window.location.pathname.replace(/\/$/, '') === '/login') {
    return <LoginPage />
  }

  return (
    <main>
      <p>Hello from App</p>
      <a href="/login">Login</a>
    </main>
  )
}

export default App;
