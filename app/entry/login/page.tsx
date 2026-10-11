'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { login, changePassword, logout, getMe } from '@/lib/entry/api'
import { ApiError } from '@/lib/http'
import { homeFor } from '@/lib/auth/roles'
import type { User } from '@/lib/entry/types'

const NO_ROLE_MESSAGE = '此帳號尚未指派身分，請聯絡品管中心'
const LOCKED_FALLBACK_MESSAGE = '登入失敗次數過多，請稍後再試'
/** Same minimum as the backend's AUTH_PASSWORD_VALIDATORS; the backend stays the judge of everything else. */
const MIN_PASSWORD_LENGTH = 10

function loginErrorMessage(e: unknown): string {
  // 429 = locked after too many failed attempts; the backend's `detail` says how long to wait.
  if (e instanceof ApiError && e.status === 429) {
    return e.code === 'locked' ? e.message : LOCKED_FALLBACK_MESSAGE
  }
  return e instanceof Error ? e.message : '登入失敗'
}

/** The backend answers {current_password: [...]} / {new_password: [...]}; show every reason it gives. */
function changePasswordErrorMessage(e: unknown): string {
  if (e instanceof ApiError && typeof e.data === 'object' && e.data !== null) {
    const data = e.data as Record<string, unknown>
    const reasons = [data.current_password, data.new_password]
      .flatMap((value) => (Array.isArray(value) ? value : []))
      .filter((reason): reason is string => typeof reason === 'string')
    if (reasons.length > 0) return reasons.join('；')
  }
  return e instanceof Error ? e.message : '密碼修改失敗'
}

export default function LoginPage() {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 強制改密碼
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null)
  // The current password, asked for only when it was not just typed into the login form (page reload).
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)

  // Already signed in but obliged to change the password (reloaded mid-flow, or AuthGuard sent us
  // here): go straight to the form instead of losing the obligation with the page state.
  useEffect(() => {
    let cancelled = false
    getMe()
      .then((user) => {
        if (!cancelled && user.must_change_password) {
          setLoggedInUser(user)
          setShowChangePassword(true)
        }
      })
      .catch(() => {
        // Not signed in: the login form stays.
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Go to the landing page of the user's role; false (with an error shown) if the account has no role yet. */
  const navigateByRole = (user: User): boolean => {
    const home = homeFor(user.roles)
    if (home === null) {
      // Do not leave a usable session behind for an account that has no role yet.
      logout().catch(() => {})
      setError(NO_ROLE_MESSAGE)
      return false
    }
    router.push(home)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeeId || !password) {
      setError('請輸入帳號與密碼')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const user = await login(employeeId, password)
      if (user.must_change_password) {
        setLoggedInUser(user)
        setShowChangePassword(true)
      } else {
        navigateByRole(user)
      }
    } catch (e: unknown) {
      setError(loginErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    // The password typed at login is the current one; after a reload it has to be typed again.
    const currentPassword = password || currentPwd
    if (!currentPassword) {
      setError('請輸入目前密碼')
      return
    }
    if (newPwd.length < MIN_PASSWORD_LENGTH) {
      setError(`新密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`)
      return
    }
    if (newPwd !== confirmPwd) {
      setError('兩次輸入的密碼不一致')
      return
    }
    if (newPwd === currentPassword) {
      setError('新密碼不能與目前的密碼相同')
      return
    }
    setChangingPwd(true)
    setError(null)
    try {
      await changePassword(currentPassword, newPwd)
      // No role: leave the password form and show the message on the login screen.
      if (!navigateByRole(loggedInUser!)) setShowChangePassword(false)
    } catch (e: unknown) {
      setError(changePasswordErrorMessage(e))
    } finally {
      setChangingPwd(false)
    }
  }

  /** Leave the password form without changing anything (also the way out after a reload). */
  const handleCancelChange = async () => {
    try {
      await logout()
    } catch {
      // The session may already be gone; the login form is the right place to land either way.
    }
    setShowChangePassword(false)
    setLoggedInUser(null)
    setPassword('')
    setCurrentPwd('')
    setNewPwd('')
    setConfirmPwd('')
    setError(null)
  }

  // ─── 強制改密碼畫面 ─────────────────────────────
  if (showChangePassword) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border w-full max-w-sm p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-800">變更密碼</h1>
            <p className="text-sm text-gray-500 mt-1">
              首次登入或密碼被重設後，請先設定新密碼
            </p>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            {!password && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">目前密碼</label>
                <input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="管理員給您的臨時密碼"
                  autoComplete="current-password"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新密碼</label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder={`至少 ${MIN_PASSWORD_LENGTH} 個字元`}
                autoComplete="new-password"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <p className="mt-1 text-xs text-gray-400">不得太常見、不得全為數字、不得與帳號或姓名相似。</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">確認新密碼</label>
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="再次輸入新密碼"
                autoComplete="new-password"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={changingPwd}
              className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {changingPwd ? '設定中…' : '設定新密碼'}
            </button>
            <button
              type="button"
              onClick={handleCancelChange}
              disabled={changingPwd}
              className="w-full text-xs text-gray-500 hover:underline disabled:opacity-50"
            >
              登出，改用其他帳號
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ─── 登入畫面 ───────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-gray-800">QIP 指標填報系統</h1>
          <p className="text-sm text-gray-500 mt-1">請使用帳號登入</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">帳號</label>
            <input
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="請輸入帳號"
              autoComplete="username"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="請輸入密碼"
              autoComplete="current-password"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '登入中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  )
}
