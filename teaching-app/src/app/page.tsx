import Link from 'next/link'

export default function HomePage() {
  return (
    <main>
      <p>Hello from App</p>
      <Link href="/login">Login</Link>
      <Link href="/signup">Sign up</Link>
    </main>
  )
}
