'use client'

/**
 * 個案清單審查介面（§5A.2）
 * 路由：/entry/case-list/[indicator]?campus=zhubei&year=115&month=3
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import {
  excludeCases,
  getCaseList,
  getExclusionReasons,
  restoreCases,
} from '@/lib/entry/api'
import type { CaseListResponse, CaseRecord, ExclusionReason } from '@/lib/entry/api'

// ─── 排除操作面板 ────────────────────────────────────────────

function ExclusionPanel({
  selectedIds,
  reasons,
  onExclude,
  onRestore,
  onCancel,
}: {
  selectedIds: number[]
  reasons: ExclusionReason[]
  onExclude: (reasonCode: string, note: string) => Promise<void>
  onRestore: () => Promise<void>
  onCancel: () => void
}) {
  const [reasonCode, setReasonCode] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const handleExclude = async () => {
    if (!reasonCode) { alert('請選擇排除理由'); return }
    if (reasonCode === 'OTHER' && !note.trim()) { alert('選擇「其他」時補充說明必填'); return }
    setSaving(true)
    try {
      await onExclude(reasonCode, note)
      setReasonCode('')
      setNote('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
      <p className="text-sm font-medium text-amber-800 mb-3">
        已選取 {selectedIds.length} 筆個案
      </p>
      <div className="flex flex-col gap-2 mb-3">
        <select
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400"
        >
          <option value="">── 選擇排除理由 ──</option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>{r.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={reasonCode === 'OTHER' ? '補充說明（必填）' : '補充說明（選填）'}
          className="px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleExclude}
          disabled={saving}
          className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
        >
          {saving ? '處理中…' : '確認排除'}
        </button>
        <button
          onClick={async () => { setSaving(true); await onRestore(); setSaving(false) }}
          disabled={saving}
          className="px-3 py-1.5 text-sm border text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          取消排除
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600">
          取消選取
        </button>
      </div>
    </div>
  )
}

// ─── 個案列 ─────────────────────────────────────────────────

function CaseRow({
  record,
  selected,
  onToggle,
}: {
  record: CaseRecord
  selected: boolean
  onToggle: () => void
}) {
  const raw = record.his_raw_data
  return (
    <tr
      className={`border-b cursor-pointer hover:bg-gray-50 ${record.is_excluded ? 'opacity-60' : ''} ${selected ? 'bg-blue-50' : ''}`}
      onClick={onToggle}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="rounded"
        />
      </td>
      <td className="px-3 py-2 text-xs font-mono text-gray-700">
        {String(raw.chart_no ?? '—')}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {String(raw.admission_date ?? '—')}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {String(raw.discharge_date ?? '—')}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {String(raw.outcome ?? '—')}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {String(raw.dept ?? '')} {String(raw.ward ?? '')}
      </td>
      <td className="px-3 py-2 text-xs">
        {record.is_excluded ? (
          <div>
            <span className="text-red-600 font-medium">✗ 已排除</span>
            <br />
            <span className="text-gray-500">
              {record.exclusion_reason_name}
              {record.exclusion_note && `：${record.exclusion_note}`}
            </span>
          </div>
        ) : (
          <span className="text-green-600 font-medium">✓ 保留</span>
        )}
      </td>
    </tr>
  )
}

// ─── 主頁面 ─────────────────────────────────────────────────

export default function CaseListPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const indicatorCode = params.indicator as string
  const campus = searchParams.get('campus') ?? ''
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear() - 1911))
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))

  const [data, setData] = useState<CaseListResponse | null>(null)
  const [reasons, setReasons] = useState<ExclusionReason[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<'all' | 'numerator' | 'excluded'>('all')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const [d, r] = await Promise.all([
        getCaseList(indicatorCode, campus, year, month),
        getExclusionReasons(),
      ])
      setData(d)
      setReasons(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [indicatorCode, campus, year, month])

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExclude = async (reasonCode: string, note: string) => {
    await excludeCases(Array.from(selected), reasonCode, note)
    setSelected(new Set())
    await load()
  }

  const handleRestore = async () => {
    await restoreCases(Array.from(selected))
    setSelected(new Set())
    await load()
  }

  if (loading) return <div className="p-8 text-gray-400">載入中…</div>
  if (error) return <div className="p-8 text-red-500">{error}</div>
  if (!data) return null

  const { summary, records } = data

  const filteredRecords = records.filter((r) => {
    if (filter === 'numerator') return r.case_role === 'numerator'
    if (filter === 'excluded') return r.is_excluded
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/entry/${indicatorCode.split('-')[0]}`} className="text-gray-400 hover:text-gray-600 text-sm">
            ← 返回
          </Link>
          <div>
            <h1 className="text-base font-semibold text-gray-800">
              {indicatorCode} 個案清單審查
            </h1>
            <p className="text-xs text-gray-500">{year}年{month}月 · {campus}</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        {/* 摘要卡片 */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: '分母（全部）', value: summary.denominator_total, note: '住院人數' },
            { label: '原始分子', value: summary.raw_numerator, note: '事件數' },
            { label: '排除', value: summary.excluded, note: '被排除' },
            { label: '最終分子', value: summary.final_numerator, note: '確認事件', highlight: true },
          ].map((item) => (
            <div key={item.label} className={`bg-white border rounded-lg p-3 text-center ${item.highlight ? 'border-blue-300' : ''}`}>
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className={`text-2xl font-bold ${item.highlight ? 'text-blue-700' : 'text-gray-800'}`}>
                {item.value}
              </p>
              <p className="text-xs text-gray-400">{item.note}</p>
            </div>
          ))}
        </div>

        {/* 比率 */}
        <div className="bg-white border rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-gray-600">當前比率</span>
          <span className="text-lg font-bold text-blue-700">
            {summary.denominator_total > 0
              ? `${summary.final_numerator} / ${summary.denominator_total} = ${(summary.final_numerator / summary.denominator_total * 100).toFixed(2)}%`
              : '—'}
          </span>
        </div>

        {/* 篩選 */}
        <div className="flex gap-2 mb-3">
          {(['all', 'numerator', 'excluded'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-sm rounded-full border ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {f === 'all' ? '全部' : f === 'numerator' ? '分子個案' : '已排除'}
            </button>
          ))}
          <span className="text-xs text-gray-400 self-center ml-2">
            顯示 {filteredRecords.length} 筆
          </span>
        </div>

        {/* 個案清單表格 */}
        <div className="bg-white border rounded-lg overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left">病歷號</th>
                <th className="px-3 py-2 text-left">入院日</th>
                <th className="px-3 py-2 text-left">出院日</th>
                <th className="px-3 py-2 text-left">轉歸</th>
                <th className="px-3 py-2 text-left">科別/病房</th>
                <th className="px-3 py-2 text-left">狀態</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <CaseRow
                  key={record.id}
                  record={record}
                  selected={selected.has(record.id)}
                  onToggle={() => toggleSelect(record.id)}
                />
              ))}
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">
                    無個案資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 排除操作面板 */}
        {selected.size > 0 && (
          <ExclusionPanel
            selectedIds={Array.from(selected)}
            reasons={reasons}
            onExclude={handleExclude}
            onRestore={handleRestore}
            onCancel={() => setSelected(new Set())}
          />
        )}
      </main>
    </div>
  )
}
