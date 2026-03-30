'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { login, changePassword } from '@/lib/entry/api'
import type { User } from '@/lib/entry/types'

export default function LoginPage() {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 強制改密碼
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)

  const navigateByRole = (user: User) => {
    if (user.roles.includes('reviewer') || user.roles.includes('admin')) {
      router.push('/entry/review')
    } else {
      router.push('/entry')
    }
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
      const msg = e instanceof Error ? e.message : '登入失敗'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPwd.length < 8) {
      setError('新密碼至少需要 8 個字元')
      return
    }
    if (newPwd !== confirmPwd) {
      setError('兩次輸入的密碼不一致')
      return
    }
    setChangingPwd(true)
    setError(null)
    try {
      await changePassword(newPwd)
      navigateByRole(loggedInUser!)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '密碼修改失敗'
      setError(msg)
    } finally {
      setChangingPwd(false)
    }
  }

  // ─── 強制改密碼畫面 ─────────────────────────────
  if (showChangePassword) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border w-full max-w-sm p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-800">變更密碼</h1>
            <p className="text-sm text-gray-500 mt-1">
              首次登入請設定新密碼
            </p>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新密碼</label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="至少 8 個字元"
                autoComplete="new-password"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
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
