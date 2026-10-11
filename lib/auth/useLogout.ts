'use client'

import { useCallback } from 'react'
import { logout } from '../entry/api'
import { useAuthStore } from './store'

/** Why the user is sent to the login page; the login page explains it (`/entry/login?reason=...`). */
export type SignOutReason = 'no_role'

// Set once a sign-out has started. The route guard must not start a client-side redirect of its own while the
// full page load below is on its way: a soft navigation could settle first, and the page would then stay alive
// with the previous user's data in memory.
let signingOut = false

export function isSigningOut(): boolean {
  return signingOut
}

/**
 * Sign out: end the session on the server (a failure does not stop us), forget the user, then load the login
 * page afresh. The full page load is on purpose: it drops everything the previous user left in memory
 * (dashboard data, per-page state) instead of leaving it for the next person at this browser.
 */
export async function signOut(reason?: SignOutReason): Promise<void> {
  signingOut = true
  try {
    await logout()
  } catch {
    // The session may already be gone; the login page is the right place to land either way.
  }
  useAuthStore.getState().clear()
  window.location.assign(reason ? `/entry/login?reason=${reason}` : '/entry/login')
}

/** `signOut()` for a button: the click handler of a plain "登出". */
export function useLogout(): () => Promise<void> {
  return useCallback(() => signOut(), [])
}
