/**
 * 填報即時驗證邏輯（§5.3）與欄位級指派的顯示輔助
 *
 * 硬性阻擋（error）：分子 > 分母、負數、送審時自己負責的欄位有空值
 * 柔性提醒（warning）：±30% 變動、分母為 0、數值為 0 但上月非 0、
 *                      送審時他人負責的欄位還是空的（不擋按鈕，送審由後端最終判定）
 *
 * Pure functions with type-only imports, so `npm run test:unit` (node --test) can load this file.
 */
import type {
  EntryField,
  FormValue,
  FormValidations,
  IndicatorFormItem,
  MissingField,
  ValidationResult,
} from './types'

const SOFT_CHANGE_THRESHOLD = 30  // 柔性提醒：月變動 > 30%

const OK: ValidationResult = { level: 'ok', message: '' }

export const FIELD_LABEL: Record<EntryField, string> = { numerator: '分子', denominator: '分母' }

// ─── 欄位級指派的顯示輔助 ──────────────────────────────────────

/** Names of the people responsible for a field, or 未指派 when there is nobody. */
export function ownersLabel(owners: readonly string[]): string {
  return owners.length > 0 ? owners.join('、') : '未指派'
}

const STAMP_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',  // the hospital's clock, whatever the browser's time zone is
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** An ISO time as "10/11 14:32" (Taipei time); '' for a missing or unreadable one. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const part: Record<string, string> = {}
  for (const p of STAMP_FORMAT.formatToParts(date)) part[p.type] = p.value
  return `${part.month}/${part.day} ${part.hour}:${part.minute}`
}

/** "王小明 10/11 14:32"; '' when nobody has filled the field yet. */
export function filledStamp(by: string | null | undefined, at: string | null | undefined): string {
  if (!by) return ''
  return `${by} ${formatStamp(at)}`.trim()
}

/** The one rule of which indicator is entered as 13 sub-categories (backend: services.values.uses_sub_entries). */
export function usesSubEntries(indicatorCode: string, campusCode: string): boolean {
  return indicatorCode === 'HA10-01' && campusCode === 'hsinchu'
}

/** "HA03-01 住院死亡率 — 分母（王小明）"; "（未指派）" when nobody is responsible for the field. */
export function missingLabel(item: MissingField): string {
  return `${item.indicator_code} ${item.indicator_name} — ${FIELD_LABEL[item.field]}（${ownersLabel(item.owners)}）`
}

/**
 * The `missing` list of a 400 `incomplete` answer (ApiError.data of submit), or null when the body has none.
 * Entries that are not shaped like a gap are dropped rather than trusted.
 */
export function parseMissing(data: unknown): MissingField[] | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = (data as { missing?: unknown }).missing
  if (!Array.isArray(raw)) return null
  const items: MissingField[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const m = r as Record<string, unknown>
    if (typeof m.indicator_code !== 'string') continue
    if (m.field !== 'numerator' && m.field !== 'denominator') continue
    const owners = Array.isArray(m.owners) ? m.owners.filter((o): o is string => typeof o === 'string') : []
    items.push({
      indicator_code: m.indicator_code,
      indicator_name: typeof m.indicator_name === 'string' ? m.indicator_name : m.indicator_code,
      field: m.field,
      owners,
      unassigned: m.unassigned === true || owners.length === 0,
      sub_codes: Array.isArray(m.sub_codes) ? m.sub_codes.filter((c): c is string => typeof c === 'string') : undefined,
    })
  }
  return items
}

// ─── 驗證 ──────────────────────────────────────────────────────

function allSubsFilled(indicator: IndicatorFormItem, fv: FormValue): boolean {
  return indicator.sub_entries.every((sub) => (fv.sub_entries[sub.sub_code] ?? '').trim() !== '')
}

/** Whether a required field of the indicator is still empty in the form. */
function isEmpty(indicator: IndicatorFormItem, fv: FormValue, field: EntryField): boolean {
  if (field === 'denominator') return fv.denominator.trim() === ''
  return indicator.is_ha10_hsinchu ? !allSubsFilled(indicator, fv) : fv.numerator.trim() === ''
}

