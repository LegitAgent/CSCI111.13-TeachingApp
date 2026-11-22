import type { User } from 'firebase/auth'

const usernamePattern = /^[A-Za-z0-9_]{3,24}$/

export function isValidUsername(username: string) {
  return usernamePattern.test(username)
}

export function getUsername(user: User) {
  const displayName = user.displayName ?? ''
  const username = displayName.startsWith('@') ? displayName.slice(1) : ''
  return isValidUsername(username) ? username : null
}

export function getDashboardPathFor(username: string, uid: string) {
  return `/dashboard-${username.toLowerCase()}-${uid}`
}

export function getDashboardPath(user: User) {
  const username = getUsername(user)
  return username ? getDashboardPathFor(username, user.uid) : null
}
