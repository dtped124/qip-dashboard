'use client'

/**
 * 單一指標的輸入列
 * 支援：手動填報、純計數型、HA10 新竹子類別
 */
import type { FormValue, IndicatorFormItem, ValidationResult } from '@/lib/entry/types'
import { calcRate, formatChangePct, formatValue } from '@/lib/entry/validation'

interface Props {
  indicator: IndicatorFormItem
  value: FormValue
  validation: ValidationResult
  locked: boolean
  onChange: (field: keyof FormValue | 'sub' , subCode: string | null, val: string) => void
}

function ChangePill({ changePct }: { changePct: number | null }) {
  const { text, color } = formatChangePct(changePct)
  return <span className={`text-xs font-medium ${color}`}>{text}</span>
}

function InputCell({
  value,
  placeholder,
  locked,
  onChange,
  hasError,
}: {
  value: string
  placeholder: string
  locked: boolean
  onChange: (v: string) => void
  hasError?: boolean
}) {
  return (
    <input
      type="number"
      step="any"
      value={value}
      placeholder={placeholder}
      disabled={locked}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400
        ${locked ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'bg-white'}
        ${hasError ? 'border-red-400' : 'border-gray-300'}`}
    />
  )
}

export default function IndicatorRow({ indicator, value, validation, locked, onChange }: Props) {
  const fv = value ?? { numerator: '', denominator: '', note: '', sub_entries: {} }
  const hasError = validation.level === 'error'
  const hasWarning = validation.level === 'warning'

  const rateDisplay = indicator.has_denominator
    ? calcRate(fv.numerator, fv.denominator, indicator.unit, true)
    : calcRate(fv.numerator, '', indicator.unit, false)

  // ── HA10 新竹：展開子類別 ────────────────────────────────
  if (indicator.is_ha10_hsinchu) {
    return (
      <>
        {/* 主列（自動加總，唯讀） */}
        <tr className="bg-blue-50">
          <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">
            {indicator.indicator_code}
          </td>
          <td className="px-3 py-2 text-sm text-gray-700 font-medium">
            {indicator.indicator_name}
            <span className="ml-1 text-xs text-blue-600">（自動加總）</span>
          </td>
          <td className="px-3 py-2 text-sm text-right font-medium text-gray-800">
            {rateDisplay}
          </td>
          <td className="px-3 py-2 text-sm text-right text-gray-500">
            {formatValue(indicator.prev_value, indicator.unit)}
          </td>
          <td className="px-3 py-2 text-right">
            <ChangePill changePct={indicator.change_pct} />
          </td>
        </tr>
        {/* 子類別列 */}
        {indicator.sub_entries.map((sub) => (
          <tr key={sub.sub_code} className="hover:bg-gray-50">
            <td className="pl-8 pr-3 py-1.5 text-xs text-gray-400 font-mono whitespace-nowrap">
              └ {sub.sub_code}
            </td>
            <td className="px-3 py-1.5 text-xs text-gray-600">{sub.sub_name}</td>
            <td className="px-3 py-1.5" colSpan={3}>
              <InputCell
                value={fv.sub_entries[sub.sub_code] ?? ''}
                placeholder="0"
                locked={locked}
                onChange={(v) => onChange('sub', sub.sub_code, v)}
              />
            </td>
          </tr>
        ))}
        {/* 備註列 */}
        <tr>
          <td colSpan={5} className="px-3 pb-2">
            <input
              type="text"
              value={fv.note}
              placeholder={`${indicator.indicator_code} 備註（選填）`}
              disabled={locked}
              onChange={(e) => onChange('note', null, e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </td>
        </tr>
      </>
    )
  }

  // ── case_list 模式（個案清單路徑，唯讀 + 連結） ────────────
  if (indicator.entry_mode === 'case_list') {
    return (
      <tr className="hover:bg-gray-50">
        <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">
          {indicator.indicator_code}
        </td>
        <td className="px-3 py-2 text-sm text-gray-700">
          {indicator.indicator_name}
          <span className="ml-1 text-xs text-purple-600">（個案清單）</span>
        </td>
        <td className="px-3 py-2 text-sm text-right text-gray-700">
          {indicator.value !== null ? formatValue(indicator.value, indicator.unit) : '—'}
          {(indicator.exclusion_count ?? 0) > 0 && (
            <span className="ml-1 text-xs text-gray-400">
              (排除{indicator.exclusion_count})
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-right text-gray-500">
          {formatValue(indicator.prev_value, indicator.unit)}
        </td>
        <td className="px-3 py-2 text-right">
          {locked ? (
            <ChangePill changePct={indicator.change_pct} />
          ) : (
            <a
              href={`/entry/case-list/${indicator.indicator_code}`}
              className="text-xs text-blue-600 hover:underline font-medium"
            >
              審查清單 →
            </a>
          )}
        </td>
      </tr>
    )
  }

  // ── 一般手動填報 ──────────────────────────────────────────
  return (
    <>
      <tr className={`hover:bg-gray-50 ${hasError ? 'bg-red-50' : hasWarning ? 'bg-amber-50' : ''}`}>
        <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">
          {indicator.indicator_code}
        </td>
        <td className="px-3 py-2 text-sm text-gray-700">{indicator.indicator_name}</td>

        {/* 分子/分母 or 數值 */}
        {indicator.has_denominator ? (
          <>
            <td className="px-3 py-2 w-24">
              <InputCell
                value={fv.numerator}
                placeholder="分子"
                locked={locked}
                onChange={(v) => onChange('numerator', null, v)}
                hasError={hasError}
              />
            </td>
            <td className="px-3 py-2 w-24">
              <InputCell
                value={fv.denominator}
                placeholder="分母"
                locked={locked}
                onChange={(v) => onChange('denominator', null, v)}
                hasError={hasError}
              />
            </td>
          </>
        ) : (
          <td className="px-3 py-2 w-24" colSpan={2}>
            <InputCell
              value={fv.numerator}
              placeholder="數值"
              locked={locked}
              onChange={(v) => onChange('numerator', null, v)}
              hasError={hasError}
            />
          </td>
        )}

        {/* 比率（即時計算） */}
        <td className="px-3 py-2 text-sm text-right font-medium text-gray-800 w-20">
          {rateDisplay}
        </td>

        {/* 上月值 */}
        <td className="px-3 py-2 text-sm text-right text-gray-500 w-20">
          {formatValue(indicator.prev_value, indicator.unit)}
        </td>

        {/* 月變動 */}
        <td className="px-3 py-2 text-right w-16">
          <ChangePill changePct={indicator.change_pct} />
        </td>
      </tr>

      {/* 驗證訊息列 */}
      {(hasError || hasWarning) && (
        <tr>
          <td colSpan={7} className="px-3 pb-1.5 pt-0">
            <p className={`text-xs ${hasError ? 'text-red-600' : 'text-amber-600'}`}>
              {hasError ? '❌' : '⚠️'} {validation.message}
            </p>
          </td>
        </tr>
      )}

      {/* 備註列（有值或聚焦時顯示） */}
      {!locked && (
        <tr>
          <td colSpan={7} className="px-3 pb-2">
            <input
              type="text"
              value={fv.note}
              placeholder={`${indicator.indicator_code} 備註（選填）`}
              disabled={locked}
              onChange={(e) => onChange('note', null, e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </td>
        </tr>
      )}
    </>
  )
}