/** The fields the indicator needs before it can be submitted (same rule as the backend's required_fields). */
function requiredFields(indicator: IndicatorFormItem): EntryField[] {
  return indicator.has_denominator ? ['numerator', 'denominator'] : ['numerator']
}

/** The hard error for a required field of mine that is empty at submit time, or null. */
function ownFieldError(indicator: IndicatorFormItem, fv: FormValue): ValidationResult | null {
  const mine = new Set(indicator.editable_fields)
  const empty = requiredFields(indicator).filter((f) => mine.has(f) && isEmpty(indicator, fv, f))
  if (empty.length === 0) return null
  if (empty.includes('numerator') && indicator.is_ha10_hsinchu) {
    return { level: 'error', message: '送審前所有子類別皆必須填寫' }
  }
  if (empty.length === 2) return { level: 'error', message: '送審前分子與分母皆必須填寫' }
  if (empty[0] === 'denominator') return { level: 'error', message: '送審前分母必須填寫' }
  return {
    level: 'error',
    message: indicator.has_denominator ? '送審前分子必須填寫' : '送審前必須填寫數值',
  }
}

/**
 * The warning for required fields that somebody else owns and that are still empty at submit time, or null.
 * It never blocks: whether the report can be submitted is decided by the backend, which checks the whole campus.
 */
function othersPending(indicator: IndicatorFormItem, fv: FormValue): ValidationResult | null {
  const mine = new Set(indicator.editable_fields)
  const empty = requiredFields(indicator).filter((f) => !mine.has(f) && isEmpty(indicator, fv, f))
  if (empty.length === 0) return null
  if (indicator.entry_mode === 'case_list') {
    return { level: 'warning', message: '個案清單指標：數值尚未產生（來自個案清單頁或匯入）' }
  }
  const parts = empty.map((f) => `${FIELD_LABEL[f]}尚未填寫（${ownersLabel(indicator.field_owners[f])}）`)
  const unassigned = empty.some((f) => indicator.field_owners[f].length === 0)
  return {
    level: 'warning',
    message: `${parts.join('；')}，${unassigned ? '請聯絡管理員指派負責人' : '需等對方填完才能送審'}`,
  }
}

/**
 * 驗證單一指標的輸入值
 *
 * 送審時的必填檢查只看 editable_fields（自己負責的欄位）；他人負責的欄位若還是空的只給 warning。
 */
