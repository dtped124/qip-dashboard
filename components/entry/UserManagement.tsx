'use client'

import { useEffect, useState } from 'react'
import { listUsers, listCampuses, createUser, updateUser, deleteUser, resetPassword } from '@/lib/entry/api'
import type { User, UserRole, Campus, UserCreatePayload, UserUpdatePayload } from '@/lib/entry/types'

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'reporter', label: '填報者' },
  { value: 'reviewer', label: '審核者' },
  { value: 'admin', label: '管理員' },
]

// ─── 主元件 ─────────────────────────────────────────────────────

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // dialog state
  const [showDialog, setShowDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [u, c] = await Promise.all([listUsers(), listCampuses()])
      setUsers(u)
      setCampuses(c)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleAdd = () => {
    setEditingUser(null)
    setShowDialog(true)
  }

  const handleEdit = (user: User) => {
    setEditingUser(user)
    setShowDialog(true)
  }

  const handleToggleActive = async (user: User) => {
    try {
      await updateUser(user.id, { is_active: !user.is_active })
      await fetchData()
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失敗')
    }
  }

  const handleDelete = async (user: User) => {
    if (!confirm(`確定要刪除帳號「${user.full_name}（${user.employee_id}）」？\n此操作無法復原。`)) return
    try {
      await deleteUser(user.id)
      await fetchData()
    } catch (e) {
      alert(e instanceof Error ? e.message : '刪除失敗')
    }
  }

  const handleResetPassword = async (user: User) => {
    if (!confirm(`確定要重設「${user.full_name}」的密碼？\n重設後該使用者下次登入須設定新密碼。`)) return
    try {
      const res = await resetPassword(user.id)
      alert(res.detail)
    } catch (e) {
      alert(e instanceof Error ? e.message : '重設失敗')
    }
  }

  const handleSave = async () => {
    await fetchData()
    setShowDialog(false)
  }

  return (
    <div className="bg-white border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-800">👤 帳號管理</h2>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + 新增使用者
        </button>
      </div>

      {loading && <p className="text-xs text-gray-400">載入中…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-3">帳號</th>
                <th className="pb-2 pr-3">姓名</th>
                <th className="pb-2 pr-3">院區</th>
                <th className="pb-2 pr-3">角色</th>
                <th className="pb-2 pr-3">狀態</th>
                <th className="pb-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-3 font-mono">{u.employee_id}</td>
                  <td className="py-2 pr-3">{u.full_name}</td>
                  <td className="py-2 pr-3">{u.campus_name ?? '-'}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-1 flex-wrap">
                      {u.roles.map((r) => (
                        <RoleBadge key={r} role={r} />
                      ))}
                      {u.roles.length === 0 && <span className="text-gray-400">-</span>}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {u.is_active ? '啟用' : '停用'}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(u)}
                        className="text-blue-600 hover:underline"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={u.is_active ? 'text-orange-600 hover:underline' : 'text-green-600 hover:underline'}
                      >
                        {u.is_active ? '停用' : '啟用'}
                      </button>
                      <button
                        onClick={() => handleResetPassword(u)}
                        className="text-purple-600 hover:underline"
                      >
                        重設密碼
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="text-red-500 hover:underline"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-gray-400">尚無使用者</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showDialog && (
        <UserDialog
          user={editingUser}
          campuses={campuses}
          onClose={() => setShowDialog(false)}
          onSaved={handleSave}
        />
      )}
    </div>
  )
}

// ─── 角色標籤 ───────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  const config: Record<UserRole, { bg: string; text: string; label: string }> = {
    reporter: { bg: 'bg-blue-100', text: 'text-blue-700', label: '填報者' },
    reviewer: { bg: 'bg-purple-100', text: 'text-purple-700', label: '審核者' },
    admin: { bg: 'bg-red-100', text: 'text-red-700', label: '管理員' },
  }
  const c = config[role] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: role }
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

// ─── 新增/編輯對話框 ─────────────────────────────────────────────

interface UserDialogProps {
  user: User | null  // null = 新增模式
  campuses: Campus[]
  onClose: () => void
  onSaved: () => void
}

function UserDialog({ user, campuses, onClose, onSaved }: UserDialogProps) {
  const isEdit = !!user

  const [form, setForm] = useState({
    employee_id: user?.employee_id ?? '',
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    campus: campuses.find((c) => c.code === user?.campus_code)?.id ?? null as number | null,
    roles: user?.roles ?? [] as UserRole[],
    password: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleRole = (role: UserRole) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role)
        ? f.roles.filter((r) => r !== role)
        : [...f.roles, role],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      if (isEdit) {
        const payload: UserUpdatePayload = {
          full_name: form.full_name,
          email: form.email,
          campus: form.campus,
          roles: form.roles,
        }
        await updateUser(user!.id, payload)
      } else {
        if (!form.password) {
          setError('請輸入密碼')
          setSaving(false)
          return
        }
        const payload: UserCreatePayload = {
          employee_id: form.employee_id,
          full_name: form.full_name,
          email: form.email,
          campus: form.campus,
          roles: form.roles,
          password: form.password,
        }
        await createUser(payload)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">
          {isEdit ? '編輯使用者' : '新增使用者'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* 帳號 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">帳號</label>
            <input
              type="text"
              value={form.employee_id}
              onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
              disabled={isEdit}
              required
              className="w-full px-2 py-1.5 text-sm border rounded disabled:bg-gray-100 disabled:text-gray-500"
              placeholder="如 A12345"
            />
          </div>

          {/* 姓名 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">姓名</label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
              className="w-full px-2 py-1.5 text-sm border rounded"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border rounded"
            />
          </div>

          {/* 院區 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">所屬院區</label>
            <select
              value={form.campus ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, campus: e.target.value ? Number(e.target.value) : null }))}
              className="w-full px-2 py-1.5 text-sm border rounded"
            >
              <option value="">（不指定）</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 角色 checkbox */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">角色</label>
            <div className="flex gap-4">
              {ROLE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(opt.value)}
                    onChange={() => toggleRole(opt.value)}
                    className="rounded"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* 密碼（僅新增時） */}
          {!isEdit && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">密碼</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
                className="w-full px-2 py-1.5 text-sm border rounded"
                placeholder="至少 8 個字元"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* 按鈕 */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 border rounded hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
