'use client'

/**
 * 面向填報表單頁（§5.2）
 * 路由：/entry/[category]  例：/entry/HA03
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  formValuesToDraftEntries,
  getEntryForm,
  saveDraft,
  submitCategory,
} from '@/lib/entry/api'
import type {
  EntryFormResponse,
  FormValue,
  FormValues,
  IndicatorFormItem,
} from '@/lib/entry/types'
import {
  hasErrors,
  validateForm,
} from '@/lib/entry/validation'
import IndicatorRow from '@/components/entry/IndicatorRow'

// ─── 初始表單值（從 API 回應載入）────────────────────────────

function buildInitialValues(indicators: IndicatorFormItem[]): FormValues {
  const vals: FormValues = {}
  for (const ind of indicators) {
    const subMap: Record<string, string> = {}
    for (const sub of ind.sub_entries) {
      subMap[sub.sub_code] = sub.value !== null ? String(sub.value) : ''
    }
    vals[ind.indicator_code] = {
      numerator: ind.numerator !== null ? String(ind.numerator) : '',
      denominator: ind.denominator !== null ? String(ind.denominator) : '',
      note: ind.note ?? '',
      sub_entries: subMap,
    }
  }
  return vals
}

// ─── 提交確認 Dialog ─────────────────────────────────────────

function SubmitConfirmDialog({
  indicators,
  formValues,
  onConfirm,
  onCancel,
}: {
  indicators: IndicatorFormItem[]
  formValues: FormValues
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-5 border-b">
          <h3 className="text-base font-semibold text-gray-800">確認送審</h3>
          <p className="text-sm text-gray-500 mt-1">以下數值確認無誤後，點擊「確認送審」送出</p>
        </div>
        <div className="p-5 max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b">
                <th className="text-left pb-1">指標</th>
                <th className="text-right pb-1">分子</th>
                <th className="text-right pb-1">分母</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((ind) => {
                const fv = formValues[ind.indicator_code]
                return (
                  <tr key={ind.indicator_code} className="border-b last:border-0">
                    <td className="py-1.5 text-gray-700">
                      <span className="font-mono text-xs text-gray-400 mr-1">{ind.indicator_code}</span>
                      {ind.indicator_name}
                    </td>
                    <td className="py-1.5 text-right font-medium">{fv?.numerator || '—'}</td>
                    <td className="py-1.5 text-right text-gray-500">
                      {ind.has_denominator ? (fv?.denominator || '—') : 'N/A'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="p-5 border-t flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
          >
            返回修改
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            確認送審
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 主頁面 ─────────────────────────────────────────────────

// 有效的面向代碼格式：HA01 ~ HA10
const VALID_CATEGORY_RE = /^HA\d{2}$/

export default function CategoryFormPage() {
  const params = useParams()
  const router = useRouter()
  const categoryCode = (params.category as string).toUpperCase()

  // 防止 /entry/admin、/entry/review 等靜態路由被動態路由攔截（.next cache 過期時可能發生）
  useEffect(() => {
    if (!VALID_CATEGORY_RE.test(categoryCode)) {
      router.replace(`/entry/${params.category as string}`)
    }
  }, [categoryCode, params.category, router])

  const [formData, setFormData] = useState<EntryFormResponse | null>(null)
  const [formValues, setFormValues] = useState<FormValues>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)  // 送審驗證模式
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const now = new Date()
        const year = now.getFullYear() - 1911
        const month = now.getMonth() + 1
        const data = await getEntryForm(year, month, categoryCode)
        setFormData(data)
        setFormValues(buildInitialValues(data.indicators))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '載入失敗'
        setSaveMsg({ type: 'err', text: msg })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [categoryCode])

  // 自動 debounce 暫存（每次輸入後 3 秒）
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      doSave(false)
    }, 3000)
  }, [formValues, formData])  // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = async (showFeedback = true) => {
    if (!formData) return
    setSaving(true)
    try {
      const entries = formValuesToDraftEntries(formValues, formData.indicators)
      await saveDraft({
        year: formData.period.year,
        month: formData.period.month,
        category: categoryCode,
        entries,
      })
      if (showFeedback) setSaveMsg({ type: 'ok', text: '已暫存' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '暫存失敗'
      setSaveMsg({ type: 'err', text: msg })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  const handleChange = (
    indicatorCode: string,
    field: keyof FormValue | 'sub',
    subCode: string | null,
    val: string
  ) => {
    setFormValues((prev) => {
      const cur = prev[indicatorCode] ?? { numerator: '', denominator: '', note: '', sub_entries: {} }
      if (field === 'sub' && subCode) {
        return {
          ...prev,
          [indicatorCode]: { ...cur, sub_entries: { ...cur.sub_entries, [subCode]: val } },
        }
      }
      return { ...prev, [indicatorCode]: { ...cur, [field]: val } }
    })
    triggerAutoSave()
  }

  const handleSubmitClick = () => {
    setIsSubmitting(true)
    // 先做一次驗證
    if (!formData) return
    const validations = validateForm(formData.indicators, formValues, true)
    if (hasErrors(validations)) {
      setSaveMsg({ type: 'err', text: '請修正紅色錯誤後再送審' })
      return
    }
    setShowSubmitDialog(true)
  }

  const handleSubmitConfirm = async () => {
    if (!formData) return
    setShowSubmitDialog(false)
    setSubmitting(true)
    try {
      // 先暫存，再送審
      const entries = formValuesToDraftEntries(formValues, formData.indicators)
      await saveDraft({
        year: formData.period.year,
        month: formData.period.month,
        category: categoryCode,
        entries,
      })
      await submitCategory(formData.period.year, formData.period.month, categoryCode)
      setSaveMsg({ type: 'ok', text: '✅ 送審成功！' })
      setTimeout(() => router.push('/entry'), 1500)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '送審失敗'
      setSaveMsg({ type: 'err', text: msg })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">載入中…</div>
      </div>
    )
  }

  if (!formData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500">{saveMsg?.text ?? '資料載入失敗'}</div>
      </div>
    )
  }

  const { report, category, period, deadline } = formData
  const locked = report.status === 'submitted' || report.status === 'finalized'
  const validations = validateForm(formData.indicators, formValues, isSubmitting)
  const formHasErrors = hasErrors(validations)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部操作欄 */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/entry" className="text-gray-400 hover:text-gray-600 text-sm shrink-0">
              ← 返回
            </Link>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-800 truncate">
                <span
                  className="inline-block w-2 h-4 rounded-sm mr-2 align-middle"
                  style={{ backgroundColor: category.color }}
                />
                {category.name}
              </h1>
              <p className="text-xs text-gray-500">
                {period.year}年{period.month}月 · {formData.campus.name}
                {deadline.is_overdue && (
                  <span className="ml-2 text-amber-600">⏰ 逾期</span>
                )}
              </p>
            </div>
          </div>

          {/* 退回提醒 */}
          {report.rejection_reason && (
            <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 text-xs text-red-700 truncate">
              🔙 退回理由：{report.rejection_reason}
            </div>
          )}

          {/* 儲存狀態 */}
          {saveMsg && (
            <span className={`text-xs shrink-0 ${saveMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
              {saveMsg.text}
            </span>
          )}

          {/* 操作按鈕 */}
          {!locked && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => doSave(true)}
                disabled={saving}
                className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {saving ? '暫存中…' : '暫存'}
              </button>
              <button
                onClick={handleSubmitClick}
                disabled={submitting || formHasErrors}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {submitting ? '送審中…' : '送審此面向'}
              </button>
            </div>
          )}

          {locked && (
            <span className="text-xs text-gray-500 shrink-0 border rounded-lg px-2 py-1">
              {report.status === 'submitted' ? '🔍 審核中（鎖定）' : '🔒 已完成'}
            </span>
          )}
        </div>
      </header>

      {/* 表格 */}
      <main className="max-w-5xl mx-auto p-4">
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="px-3 py-2 text-left font-medium">代碼</th>
                <th className="px-3 py-2 text-left font-medium">指標名稱</th>
                {/* 動態欄位標頭 */}
                {formData.indicators.some(i => i.has_denominator && !i.is_ha10_hsinchu) && (
                  <>
                    <th className="px-3 py-2 text-left font-medium w-24">分子</th>
                    <th className="px-3 py-2 text-left font-medium w-24">分母</th>
                  </>
                )}
                <th className="px-3 py-2 text-right font-medium w-20">比率</th>
                <th className="px-3 py-2 text-right font-medium w-20">上月值</th>
                <th className="px-3 py-2 text-right font-medium w-16">變動</th>
              </tr>
            </thead>
            <tbody>
              {formData.indicators.map((ind) => (
                <IndicatorRow
                  key={ind.indicator_code}
                  indicator={ind}
                  value={formValues[ind.indicator_code] ?? { numerator: '', denominator: '', note: '', sub_entries: {} }}
                  validation={validations[ind.indicator_code] ?? { level: 'ok', message: '' }}
                  locked={locked}
                  onChange={(field, subCode, val) =>
                    handleChange(ind.indicator_code, field, subCode, val)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* 全域錯誤提示 */}
        {isSubmitting && formHasErrors && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            ❌ 請修正上方紅色錯誤後再送審
          </div>
        )}

        {/* 底部按鈕（備用） */}
        {!locked && (
          <div className="mt-4 flex justify-end gap-3">
            <button
              onClick={() => doSave(true)}
              disabled={saving}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? '暫存中…' : '暫存草稿'}
            </button>
            <button
              onClick={handleSubmitClick}
              disabled={submitting}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              送審此面向
            </button>
          </div>
        )}
      </main>

      {/* 送審確認對話框 */}
      {showSubmitDialog && formData && (
        <SubmitConfirmDialog
          indicators={formData.indicators}
          formValues={formValues}
          onConfirm={handleSubmitConfirm}
          onCancel={() => { setShowSubmitDialog(false); setIsSubmitting(false) }}
        />
      )}
    </div>
  )
}
