'use client'

/**
 * 面向填報表單頁（§5.2）
 * 路由：/entry/[category]?campus=<院區代碼>  例：/entry/HA03?campus=zhubei
 *
 * 欄位級指派（P6）：一個指標的分子、分母可以由不同的人負責。本頁
 *  - 只送「自己負責、而且改過」的欄位（lib/entry/draft.ts 的 buildDraftEntries），別人的欄位唯讀並標明由誰填寫；
 *  - 院區一律明確帶給後端（網址的 campus，沒有的話用表單回應裡的院區）；
 *  - 自動暫存讀 ref 裡最新的表單值與 baseline（不吃舊閉包），存檔後把他人欄位的最新值合併回畫面；
 *  - 送審前先暫存；後端回 400 incomplete 時列出缺漏欄位與負責人。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ApiError } from '@/lib/http'
import { getEntryForm, getMyTasks, saveDraft, submitCategory } from '@/lib/entry/api'
import {
  applyServerEntries,
  buildDraftEntries,
  buildInitialValues,
  mergeSavedIntoIndicators,
  sumSubEntries,
} from '@/lib/entry/draft'
import type {
  EntryFormResponse,
  FormField,
  FormValue,
  FormValues,
  IndicatorFormItem,
  MissingField,
} from '@/lib/entry/types'
import { hasErrors, missingLabel, parseMissing, validateForm } from '@/lib/entry/validation'
import IndicatorRow from '@/components/entry/IndicatorRow'

const AUTOSAVE_DELAY_MS = 3000
const REDIRECT_DELAY_MS = 1500
const FLASH_MS = 3000

const EMPTY_VALUE: FormValue = { numerator: '', denominator: '', note: '', sub_entries: {} }

/** The ROC year and month being filled: the current one, as everywhere else in the entry pages. */
function currentPeriod(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getFullYear() - 1911, month: now.getMonth() + 1 }
}

interface CampusChoice {
  code: string
  name: string
}

/**
 * What stops the page from showing a form at all. For `campus_required`, `choices` are the campuses the user has
 * tasks in for this category (null = my-tasks could not be read).
 */
interface LoadFailure {
  code?: string
  message: string
  choices?: CampusChoice[] | null
}

type SaveOutcome = 'saved' | 'unchanged' | 'locked' | 'failed'

// ─── 提交確認 Dialog ─────────────────────────────────────────

