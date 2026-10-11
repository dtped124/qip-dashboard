'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { isPublicPath, routeVerdict } from '@/lib/auth/roles'
import type { RouteVerdict } from '@/lib/auth/roles'
import { useAuthStore } from '@/lib/auth/store'
import { isSigningOut, signOut } from '@/lib/auth/useLogout'

function Waiting() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-400">驗證登入中…</p>
    </div>
  )
}

/**
 * Route guard. Who is signed in comes from the auth store, which asks the server once; changing pages only
 * re-runs the pure decision in `routeVerdict` (see lib/auth/roles.ts), it never calls the API again.
 *
 *   public page (login)          rendered as is
 *   session not known yet        "驗證登入中…"
 *   not signed in                -> /entry/login?next=<this page>
 *   must change the password     -> /entry/login (it shows the change-password form)
 *   page not for the user's roles -> the landing page of their roles; no usable role -> sign out, and
 *                                 /entry/login?reason=no_role tells the user why
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const ensureLoaded = useAuthStore((s) => s.ensureLoaded)
  // The server could not be asked (as opposed to "nobody is signed in"); `attempt` is bumped by the retry button.
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const isPublic = isPublicPath(pathname)
  const sessionKnown = status === 'authenticated' || status === 'anonymous'
  // While a sign-out is under way the page is about to be replaced by a full load: no redirects of our own.
  const verdict: RouteVerdict | null = isPublic
    ? { kind: 'allow' }
    : sessionKnown && !isSigningOut()
      ? routeVerdict(pathname, user)
      : null

  // Ask for the session as soon as a page that needs one is shown. The store keeps the first answer, so later
  // page changes (and React's double effect in development) do not send another request.
  useEffect(() => {
    if (isPublic) return
    let cancelled = false
    setUnreachable(false)
    ensureLoaded().catch(() => {
      if (!cancelled) setUnreachable(true)
    })
    return () => {
      cancelled = true
    }
  }, [isPublic, ensureLoaded, attempt])

  const kind = verdict?.kind
  const homeTarget = verdict?.kind === 'home' ? verdict.to : null

  useEffect(() => {
    if (kind === 'login') {
      // The query string is read here, not with useSearchParams, which would force a Suspense boundary
      // around the whole app.
      router.replace('/entry/login?next=' + encodeURIComponent(pathname + window.location.search))
    } else if (kind === 'change-password') {
      router.replace('/entry/login')
    } else if (kind === 'home' && homeTarget) {
      router.replace(homeTarget)
    } else if (kind === 'sign-out') {
      // No usable role: the login page says why (`reason=no_role`) instead of just showing an empty form.
      void signOut('no_role')
    }
  }, [kind, homeTarget, pathname, router])

  if (verdict?.kind === 'allow') return <>{children}</>

  if (unreachable) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4 text-center">
        <p className="text-sm text-gray-600">無法確認登入狀態：後端沒有回應，請稍後再試</p>
        <button
          onClick={() => setAttempt((n) => n + 1)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          重試
        </button>
      </div>
    )
  }

  return <Waiting />
}
