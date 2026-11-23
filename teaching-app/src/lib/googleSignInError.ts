export function googleSignInError(error: unknown) {
  const value = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  const code = typeof value === 'string' && /^auth\/[a-z0-9-]+$/.test(value) ? value : 'auth/unknown-error'
  const messages: Record<string, string> = {
    'auth/unauthorized-domain': 'Google sign-in is not configured for this website yet. Please contact your instructor.',
    'auth/operation-not-allowed': 'Google sign-in is currently disabled. Please contact your instructor.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed before sign-in finished. Please try again.',
    'auth/cancelled-popup-request': 'Another sign-in window was opened. Complete it or close it before trying again.',
    'auth/network-request-failed': 'Could not connect to Google sign-in. Check your connection and try again.',
    'auth/web-storage-unsupported': 'Your browser is blocking sign-in storage. Allow site storage or try another browser.',
    'auth/account-exists-with-different-credential': 'This email already uses another sign-in method. Sign in using that method first.',
    'auth/invalid-api-key': 'This website’s sign-in settings need to be corrected. Please contact your instructor.',
    'auth/app-not-authorized': 'This website is not permitted to use its sign-in configuration. Please contact your instructor.',
    'auth/user-disabled': 'This account has been disabled. Please contact your instructor.',
  }
  return { code, message: `${messages[code] ?? 'Google sign-in could not finish. Please try again.'} (${code})` }
}
