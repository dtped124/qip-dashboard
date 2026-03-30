'use client'

/**
 * 品管中心全景管理面板（§6.1）
 * 矩陣式：院區（列）× 面向（欄）的填報狀態
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { finalizeMonth, getReviewOverview } from '@/lib/entry/api'
import type { ReviewCampusRow, ReviewOverviewResponse } from '@/lib/entry/api'

const STATUS_CONFIG: Record<string, { emoji: string; label: string; className: string }> = {
  unfilled:  { emoji: '⬜', label: '未填',   className: 'bg-gray-50 text-gray-400' },
  draft:     { emoji: '📝', label: '草稿',   className: 'bg-yellow-50 text-yellow-700' },
  submitted: { emoji: '🔍', label: '待審',   className: 'bg-blue-50 text-blue-700 font-bold cursor-pointer hover:bg-blue-100' },
  approved:  { emoji: '✅', label: '已核准', className: 'bg-green-50 text-green-700' },
  finalized: { emoji: '🔒', label: '已送出', className: 'bg-gray-100 text-gray-500' },
}

function StatusCell({
  campusCode, categoryCode, status, year, month,
}: {
  campusCode: string
  categoryCode: string
  status: string
  reportId: number | null
  year: number
  month: number
}) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unfilled
  const isClickable = status === 'submitted' || status === 'approved'

  const cell = (
    <td
      className={`border px-2 py-2 text-center text-xs whitespace-nowrap ${cfg.className} ${isClickable ? 'cursor-pointer' : ''}`}
      title={cfg.label}
    >
      {cfg.emoji}
    </td>
  )

  if (isClickable) {
    return (
      <Link href={`/entry/review/campus/${campusCode}/${categoryCode}?year=${year}&month=${month}`}>
        {cell}
      </Link>
    )
  }
  return cell
}

function CampusRow({
  campus, categories, year, month, onFinalize,
}: {
  campus: ReviewCampusRow
  categories: Array<{ code: string; name: string }>
  year: number
  month: number
  onFinalize: (campusCode: string) => void
}) {
  const catMap = Object.fromEntries(
    campus.categories.map((c) => [c.category_code, c])
  )
  return (
    <tr>
      {/* 院區名稱 */}
      <td className="border px-3 py-2 font-medium text-sm text-gray-800 whitespace-nowrap bg-gray-50 sticky left-0">
        {campus.campus_name}
        {campus.submitted_count > 0 && (
          <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-blue-600 text-white">
            {campus.submitted_count}
          </span>
        )}
      </td>
      {/* 各面向狀態 */}
      {categories.map((cat) => {
        const c = catMap[cat.code]
        return (
          <StatusCell
            key={cat.code}
            campusCode={campus.campus_code}
            categoryCode={cat.code}
            status={c?.status ?? 'unfilled'}
            reportId={c?.report_id ?? null}
            year={year}
            month={month}
          />
        )
      })}
      {/* 送出按鈕 */}
      <td className="border px-2 py-2 text-center">
        {campus.all_approved ? (
          <button
            onClick={() => onFinalize(campus.campus_code)}
            className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 font-medium"
          >
            送出至醫策會
          </button>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
    </tr>
  )
}

export default function ReviewOverviewPage() {
  const [overview, setOverview] = useState<ReviewOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmFinalize, setConfirmFinalize] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const now = new Date()
  const year = now.getFullYear() - 1911
  const month = now.getMonth() + 1

  useEffect(() => {
    getReviewOverview(year, month)
      .then(setOverview)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [year, month])

  const handleFinalize = async (campusCode: string) => {
    setFinalizing(true)
    try {
      await finalizeMonth(campusCode, year, month)
      setMsg(`✅ ${campusCode} ${year}年${month}月 已送出至醫策會`)
      // 重新載入
      const data = await getReviewOverview(year, month)
      setOverview(data)
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : '送出失敗'
      setMsg(`❌ ${m}`)
    } finally {
      setFinalizing(false)
      setConfirmFinalize(null)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  if (loading) return <div className="p-8 text-gray-400">載入中…</div>
  if (error) return <div className="p-8 text-red-500">{error}</div>
  if (!overview) return null

  const { campuses, categories } = overview

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-800">QIP 審核管理</h1>
          <p className="text-xs text-gray-500">{year} 年 {month} 月</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/entry" className="text-sm text-gray-500 hover:underline">填報首頁</Link>
          <Link href="/entry/admin" className="text-sm text-gray-500 hover:underline">系統設定</Link>
        </div>
      </header>

      <main className="p-4 overflow-x-auto">
        {msg && (
          <div className={`mb-4 p-3 rounded-lg text-sm border ${msg.startsWith('✅') ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg}
          </div>
        )}

        {/* 狀態圖例 */}
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-gray-500">
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <span key={k}>{v.emoji} {v.label}</span>
          ))}
          <span className="text-blue-600 font-medium">（🔍 點擊可進入審核）</span>
        </div>

        {/* 矩陣 */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 sticky left-0 bg-gray-50">院區</th>
                {categories.map((cat) => (
                  <th
                    key={cat.code}
                    className="px-2 py-2 text-center text-xs font-medium text-gray-500 min-w-[56px]"
                    title={cat.name}
                  >
                    <div
                      className="w-3 h-3 rounded-full mx-auto mb-0.5"
                      style={{ backgroundColor: cat.color }}
                    />
                    {cat.code}
                  </th>
                ))}
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-500">送出</th>
              </tr>
            </thead>
            <tbody>
              {campuses.map((campus) => (
                <CampusRow
                  key={campus.campus_code}
                  campus={campus}
                  categories={categories}
                  year={year}
                  month={month}
                  onFinalize={(code) => setConfirmFinalize(code)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* 送出確認 Dialog */}
      {confirmFinalize && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-2">確認送出至醫策會</h3>
            <p className="text-sm text-gray-600 mb-1">
              將 <strong>{year}年{month}月</strong>{' '}
              <strong>{campuses.find(c => c.campus_code === confirmFinalize)?.campus_name}</strong>{' '}
              所有指標送出至醫策會。
            </p>
            <p className="text-sm text-red-600 font-medium mb-5">送出後資料將鎖定不可修改。</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmFinalize(null)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => handleFinalize(confirmFinalize)}
                disabled={finalizing}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
              >
                {finalizing ? '處理中…' : '確認送出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
