'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getMe } from '@/lib/entry/api'
import type { User } from '@/lib/entry/types'

const PUBLIC_PATHS = ['/entry/login']
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

// SHA-256 of the demo password — change via: printf "your_password" | sha256sum
const DEMO_PASSWORD_HASH = '0ed358e8317a737d01d338531f358aa196d56013177e9fc5da0076c65901d843'

async function hashPassword(pwd: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(pwd)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── Demo Mode: Password Gate ──────────────────────────────────

function DemoGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('qip-auth') === 'verified') {
      setAuthenticated(true)
    }
    setChecking(false)
  }, [])

  const handleLogin = async () => {
    const hash = await hashPassword(password)
    if (hash === DEMO_PASSWORD_HASH) {
      sessionStorage.setItem('qip-auth', 'verified')
      setAuthenticated(true)
      setError(false)
    } else {
      setError(true)
    }
  }

  if (checking) return null
  if (authenticated) return <>{children}</>

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-xl font-bold mb-1 text-gray-800">QIP 持續性監測指標儀表板</h1>
        <p className="text-sm text-gray-500 mb-6">測試環境 — 請輸入密碼進入</p>
        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(false) }}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          className={`w-full p-2 border rounded mb-3 text-sm ${error ? 'border-red-400' : ''}`}
          placeholder="請輸入測試密碼"
          autoFocus
        />
        {error && <p className="text-xs text-red-500 mb-2">密碼錯誤，請重試</p>}
        <button
          onClick={handleLogin}
          className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 text-sm"
        >
          進入
        </button>
      </div>
    </div>
  )
}

// ─── Production Mode: Backend Auth ─────────────────────────────

function BackendGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  const isPublic = PUBLIC_PATHS.includes(pathname)

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

// ─── Exported Component ────────────────────────────────────────

export function AuthGuard({ children }: { children: React.ReactNode }) {
  if (IS_DEMO) {
    return <DemoGate>{children}</DemoGate>
  }
  return <BackendGuard>{children}</BackendGuard>
}