export function validateIndicator(
  indicator: IndicatorFormItem,
  fv: FormValue | undefined,
  isSubmitting = false
): ValidationResult {
  if (!fv) {
    if (isSubmitting && indicator.editable_fields.length > 0) {
      return { level: 'error', message: '送審前必須填寫數值' }
    }
    return OK
  }

  const numStr = fv.numerator.trim()
  const denStr = fv.denominator.trim()

  // ── 空值檢查（送審時）──────────────────────────────────────
  let pending: ValidationResult | null = null
  if (isSubmitting) {
    const ownError = ownFieldError(indicator, fv)
    if (ownError) return ownError
    pending = othersPending(indicator, fv)
  }

  // 未填時不進行硬性驗證
  if (numStr === '' && (denStr === '' || !indicator.has_denominator)) {
    return pending ?? OK
  }

  const num = parseFloat(numStr)
  const den = parseFloat(denStr)

  // ── 非數字 ─────────────────────────────────────────────────
  if (numStr !== '' && isNaN(num)) {
    return { level: 'error', message: '分子必須為數字' }
  }
  if (indicator.has_denominator && denStr !== '' && isNaN(den)) {
    return { level: 'error', message: '分母必須為數字' }
  }

  // ── 負數 ───────────────────────────────────────────────────
  if (!isNaN(num) && num < 0) {
    return { level: 'error', message: '數值不可為負數' }
  }
  if (indicator.has_denominator && !isNaN(den) && den < 0) {
    return { level: 'error', message: '分母不可為負數' }
  }

  // ── 分子 > 分母（比率型）──────────────────────────────────
  if (indicator.has_denominator && !isNaN(num) && !isNaN(den) && den > 0 && num > den) {
    return { level: 'error', message: `分子（${num}）不可大於分母（${den}）` }
  }

  // ── 他人負責的欄位還沒填（只提醒）──────────────────────────
  if (pending) return pending

  // ── 分母為 0 ─────────────────────────────────────────────
  if (indicator.has_denominator && !isNaN(den) && den === 0) {
    return { level: 'warning', message: '分母為 0，請確認本月無相關病患' }
  }

  // ── 計算比率後進行月變動檢查 ──────────────────────────────
  if (!isNaN(num) && indicator.prev_value !== null && indicator.prev_value !== undefined) {
    let currentVal = num
    if (indicator.has_denominator && !isNaN(den) && den > 0) {
      currentVal = (num / den)
      if (indicator.unit === 'percent') currentVal *= 100
      else if (indicator.unit === 'permille') currentVal *= 1000
    }

    const prevVal = indicator.prev_value
    if (prevVal !== 0) {
      const changePct = Math.abs((currentVal - prevVal) / Math.abs(prevVal) * 100)
      if (changePct > SOFT_CHANGE_THRESHOLD) {
        const sign = currentVal > prevVal ? '+' : ''
        return {
          level: 'warning',
          message: `與上月相比變動 ${sign}${((currentVal - prevVal) / Math.abs(prevVal) * 100).toFixed(1)}%，請確認是否正確`,
        }
      }
    } else if (!isNaN(num) && num > 0 && prevVal === 0) {
      // 上月為 0，本月非 0
      return { level: 'warning', message: '上月數值為 0，請確認本月數值正確' }
    }
  }

  // ── 本月為 0 但上月非 0 ────────────────────────────────────
  if (!isNaN(num) && num === 0 && indicator.prev_value !== null &&
      indicator.prev_value !== undefined && indicator.prev_value !== 0) {
    return { level: 'warning', message: '數值為 0 但上月非 0，請確認是否正確' }
  }

  return { level: 'ok', message: '' }
}

/**
 * 驗證整個表單的所有指標
 */
export function validateForm(
  indicators: IndicatorFormItem[],
  formValues: Record<string, FormValue>,
  isSubmitting = false
): FormValidations {
  const results: FormValidations = {}
  for (const ind of indicators) {
    results[ind.indicator_code] = validateIndicator(ind, formValues[ind.indicator_code], isSubmitting)
  }
  return results
}

/**
 * 表單是否有硬性錯誤（不可送審）
 */
export function hasErrors(validations: FormValidations): boolean {
  return Object.values(validations).some((v) => v.level === 'error')
}

/**
 * 格式化數值顯示（含單位）
 */
export function formatValue(value: number | null, unit: string): string {
  if (value === null || value === undefined) return '—'
  if (unit === 'percent') return `${value.toFixed(2)}%`
  if (unit === 'permille') return `${value.toFixed(2)}‰`
  if (unit === 'count') return value.toFixed(0)
  return value.toFixed(4)
}

/**
 * 即時計算比率（供表單即時顯示）
 */
export function calcRate(
  numeratorStr: string,
  denominatorStr: string,
  unit: string,
  hasDenominator: boolean
): string {
  const num = parseFloat(numeratorStr)
  if (isNaN(num)) return '—'
  if (!hasDenominator) return formatValue(num, unit)

  const den = parseFloat(denominatorStr)
  if (isNaN(den) || den === 0) return '—'

  let val = num / den
  if (unit === 'percent') val *= 100
  else if (unit === 'permille') val *= 1000

  return formatValue(val, unit)
}

/**
 * 月變動顯示（如 +10.3% 或 -9.8%）
 */
export function formatChangePct(changePct: number | null): { text: string; color: string } {
  if (changePct === null || changePct === undefined) return { text: '—', color: 'text-gray-400' }
  const sign = changePct > 0 ? '+' : ''
  const text = `${sign}${changePct.toFixed(1)}%`
  const absChange = Math.abs(changePct)
  if (absChange > 30) return { text, color: changePct > 0 ? 'text-red-600' : 'text-green-600' }
  if (absChange > 10) return { text, color: 'text-orange-500' }
  return { text, color: 'text-gray-500' }
}
