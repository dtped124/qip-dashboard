'use client'

/**
 * 指標負責人指派頁面
 * 設定每個指標 × 院區 × 負責人的對應關係
 */
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  listAssignments,
  createAssignment,
  deleteAssignment,
  listUsers,
  listCampuses,
} from '@/lib/entry/api'
import type {
  IndicatorAssignment,
  AssignmentRole,
  AssignmentCreatePayload,
  Campus,
  User,
} from '@/lib/entry/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'

interface IndicatorMeta {
  code: string
  name: string
  category: string
  campuses: string[]
}

// ─── 主頁面 ─────────────────────────────────────────────────────

export default function IndicatorAssignmentPage() {
  const [assignments, setAssignments] = useState<IndicatorAssignment[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [indicators, setIndicators] = useState<IndicatorMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [filterCampus, setFilterCampus] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [searchText, setSearchText] = useState('')

  // dialog
  const [showDialog, setShowDialog] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [a, u, c] = await Promise.all([
        listAssignments(),
        listUsers(),
        listCampuses(),
      ])
      // fetch indicators from the v1 API
      const indRes = await fetch(`${API_BASE}/api/v1/indicators/`, { credentials: 'include' })
      const indData: IndicatorMeta[] = indRes.ok ? await indRes.json() : []

      setAssignments(a)
      setUsers(u)
      setCampuses(c)
      setIndicators(indData)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleDelete = async (assignment: IndicatorAssignment) => {
    const indName = indicators.find(i => i.code === assignment.indicator_code)?.name ?? assignment.indicator_code
    if (!confirm(`確定要移除「${indName}」在${assignment.campus_name}的負責人「${assignment.user_name}」？`)) return
    try {
      await deleteAssignment(assignment.id)
      await fetchData()
    } catch (e) {
      alert(e instanceof Error ? e.message : '刪除失敗')
    }
  }

  const handleSaved = async () => {
    await fetchData()
    setShowDialog(false)
  }

  // get unique categories from indicators
  const categories = useMemo(() => {
    const cats = Array.from(new Set(indicators.map(i => i.category)))
    return cats.sort()
  }, [indicators])

  // group assignments by indicator_code, then campus
  const filteredAssignments = useMemo(() => {
    let filtered = assignments

    if (filterCampus) {
      const campus = campuses.find(c => c.code === filterCampus)
      if (campus) {
        filtered = filtered.filter(a => a.campus === campus.id)
      }
    }

    if (filterCategory) {
      const catIndicatorCodes = indicators
        .filter(i => i.category === filterCategory)
        .map(i => i.code)
      filtered = filtered.filter(a => catIndicatorCodes.includes(a.indicator_code))
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      filtered = filtered.filter(a => {
        const indName = indicators.find(i => i.code === a.indicator_code)?.name ?? ''
        return (
          a.indicator_code.toLowerCase().includes(q) ||
          indName.toLowerCase().includes(q) ||
          a.user_name.toLowerCase().includes(q) ||
          a.user_employee_id.toLowerCase().includes(q)
        )
      })
    }

    return filtered
  }, [assignments, filterCampus, filterCategory, searchText, campuses, indicators])

  // group by indicator code
  const groupedByIndicator = useMemo(() => {
    const groups: Record<string, IndicatorAssignment[]> = {}
    for (const a of filteredAssignments) {
      if (!groups[a.indicator_code]) groups[a.indicator_code] = []
      groups[a.indicator_code].push(a)
    }
    // sort by indicator code
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredAssignments])

  // find unassigned indicators (no assignment for any campus)
  const unassignedIndicators = useMemo(() => {
    const assignedCodes = new Set(assignments.map(a => a.indicator_code))
    return indicators.filter(i => !assignedCodes.has(i.code))
  }, [assignments, indicators])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <Link href="/entry/admin" className="text-gray-400 hover:text-gray-600 text-sm">
          ← 返回
        </Link>
        <h1 className="text-base font-semibold text-gray-800">指標負責人指派</h1>
      </header>

      <main className="max-w-5xl mx-auto p-4 space-y-4">
        {/* 篩選列 + 新增按鈕 */}
        <div className="bg-white border rounded-lg p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">院區</label>
              <select
                value={filterCampus}
                onChange={e => setFilterCampus(e.target.value)}
                className="px-2 py-1.5 text-sm border rounded min-w-[100px]"
              >
                <option value="">全部院區</option>
                {campuses.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">面向</label>
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="px-2 py-1.5 text-sm border rounded min-w-[120px]"
              >
                <option value="">全部面向</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs text-gray-500 mb-1">搜尋</label>
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="指標代碼、名稱、負責人…"
                className="w-full px-2 py-1.5 text-sm border rounded"
              />
            </div>
            <button
              onClick={() => setShowDialog(true)}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + 新增指派
            </button>
          </div>
        </div>

        {/* 統計 */}
        <div className="flex gap-3">
          <div className="bg-white border rounded-lg px-4 py-3 flex-1 text-center">
            <div className="text-2xl font-bold text-blue-600">{assignments.length}</div>
            <div className="text-xs text-gray-500 mt-1">現行指派</div>
          </div>
          <div className="bg-white border rounded-lg px-4 py-3 flex-1 text-center">
            <div className="text-2xl font-bold text-gray-600">
              {new Set(assignments.map(a => a.indicator_code)).size}
            </div>
            <div className="text-xs text-gray-500 mt-1">已指派指標</div>
          </div>
          <div className="bg-white border rounded-lg px-4 py-3 flex-1 text-center">
            <div className={`text-2xl font-bold ${unassignedIndicators.length > 0 ? 'text-orange-500' : 'text-green-600'}`}>
              {unassignedIndicators.length}
            </div>
            <div className="text-xs text-gray-500 mt-1">未指派指標</div>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-400 text-center py-8">載入中…</p>}
        {error && <p className="text-sm text-red-500 text-center py-8">{error}</p>}

        {/* 指派表格 */}
        {!loading && !error && (
          <div className="bg-white border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs text-gray-500">
                    <th className="px-4 py-2.5">指標</th>
                    <th className="px-4 py-2.5">院區</th>
                    <th className="px-4 py-2.5">負責人</th>
                    <th className="px-4 py-2.5">職責</th>
                    <th className="px-4 py-2.5">生效日</th>
                    <th className="px-4 py-2.5">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedByIndicator.map(([code, group]) => {
                    const indMeta = indicators.find(i => i.code === code)
                    return group.map((a, idx) => (
                      <tr
                        key={a.id}
                        className={`border-b last:border-0 hover:bg-gray-50 ${idx === 0 ? '' : ''}`}
                      >
                        {idx === 0 && (
                          <td
                            className="px-4 py-2 align-top"
                            rowSpan={group.length}
                          >
                            <div className="font-mono text-xs text-blue-600 font-medium">{code}</div>
                            <div className="text-xs text-gray-600 mt-0.5">{indMeta?.name ?? ''}</div>
                            {indMeta?.category && (
                              <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500">
                                {indMeta.category}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-2">{a.campus_name}</td>
                        <td className="px-4 py-2">
                          <span className="font-medium">{a.user_name}</span>
                          <span className="text-gray-400 ml-1 text-xs">({a.user_employee_id})</span>
                        </td>
                        <td className="px-4 py-2">
                          <RoleBadge role={a.role as AssignmentRole} />
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{a.effective_from}</td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => handleDelete(a)}
                            className="text-xs text-red-500 hover:underline"
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))
                  })}
                  {groupedByIndicator.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">
                        {searchText || filterCampus || filterCategory
                          ? '沒有符合條件的指派紀錄'
                          : '尚未建立任何指派'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 未指派指標提示 */}
        {!loading && !error && unassignedIndicators.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-orange-800 mb-2">
              尚有 {unassignedIndicators.length} 項指標未指派負責人
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {unassignedIndicators.map(ind => (
                <span
                  key={ind.code}
                  className="inline-block px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs cursor-pointer hover:bg-orange-200"
                  onClick={() => {
                    setSearchText('')
                    setFilterCampus('')
                    setFilterCategory('')
                    setShowDialog(true)
                  }}
                  title={ind.name}
                >
                  {ind.code}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      {showDialog && (
        <AssignmentDialog
          campuses={campuses}
          users={users}
          indicators={indicators}
          existingAssignments={assignments}
          onClose={() => setShowDialog(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

// ─── 職責標籤 ───────────────────────────────────────────────────

function RoleBadge({ role }: { role: AssignmentRole }) {
  const config: Record<AssignmentRole, { bg: string; text: string; label: string }> = {
    primary: { bg: 'bg-blue-100', text: 'text-blue-700', label: '正職負責人' },
    deputy: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '代理人' },
  }
  const c = config[role] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: role }
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

// ─── 新增指派對話框 ─────────────────────────────────────────────

interface AssignmentDialogProps {
  campuses: Campus[]
  users: User[]
  indicators: IndicatorMeta[]
  existingAssignments: IndicatorAssignment[]
  onClose: () => void
  onSaved: () => void
}

function AssignmentDialog({
  campuses,
  users,
  indicators,
  existingAssignments,
  onClose,
  onSaved,
}: AssignmentDialogProps) {
  const [form, setForm] = useState<AssignmentCreatePayload>({
    indicator_code: '',
    campus: 0,
    user: 0,
    role: 'primary',
    effective_from: new Date().toISOString().slice(0, 10),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // batch mode
  const [batchMode, setBatchMode] = useState(false)
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [batchCategory, setBatchCategory] = useState<string>('')

  const activeUsers = users.filter(u => u.is_active)
  const categories = useMemo(() => {
    const cats = Array.from(new Set(indicators.map(i => i.category)))
    return cats.sort()
  }, [indicators])

  // filter indicators by selected category in batch mode
  const filteredIndicators = useMemo(() => {
    if (!batchCategory) return indicators
    return indicators.filter(i => i.category === batchCategory)
  }, [indicators, batchCategory])

  const toggleCode = (code: string) => {
    setSelectedCodes(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  const selectAllFiltered = () => {
    setSelectedCodes(filteredIndicators.map(i => i.code))
  }

  const clearSelection = () => {
    setSelectedCodes([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      if (batchMode) {
        if (selectedCodes.length === 0) {
          setError('請選擇至少一項指標')
          setSaving(false)
          return
        }
        if (!form.campus || !form.user) {
          setError('請選擇院區和負責人')
          setSaving(false)
          return
        }

        // check for duplicates
        const existing = existingAssignments.filter(
          a => a.campus === form.campus && a.user === form.user
        )
        const existingCodes = new Set(existing.map(a => a.indicator_code))
        const newCodes = selectedCodes.filter(c => !existingCodes.has(c))

        if (newCodes.length === 0) {
          setError('所選指標已全部指派給該負責人')
          setSaving(false)
          return
        }

        for (const code of newCodes) {
          await createAssignment({
            ...form,
            indicator_code: code,
          })
        }
      } else {
        if (!form.indicator_code || !form.campus || !form.user) {
          setError('請填寫所有必填欄位')
          setSaving(false)
          return
        }
        await createAssignment(form)
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800">新增指派</h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={batchMode}
                onChange={e => {
                  setBatchMode(e.target.checked)
                  setSelectedCodes([])
                }}
                className="rounded"
              />
              批次指派
            </label>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* 院區 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">院區 *</label>
            <select
              value={form.campus || ''}
              onChange={e => setForm(f => ({ ...f, campus: Number(e.target.value) }))}
              required
              className="w-full px-2 py-1.5 text-sm border rounded"
            >
              <option value="">請選擇院區</option>
              {campuses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 負責人 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">負責人 *</label>
            <select
              value={form.user || ''}
              onChange={e => setForm(f => ({ ...f, user: Number(e.target.value) }))}
              required
              className="w-full px-2 py-1.5 text-sm border rounded"
            >
              <option value="">請選擇負責人</option>
              {activeUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name}（{u.employee_id}）{u.campus_name ? ` - ${u.campus_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 職責 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">職責</label>
            <div className="flex gap-4">
              {([
                { value: 'primary' as const, label: '正職負責人' },
                { value: 'deputy' as const, label: '代理人' },
              ]).map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    value={opt.value}
                    checked={form.role === opt.value}
                    onChange={() => setForm(f => ({ ...f, role: opt.value }))}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* 生效日 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">生效日</label>
            <input
              type="date"
              value={form.effective_from}
              onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm border rounded"
            />
          </div>

          {/* 指標選擇 */}
          {batchMode ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-gray-500">選擇指標 *</label>
                <div className="flex gap-2">
                  <select
                    value={batchCategory}
                    onChange={e => setBatchCategory(e.target.value)}
                    className="px-2 py-0.5 text-xs border rounded"
                  >
                    <option value="">全部面向</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <button type="button" onClick={selectAllFiltered} className="text-xs text-blue-600 hover:underline">
                    全選
                  </button>
                  <button type="button" onClick={clearSelection} className="text-xs text-gray-500 hover:underline">
                    清除
                  </button>
                </div>
              </div>
              <div className="border rounded max-h-48 overflow-y-auto p-2 space-y-0.5">
                {filteredIndicators.map(ind => (
                  <label
                    key={ind.code}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCodes.includes(ind.code)}
                      onChange={() => toggleCode(ind.code)}
                      className="rounded"
                    />
                    <span className="font-mono text-blue-600">{ind.code}</span>
                    <span className="text-gray-600 truncate">{ind.name}</span>
                  </label>
                ))}
                {filteredIndicators.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">無指標</p>
                )}
              </div>
              {selectedCodes.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">已選 {selectedCodes.length} 項</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">指標 *</label>
              <select
                value={form.indicator_code}
                onChange={e => setForm(f => ({ ...f, indicator_code: e.target.value }))}
                required
                className="w-full px-2 py-1.5 text-sm border rounded"
              >
                <option value="">請選擇指標</option>
                {categories.map(cat => (
                  <optgroup key={cat} label={cat}>
                    {indicators.filter(i => i.category === cat).map(ind => (
                      <option key={ind.code} value={ind.code}>
                        {ind.code} — {ind.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

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
              {saving ? '儲存中…' : batchMode ? `指派 ${selectedCodes.length} 項` : '儲存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
