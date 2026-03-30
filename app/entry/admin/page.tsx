'use client'

/**
 * 系統管理員設定頁
 * - 截止日管理（§7）
 * - 資料來源設定（§9 HIS 預留）
 * - 快速連結：帳號管理、指標負責人指派
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import UserManagement from '@/components/entry/UserManagement'

interface DeadlineSetting {
  id?: number
  year: number
  month: number
  deadline_day: number
  note: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ─── 截止日設定卡片 ───────────────────────────────────────────

function DeadlineCard() {
  const [settings, setSettings] = useState<DeadlineSetting[]>([])
  const [form, setForm] = useState({ year: new Date().getFullYear() - 1911, month: new Date().getMonth() + 1, deadline_day: 10, note: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const tw_year = new Date().getFullYear() - 1911

  useEffect(() => {
    apiFetch<DeadlineSetting[]>(`/api/admin/deadlines?year=${tw_year}`)
      .then(setSettings)
      .catch(() => {})
  }, [tw_year])

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/admin/deadlines', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setMsg('✅ 已儲存')
      const data = await apiFetch<DeadlineSetting[]>(`/api/admin/deadlines?year=${tw_year}`)
      setSettings(data)
    } catch (e: unknown) {
      setMsg(`❌ ${e instanceof Error ? e.message : '儲存失敗'}`)
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 3000)
    }
  }

  return (
    <div className="bg-white border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-gray-800 mb-4">📅 填報截止日管理</h2>
      <p className="text-xs text-gray-500 mb-4">
        預設每月 10 日截止。可針對特定月份設定覆寫值（如春節延長）。
      </p>

      {/* 已設定清單 */}
      {settings.length > 0 && (
        <div className="mb-4 space-y-1">
          {settings.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded px-3 py-1.5">
              <span>{tw_year}年{s.month}月：截止 {s.deadline_day} 日</span>
              {s.note && <span className="text-gray-400">（{s.note}）</span>}
            </div>
          ))}
        </div>
      )}

      {/* 新增/覆寫 */}
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">民國年</label>
          <input
            type="number"
            value={form.year}
            onChange={(e) => setForm((f) => ({ ...f, year: parseInt(e.target.value) || f.year }))}
            className="w-20 px-2 py-1 text-sm border rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">月份</label>
          <select
            value={form.month}
            onChange={(e) => setForm((f) => ({ ...f, month: parseInt(e.target.value) }))}
            className="w-16 px-2 py-1 text-sm border rounded"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">截止日（幾號）</label>
          <input
            type="number"
            min={1}
            max={28}
            value={form.deadline_day}
            onChange={(e) => setForm((f) => ({ ...f, deadline_day: parseInt(e.target.value) || 10 }))}
            className="w-20 px-2 py-1 text-sm border rounded"
          />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-xs text-gray-500 mb-1">備註</label>
          <input
            type="text"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="如：春節延長"
            className="w-full px-2 py-1 text-sm border rounded"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '儲存中…' : '設定'}
        </button>
        {msg && <span className={`text-xs ${msg.startsWith('✅') ? 'text-green-600' : 'text-red-600'}`}>{msg}</span>}
      </div>
    </div>
  )
}

// ─── 主頁面 ─────────────────────────────────────────────────

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <Link href="/entry/review" className="text-gray-400 hover:text-gray-600 text-sm">← 返回</Link>
        <h1 className="text-base font-semibold text-gray-800">系統設定</h1>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {/* 截止日 */}
        <DeadlineCard />

        {/* 帳號管理 */}
        <UserManagement />

        {/* 快速連結 */}
        <div className="bg-white border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">🔗 管理功能</h2>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/entry/admin/indicatorassignment"
              className="block border rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <p className="text-sm font-medium text-gray-800">📋 指標負責人指派</p>
              <p className="text-xs text-gray-500 mt-0.5">設定指標 × 院區 × 負責人</p>
            </Link>
            <a
              href="/admin/entry/datasourceconfig/"
              target="_blank"
              rel="noreferrer"
              className="block border rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <p className="text-sm font-medium text-gray-800">🔌 HIS 資料來源</p>
              <p className="text-xs text-gray-500 mt-0.5">預留 HIS 串接設定（待實作）</p>
            </a>
          </div>
        </div>

        {/* HIS 串接預留說明 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-blue-800 mb-2">🔌 HIS 串接（預留）</h2>
          <p className="text-xs text-blue-700 leading-relaxed">
            系統架構已預留 HIS 串接擴充點。待確認 HIS 報表格式後，只需：
          </p>
          <ol className="text-xs text-blue-700 mt-2 space-y-1 list-decimal list-inside">
            <li>在「資料來源設定」填入 HIS 連線設定</li>
            <li>在「HIS 欄位對應」設定各指標分子/分母欄位</li>
            <li>實作 HISAdapter.fetch_data（後端 Python）</li>
          </ol>
          <p className="text-xs text-blue-600 mt-2">
            目前 /api/import/his-trigger 和 /api/import/his-webhook 已路由就位，回傳 501。
          </p>
        </div>
      </main>
    </div>
  )
}
