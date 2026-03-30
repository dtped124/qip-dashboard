'use client'

/**
 * 審核操作頁（§6.2 + §6.3）
 * 路由：/entry/review/campus/[campus]/[category]?year=115&month=3
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  approveCategory,
  editEntry,
  getReviewDetail,
  rejectCategory,
} from '@/lib/entry/api'
import type { ReviewDetailResponse, ReviewIndicatorRow } from '@/lib/entry/api'
import { formatChangePct, formatValue } from '@/lib/entry/validation'

// ─── 行內編輯元件 ─────────────────────────────────────────────

function InlineEditCell({
  entryId,
  field,
  value,
  onSaved,
}: {
  entryId: number
  field: string
  value: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const handleSave = async () => {
    if (!reason.trim()) { alert('請填寫修改理由'); return }
    setSaving(true)
    try {
      await editEntry(entryId, field, val, reason)
      setEditing(false)
      setReason('')
      onSaved()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1 min-w-[140px]">
        <input
          ref={inputRef}
          type="number"
          step="any"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="px-2 py-1 text-sm border rounded focus:ring-1 focus:ring-blue-400"
        />
        <input
          type="text"
          placeholder="修改理由（必填）"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="px-2 py-0.5 text-xs border rounded"
        />
        <div className="flex gap-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-xs bg-blue-600 text-white rounded py-0.5 hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '…' : '儲存'}
          </button>
          <button
            onClick={() => { setEditing(false); setVal(value) }}
            className="flex-1 text-xs border rounded py-0.5 hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm font-medium text-gray-800 hover:text-blue-600 hover:underline cursor-pointer"
      title="點擊修改"
    >
      {value || '—'}
    </button>
  )
}

// ─── 指標列 ─────────────────────────────────────────────────

function ReviewIndicatorRow({
  ind, isApproved, onEdited,
}: {
  ind: ReviewIndicatorRow
  isApproved: boolean
  onEdited: () => void
}) {
  const { text: changeText, color: changeColor } = formatChangePct(ind.change_pct)

  return (
    <>
      <tr className={`border-b ${ind.is_anomaly ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
        <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">
          {ind.indicator_code}
        </td>
        <td className="px-3 py-2 text-sm text-gray-700">
          {ind.indicator_name}
          {ind.entry_mode === 'case_list' && (
            <span className="ml-1 text-xs text-purple-600">（個案清單）</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-sm">
          {isApproved ? (
            <InlineEditCell
              entryId={ind.entry_id}
              field="numerator"
              value={ind.numerator !== null ? String(ind.numerator) : ''}
              onSaved={onEdited}
            />
          ) : (
            <span className="font-medium">{ind.numerator ?? '—'}</span>
          )}
          {ind.entry_mode === 'case_list' && ind.exclusion_count > 0 && (
            <span className="ml-1 text-xs text-gray-400">(-{ind.exclusion_count})</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-sm text-gray-500">
          {ind.has_denominator ? (ind.denominator ?? '—') : 'N/A'}
        </td>
        <td className="px-3 py-2 text-right text-sm font-medium">
          {ind.value !== null ? formatValue(ind.value, ind.unit) : '—'}
        </td>
        <td className="px-3 py-2 text-right text-sm text-gray-400">
          {ind.prev_value !== null ? formatValue(ind.prev_value, ind.unit) : '—'}
        </td>
        <td className={`px-3 py-2 text-right text-xs font-medium ${changeColor}`}>
          {changeText}
          {ind.is_anomaly && <span className="ml-1">⚠️</span>}
        </td>
      </tr>
      {/* 備註 + Audit log */}
      {(ind.note || ind.audit_logs.length > 0) && (
        <tr className="border-b bg-gray-50">
          <td colSpan={7} className="px-4 py-2">
            {ind.note && (
              <p className="text-xs text-gray-500 mb-1">
                💬 填報備註：{ind.note}
              </p>
            )}
            {ind.audit_logs.map((log, i) => (
              <p key={i} className="text-xs text-amber-700">
                📝 {log.changed_by} 於 {log.changed_at.slice(0, 16)} 修改 {log.field_name}：{log.old_value} → {log.new_value}
                {log.reason && ` （理由：${log.reason}）`}
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  )
}

// ─── 主頁面 ─────────────────────────────────────────────────

export default function ReviewDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()

  const campusCode = params.campus as string
  const categoryCode = (params.category as string).toUpperCase()
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear() - 1911))
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))

  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getReviewDetail(campusCode, year, month, categoryCode)
      setDetail(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [campusCode, year, month, categoryCode])

  const handleApprove = async () => {
    setProcessing(true)
    try {
      await approveCategory(campusCode, year, month, categoryCode)
      setMsg('✅ 已核准')
      await load()
    } catch (e: unknown) {
      setMsg(`❌ ${e instanceof Error ? e.message : '核准失敗'}`)
    } finally {
      setProcessing(false)
      setTimeout(() => setMsg(null), 3000)
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) { alert('請填寫退回理由'); return }
    setProcessing(true)
    try {
      await rejectCategory(campusCode, year, month, categoryCode, rejectReason)
      setMsg('🔙 已退回給填報者')
      setShowRejectInput(false)
      setRejectReason('')
      await load()
    } catch (e: unknown) {
      setMsg(`❌ ${e instanceof Error ? e.message : '退回失敗'}`)
    } finally {
      setProcessing(false)
      setTimeout(() => setMsg(null), 3000)
    }
  }

  if (loading) return <div className="p-8 text-gray-400">載入中…</div>
  if (error) return <div className="p-8 text-red-500">{error}</div>
  if (!detail) return null

  const { report, category, campus, indicators } = detail
  const isSubmitted = report.status === 'submitted'
  const isApproved = report.status === 'approved'
  const canAct = isSubmitted || isApproved

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/entry/review" className="text-gray-400 hover:text-gray-600 text-sm">
              ← 返回
            </Link>
            <div>
              <h1 className="text-base font-semibold text-gray-800">
                審核：{campus.name} · {category.name} · {year}年{month}月
              </h1>
              <p className="text-xs text-gray-500">
                填報者：{report.submitted_by ?? '—'} ·
                送審時間：{report.submitted_at?.slice(0, 16) ?? '—'}
                {report.is_late && <span className="ml-2 text-amber-600">⏰ 逾期</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {msg && (
              <span className={`text-xs ${msg.startsWith('✅') || msg.startsWith('🔙') ? 'text-green-600' : 'text-red-600'}`}>
                {msg}
              </span>
            )}
            {canAct && (
              <>
                <button
                  onClick={() => setShowRejectInput(!showRejectInput)}
                  disabled={processing}
                  className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  退回
                </button>
                {isSubmitted && (
                  <button
                    onClick={handleApprove}
                    disabled={processing}
                    className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                  >
                    {processing ? '處理中…' : '核准此面向'}
                  </button>
                )}
                {isApproved && (
                  <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg">
                    ✅ 已核准（可行內編輯）
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* 退回輸入區 */}
        {showRejectInput && (
          <div className="border-t bg-red-50 px-4 py-3 flex items-start gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="退回理由（必填，填報者可見）"
                className="w-full px-3 py-1.5 text-sm border border-red-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400 bg-white"
              />
            </div>
            <button
              onClick={handleReject}
              disabled={processing}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
            >
              確認退回
            </button>
            <button
              onClick={() => setShowRejectInput(false)}
              className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="px-3 py-2 text-left font-medium">代碼</th>
                <th className="px-3 py-2 text-left font-medium">指標名稱</th>
                <th className="px-3 py-2 text-right font-medium w-24">分子</th>
                <th className="px-3 py-2 text-right font-medium w-24">分母</th>
                <th className="px-3 py-2 text-right font-medium w-20">比率</th>
                <th className="px-3 py-2 text-right font-medium w-20">上月值</th>
                <th className="px-3 py-2 text-right font-medium w-16">變動</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((ind) => (
                <ReviewIndicatorRow
                  key={ind.indicator_code}
                  ind={ind}
                  isApproved={isApproved}
                  onEdited={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
