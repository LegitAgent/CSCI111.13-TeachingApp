import { Link, Route, Routes } from 'react-router'
import DashboardPage from './DashboardPage'
import LoginPage from './LoginPage'
import SignUpPage from './SignUpPage'

function HomePage() {
  return (
    <main>
      <p>Hello from App</p>
      <Link to="/login">Login</Link>
      <Link to="/signup">Sign up</Link>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/:dashboardSlug" element={<DashboardPage />} />
      <Route path="*" element={<main>Page not found. <Link to="/">Home</Link></main>} />
    </Routes>
  )
}

export default App;