function SubmitConfirmDialog({
  subtitle,
  indicators,
  formValues,
  onConfirm,
  onCancel,
}: {
  subtitle: string
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
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
          <p className="text-sm text-gray-500">以下數值確認無誤後，點擊「確認送審」送出</p>
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

// ─── 送審缺漏清單 ────────────────────────────────────────────

function MissingPanel({
  message,
  items,
  onClose,
}: {
  message: string
  items: MissingField[]
  onClose: () => void
}) {
  return (
    <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800" role="alert">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">
          ❌ 尚不能送審{items.length > 0 ? `：此院區本面向還有 ${items.length} 個必填欄位沒填` : `：${message}`}
        </p>
        <button onClick={onClose} className="shrink-0 text-xs text-red-600 hover:underline">
          關閉
        </button>
      </div>
      {items.length > 0 && (
        <>
          <ul className="mt-2 space-y-0.5 list-disc pl-5">
            {items.map((m) => (
              <li key={`${m.indicator_code}:${m.field}`} className={m.unassigned ? 'font-medium' : ''}>
                {missingLabel(m)}
                {m.sub_codes && m.sub_codes.length > 0 && (
                  <span className="text-xs text-red-600">（子類別缺 {m.sub_codes.length} 項）</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-600">
            送審要整個「院區 × 面向」的必填欄位都填齊，包含他人負責的欄位；請通知對方填寫，「未指派」的欄位請聯絡管理員。
          </p>
        </>
      )}
    </div>
  )
}

// ─── 載入失敗／選院區 ────────────────────────────────────────

function LoadFailurePanel({ failure, categoryCode }: { failure: LoadFailure; categoryCode: string }) {
  const choices = failure.choices ?? []
  if (failure.code === 'campus_required' && choices.length > 0) {
    return (
      <div className="max-w-md mx-auto p-6">
        <div className="bg-white border rounded-lg p-5">
          <h2 className="text-base font-semibold text-gray-800">請選擇院區</h2>
          <p className="text-sm text-gray-500 mt-1">
            你在 {categoryCode} 面向有多個院區的指派，請選擇要填報的院區。
          </p>
          <div className="mt-3 space-y-2">
            {choices.map((c) => (
              <Link
                key={c.code}
                href={`/entry/${categoryCode}?campus=${encodeURIComponent(c.code)}`}
                className="block px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 text-gray-800"
              >
                {c.name} →
              </Link>
            ))}
          </div>
          <Link href="/entry" className="inline-block mt-4 text-sm text-gray-500 hover:underline">
            ← 返回我的任務
          </Link>
        </div>
      </div>
    )
  }

  // my-tasks listed no campus for this category (nothing is assigned to the user here) or could not be read.
  const message =
    failure.code === 'campus_required' && failure.choices
      ? '這個面向沒有指派給你的指標，無法填報。'
      : failure.message
  return (
    <div className="max-w-md mx-auto p-6 text-center">
      <p className="text-red-500">{message}</p>
      <Link href="/entry" className="inline-block mt-4 text-sm text-gray-500 hover:underline">
        ← 返回我的任務
      </Link>
    </div>
  )
}

/** The campuses the user has tasks in for one category, from my-tasks; null when that cannot be read. */
async function loadCampusChoices(year: number, month: number, categoryCode: string): Promise<CampusChoice[] | null> {
  try {
    const tasks = await getMyTasks(year, month)
    const seen = new Map<string, CampusChoice>()
    for (const t of tasks.categories) {
      if (t.category_code === categoryCode && !seen.has(t.campus_code)) {
        seen.set(t.campus_code, { code: t.campus_code, name: t.campus_name })
      }
    }
    return Array.from(seen.values())
  } catch {
    return null
  }
}

// ─── 主頁面 ─────────────────────────────────────────────────

// 有效的面向代碼格式：HA01 ~ HA10
const VALID_CATEGORY_RE = /^HA\d{2}$/

function CategoryForm() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const categoryCode = (params.category as string).toUpperCase()
  const campusParam = searchParams.get('campus') ?? ''

  // 防止 /entry/admin、/entry/review 等靜態路由被動態路由攔截（.next cache 過期時可能發生）
  useEffect(() => {
    if (!VALID_CATEGORY_RE.test(categoryCode)) {
      router.replace(`/entry/${params.category as string}`)
    }
  }, [categoryCode, params.category, router])

  const [formData, setFormData] = useState<EntryFormResponse | null>(null)
  const [formValues, setFormValues] = useState<FormValues>({})
  const [loading, setLoading] = useState(true)
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [missing, setMissing] = useState<{ message: string; items: MissingField[] } | null>(null)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)  // 送審驗證模式

  // The latest of everything the timers and async handlers need. State alone would hand them the values of the
  // render they were created in - an autosave scheduled by a keystroke would save the form as it was before it.
  const formDataRef = useRef<EntryFormResponse | null>(null)
  const formValuesRef = useRef<FormValues>({})
  // What the server is known to hold: the values loaded, or last sent successfully (see lib/entry/draft.ts).
  const baselineRef = useRef<FormValues>({})
  const loadSeq = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Saves and submits one at a time, each starting from the form as it is when its turn comes. */
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job)
    queue.current = run.catch(() => undefined)
    return run
  }, [])

  const flash = useCallback((type: 'ok' | 'err', text: string) => {
    setSaveMsg({ type, text })
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setSaveMsg(null), FLASH_MS)
  }, [])

  const commitFormValues = useCallback((next: FormValues) => {
    formValuesRef.current = next
    setFormValues(next)
  }, [])

  // ── 載入 ──────────────────────────────────────────────────
  // `silent`: refresh in place (no full-page spinner), used after the server says the report got locked.
  const loadForm = useCallback(async (silent: boolean) => {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    const { year, month } = currentPeriod()
    try {
      const data = await getEntryForm(year, month, categoryCode, campusParam || undefined)
      if (seq !== loadSeq.current) return
      const values = buildInitialValues(data.indicators)
      formDataRef.current = data
      baselineRef.current = values
      setFormData(data)
      commitFormValues(values)
      setLoadFailure(null)
      if (data.report.locked) setMissing(null)  // a gap list means nothing once the report is locked
    } catch (e) {
      if (seq !== loadSeq.current) return
      if (silent) {
        flash('err', e instanceof Error ? e.message : '重新載入失敗')
        return
      }
      const code = e instanceof ApiError ? e.code : undefined
      const message = e instanceof Error ? e.message : '載入失敗'
      // Several campuses and none named: let the user pick one of those they have tasks in.
      const choices = code === 'campus_required' ? await loadCampusChoices(year, month, categoryCode) : undefined
      if (seq !== loadSeq.current) return
      setFormData(null)
      formDataRef.current = null
      setLoadFailure({ code, message, choices })
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [categoryCode, campusParam, commitFormValues, flash])

  // ── 暫存 ──────────────────────────────────────────────────
  const saveOnce = useCallback(async (feedback: boolean): Promise<SaveOutcome> => {
    const data = formDataRef.current
    if (!data) return 'failed'
    if (data.report.locked) return 'locked'

    // Snapshot of what is sent: typing while the request is in flight must stay "edited", not count as saved.
    const sent = formValuesRef.current
    const entries = buildDraftEntries(sent, baselineRef.current, data.indicators)
    if (entries.length === 0) {
      if (feedback) flash('ok', '沒有需要儲存的變更')
      return 'unchanged'
    }

    setSaving(true)
    try {
      const res = await saveDraft({
        year: data.period.year,
        month: data.period.month,
        category: data.category.code,
        campus: data.campus.code,
        entries,
      })
      // The form was reloaded while the request was out (e.g. the report got locked): the answer is about the old one.
      if (formDataRef.current !== data) return 'saved'

      // The server now holds what was sent. Take its latest values for everything the user has not edited since
      // (other people's fields above all) and remember its values as the new baseline.
      commitFormValues(applyServerEntries(formValuesRef.current, res.entries, sent))
      baselineRef.current = applyServerEntries(sent, res.entries)
      const next: EntryFormResponse = {
        ...data,
        report: { ...data.report, id: res.report_id ?? data.report.id, status: res.status },
        indicators: mergeSavedIntoIndicators(data.indicators, res.entries),
      }
      formDataRef.current = next
      setFormData(next)
      if (feedback) flash('ok', '已暫存')
      return 'saved'
    } catch (e) {
      if (e instanceof ApiError && e.code === 'report_locked') {
        flash('err', '此月報已送審或核准，無法再編輯')
        void loadForm(true)  // the form then turns read-only
        return 'locked'
      }
      const stale = e instanceof ApiError && (e.code === 'field_not_assigned' || e.code === 'not_assigned')
      const msg = e instanceof Error ? e.message : '暫存失敗'
      flash('err', stale ? `${msg}（指派可能已變更，請重新整理頁面）` : msg)
      return 'failed'
    } finally {
      setSaving(false)
    }
  }, [commitFormValues, flash, loadForm])

  useEffect(() => {
    void loadForm(false)
    return () => {
      // Leaving (or switching campus) within the debounce window: send what is still unsaved.
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
        autoSaveTimer.current = null
        void enqueue(() => saveOnce(false))
      }
    }
  }, [loadForm, enqueue, saveOnce])

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      if (redirectTimer.current) clearTimeout(redirectTimer.current)
    }
  }, [])

  // 自動 debounce 暫存（每次輸入後 3 秒）
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null
      void enqueue(() => saveOnce(false))
    }, AUTOSAVE_DELAY_MS)
  }, [enqueue, saveOnce])

  const handleManualSave = () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = null
    }
    void enqueue(() => saveOnce(true))
  }

  const handleChange = (indicatorCode: string, field: FormField, subCode: string | null, val: string) => {
    if (formDataRef.current?.report.locked) return
    const prev = formValuesRef.current
    const cur = prev[indicatorCode] ?? EMPTY_VALUE
    let next: FormValue
    if (field === 'sub') {
      if (!subCode) return
      // HA10-01 at Hsinchu: the numerator is the sum of the sub-categories, keep it in step with them.
      const subs = { ...cur.sub_entries, [subCode]: val }
      next = { ...cur, sub_entries: subs, numerator: sumSubEntries(subs) }
    } else {
      next = { ...cur, [field]: val }
    }
    commitFormValues({ ...prev, [indicatorCode]: next })
    scheduleAutoSave()
  }

  // ── 送審 ──────────────────────────────────────────────────
  const handleSubmitClick = () => {
    setIsSubmitting(true)
    // 先做一次驗證
    if (!formData) return
    const validations = validateForm(formData.indicators, formValuesRef.current, true)
    if (hasErrors(validations)) {
      flash('err', '請修正紅色錯誤後再送審')
      return
    }
    setShowSubmitDialog(true)
  }

  const handleSubmitConfirm = async () => {
    if (!formDataRef.current) return
    setShowSubmitDialog(false)
    setSubmitting(true)
    setMissing(null)
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = null
    }
    try {
      await enqueue(async () => {
        // 先暫存，再送審
        const outcome = await saveOnce(false)
        if (outcome === 'failed' || outcome === 'locked') return  // saveOnce has already said why
        const data = formDataRef.current
        if (!data) return
        try {
          await submitCategory(data.period.year, data.period.month, data.category.code, data.campus.code)
        } catch (e) {
          if (e instanceof ApiError && e.code === 'incomplete') {
            // Required fields are still empty somewhere in the campus x category - likely somebody else's.
            setMissing({ message: e.message, items: parseMissing(e.data) ?? [] })
          } else if (e instanceof ApiError && e.code === 'report_locked') {
            flash('err', '此月報已送審或核准，無法再編輯')
            void loadForm(true)
          } else {
            flash('err', e instanceof Error ? e.message : '送審失敗')
          }
          return
        }
        const submitted: EntryFormResponse = {
          ...data,
          report: { ...data.report, status: 'submitted', locked: true },
        }
        formDataRef.current = submitted
        setFormData(submitted)
        flash('ok', '✅ 送審成功！')
        redirectTimer.current = setTimeout(() => router.push('/entry'), REDIRECT_DELAY_MS)
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-gray-500">載入中…</div>
      </div>
    )
  }

  if (!formData) {
    return <LoadFailurePanel failure={loadFailure ?? { message: '資料載入失敗' }} categoryCode={categoryCode} />
  }

  const { report, category, period, deadline } = formData
  const locked = report.locked
  const validations = validateForm(formData.indicators, formValues, isSubmitting)
  const formHasErrors = hasErrors(validations)

  return (
    <div>
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
                onClick={handleManualSave}
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
              {report.status === 'submitted'
                ? '🔍 審核中（鎖定）'
                : report.status === 'approved'
                  ? '✅ 已核准（鎖定）'
                  : '🔒 已完成'}
            </span>
          )}
        </div>
      </header>

      {/* 表格 */}
      <main className="max-w-5xl mx-auto p-4">
        {locked && (
          <div className="mb-3 bg-gray-50 border rounded-lg px-3 py-2 text-sm text-gray-600">
            {report.status === 'submitted'
              ? '已送審，審核中無法編輯；如需修改請洽品管中心退回。'
              : report.status === 'approved'
                ? '已核准，無法編輯；如需修改請洽品管中心。'
                : '已送出，無法編輯。'}
          </div>
        )}

        {missing && (
          <MissingPanel message={missing.message} items={missing.items} onClose={() => setMissing(null)} />
        )}

        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="px-3 py-2 text-left font-medium">代碼</th>
                <th className="px-3 py-2 text-left font-medium">指標名稱</th>
                <th className="px-3 py-2 text-left font-medium w-32">分子</th>
                <th className="px-3 py-2 text-left font-medium w-32">分母</th>
                <th className="px-3 py-2 text-right font-medium w-20">比率</th>
                <th className="px-3 py-2 text-right font-medium w-20">上月值</th>
                <th className="px-3 py-2 text-right font-medium w-16">變動</th>
              </tr>
            </thead>
            <tbody>
              {formData.indicators.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                    此院區的這個面向沒有指派給你的指標
                  </td>
                </tr>
              )}
              {formData.indicators.map((ind) => (
                <IndicatorRow
                  key={ind.indicator_code}
                  indicator={ind}
                  value={formValues[ind.indicator_code] ?? EMPTY_VALUE}
                  validation={validations[ind.indicator_code] ?? { level: 'ok', message: '' }}
                  locked={locked}
                  campusCode={formData.campus.code}
                  year={period.year}
                  month={period.month}
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
              onClick={handleManualSave}
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
          subtitle={`${formData.campus.name} · ${category.name} · ${period.year}年${period.month}月`}
          indicators={formData.indicators}
          formValues={formValues}
          onConfirm={handleSubmitConfirm}
          onCancel={() => { setShowSubmitDialog(false); setIsSubmitting(false) }}
        />
      )}
    </div>
  )
}

/** `useSearchParams` (the campus in the URL) needs a Suspense boundary above it. */
export default function CategoryFormPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <div className="text-gray-500">載入中…</div>
        </div>
      }
    >
      <CategoryForm />
    </Suspense>
  )
}
