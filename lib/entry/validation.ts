/**
 * 填報即時驗證邏輯（§5.3）
 *
 * 硬性阻擋（error）：分子 > 分母、負數、送審時有空值
 * 柔性提醒（warning）：±30% 變動、分母為 0、數值為 0 但上月非 0
 */
import type { FormValue, FormValidations, IndicatorFormItem, ValidationResult } from './types'

const SOFT_CHANGE_THRESHOLD = 30  // 柔性提醒：月變動 > 30%

/**
 * 驗證單一指標的輸入值
 */
export function validateIndicator(
  indicator: IndicatorFormItem,
  fv: FormValue | undefined,
  isSubmitting = false
): ValidationResult {
  if (!fv) {
    if (isSubmitting) return { level: 'error', message: '送審前必須填寫數值' }
    return { level: 'ok', message: '' }
  }

  const numStr = fv.numerator.trim()
  const denStr = fv.denominator.trim()

  // ── 空值檢查（送審時）──────────────────────────────────────
  if (isSubmitting) {
    if (!indicator.has_denominator && numStr === '') {
      return { level: 'error', message: '送審前必須填寫數值' }
    }
    if (indicator.has_denominator && (numStr === '' || denStr === '')) {
      return { level: 'error', message: '送審前分子與分母皆必須填寫' }
    }
    if (indicator.is_ha10_hsinchu) {
      const allFilled = indicator.sub_entries.every(
        (sub) => (fv.sub_entries[sub.sub_code] ?? '').trim() !== ''
      )
      if (!allFilled) return { level: 'error', message: '送審前所有子類別皆必須填寫' }
    }
  }

  // 未填時不進行硬性驗證
  if (numStr === '' && (denStr === '' || !indicator.has_denominator)) {
    return { level: 'ok', message: '' }
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
