'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getMe } from '@/lib/entry/api'
import type { User } from '@/lib/entry/types'

const PUBLIC_PATHS = ['/entry/login']

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  const isPublic = PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/mock/')

  useEffect(() => {
    if (isPublic) {
      setChecking(false)
      return
    }

    getMe()
      .then(setUser)
      .catch(() => {
        router.replace('/entry/login')
      })
      .finally(() => setChecking(false))
  }, [pathname, isPublic, router])

  if (isPublic) return <>{children}</>

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">驗證登入中…</p>
      </div>
    )
  }

  if (!user) return null

  return <>{children}</>
}
