'use client'

/**
 * Who is signed in, as the SPA knows it. One source for the route guard, the shells and the pages, so
 * `/api/auth/me` is asked once per page load instead of once per page change or per component.
 *
 *   ensureLoaded()   the first call asks the server, every later call returns the same answer
 *   setUser(user)    after a login or a password change: the answer is known, no need to ask
 *   clear()          the session is gone (logout, or the backend said `not_authenticated`): forget the answer
 *
 * `status` starts as 'unknown' on the server and in the first client render alike, so nothing differs at
 * hydration. Memory only: a reload (also the one `useLogout` performs) starts from scratch.
 */
import { create } from 'zustand'
import { ApiError, onAuthError } from '../http'
import { getMe } from '../entry/api'
import type { User } from '../entry/types'

export type AuthStatus = 'unknown' | 'loading' | 'authenticated' | 'anonymous'

interface AuthStore {
  user: User | null
  status: AuthStatus
  /**
   * The signed-in user, or null when nobody is. Rejects only when the server could not answer at all (network
   * down, timeout, 5xx): that says nothing about the session, so the next call asks again.
   */
  ensureLoaded: () => Promise<User | null>
  setUser: (user: User) => void
  clear: () => void
}

/** The answer to the one `getMe()` call (or to the last setUser); null = nothing known, ask again. */
let answer: Promise<User | null> | null = null

/** The server said "there is no session" (as opposed to "I could not tell"). */
function isNotSignedIn(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403)
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  status: 'unknown',

  ensureLoaded: () => {
    if (answer) return answer
    set({ status: 'loading' })

    const pending: Promise<User | null> = getMe().then(
      (user) => {
        if (answer !== pending) return get().user // setUser()/clear() overtook this request
        set({ user, status: 'authenticated' })
        return user
      },
      (err: unknown) => {
        if (answer !== pending) return get().user
        if (isNotSignedIn(err)) {
          set({ user: null, status: 'anonymous' })
          return null
        }
        answer = null // no verdict: let the next call ask again
        set({ status: 'unknown' })
        throw err
      },
    )
    answer = pending
    return pending
  },

  setUser: (user) => {
    answer = Promise.resolve(user)
    set({ user, status: 'authenticated' })
  },

  clear: () => {
    answer = null
    set({ user: null, status: 'anonymous' })
  },
}))

// Every request goes through lib/http.ts, which tells us about 401/403 answers. Only two codes are about the
// session itself; anything else, `permission_denied` above all, means "signed in, but not allowed here" and must
// leave the session alone (the route guard and the pages deal with it).
onAuthError((err) => {
  const { status, user, clear, setUser } = useAuthStore.getState()
  if (err.code === 'not_authenticated') {
    // While the first /me is still on its way, ensureLoaded() settles on 'anonymous' by itself.
    if (status !== 'loading') clear()
  } else if (err.code === 'password_change_required') {
    // The backend refuses everything else until the password is changed; the guard sends the user to that form.
    if (user && !user.must_change_password) setUser({ ...user, must_change_password: true })
  }
})
