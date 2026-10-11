'use client'

import Link from 'next/link'
import { canViewDashboard, hasRole } from '@/lib/auth/roles'
import { useAuthStore } from '@/lib/auth/store'
import { useLogout } from '@/lib/auth/useLogout'

/**
 * Minimal frame of the reporter's workspace (/entry, /entry/HAxx, /entry/case-list/*): a title bar with the
 * user's name and the way out. No dashboard sidebar, no import / export / settings - a reporter has no use for
 * them and the API would refuse them anyway. Readers get a link back to the dashboard, reviewers one to the
 * review overview.
 */
export function EntryShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const logout = useLogout()
  const roles = user?.roles

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between gap-3 border-b bg-white px-4 py-3">
        <Link href="/entry" className="text-base font-semibold text-gray-800">
          QIP 指標填報系統
        </Link>
        <div className="flex items-center gap-4">
          {canViewDashboard(roles) && (
            <Link href="/" className="text-sm text-gray-500 hover:underline">
              回儀表板
            </Link>
          )}
          {hasRole(roles, 'reviewer') && (
            <Link href="/entry/review" className="text-sm text-gray-500 hover:underline">
              填報審核
            </Link>
          )}
          <span className="text-sm text-gray-600">{user?.full_name ?? ''}</span>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600">
            登出
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}
