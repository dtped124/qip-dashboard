'use client'

/**
 * 單一指標的輸入列
 * 支援：手動填報、純計數型、HA10 新竹子類別、個案清單（唯讀 + 連結）
 *
 * 欄位級指派（P6）：分子、分母各自依 editable_fields 決定能不能改。不是自己負責的欄位唯讀（灰底），
 * 並標明「由 X 填寫」（沒有負責人則「未指派」）；欄位旁若有人填過，顯示填報人與時間。
 */
import Link from 'next/link'
import type {
  EntryField,
  FormField,
  FormValue,
  IndicatorFormItem,
  ValidationResult,
} from '@/lib/entry/types'
import {
  calcRate,
  filledStamp,
  formatChangePct,
  formatValue,
  ownersLabel,
} from '@/lib/entry/validation'

interface Props {
  indicator: IndicatorFormItem
  value: FormValue
  validation: ValidationResult
  /** The report is locked for reporters (submitted, approved or finalized). */
  locked: boolean
  campusCode: string
  year: number
  month: number
  onChange: (field: FormField, subCode: string | null, val: string) => void
}

function ChangePill({ changePct }: { changePct: number | null }) {
  const { text, color } = formatChangePct(changePct)
  return <span className={`text-xs font-medium ${color}`}>{text}</span>
}

function InputCell({
  value,
  placeholder,
  locked,
  readOnly,
  onChange,
  hasError,
  title,
}: {
  value: string
  placeholder: string
  locked: boolean
  /** Not my field: shown, selectable, but not editable. */
  readOnly?: boolean
  onChange: (v: string) => void
  hasError?: boolean
  title?: string
}) {
  const tone = locked
    ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
    : readOnly
      ? 'bg-gray-100 text-gray-600 cursor-not-allowed'
      : 'bg-white'
  return (
    <input
      type="number"
      step="any"
      value={value}
      placeholder={readOnly ? '—' : placeholder}
      disabled={locked}
      readOnly={readOnly}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400
        ${tone}
        ${hasError ? 'border-red-400' : 'border-gray-300'}`}
    />
  )
}

/** Tooltip of a field that is not mine. */
function ownerTitle(indicator: IndicatorFormItem, field: EntryField): string {
  const owners = indicator.field_owners[field]
  return owners.length > 0 ? `由 ${ownersLabel(owners)} 填寫` : '未指派，請聯絡管理員'
}

/** Small print under a field: who is responsible for it (when not me) and who filled it last. */
function FieldCaption({
  indicator,
  field,
  mine,
}: {
  indicator: IndicatorFormItem
  field: EntryField
  mine: boolean
}) {
  const owners = indicator.field_owners[field]
  const stamp =
    field === 'numerator'
      ? filledStamp(indicator.numerator_filled_by, indicator.numerator_filled_at)
      : filledStamp(indicator.denominator_filled_by, indicator.denominator_filled_at)
  if (mine && !stamp) return null
  return (
    <div className="mt-0.5 text-[11px] leading-tight">
      {!mine &&
        (owners.length > 0 ? (
          <p className="text-gray-500 whitespace-nowrap truncate" title={`由 ${ownersLabel(owners)} 填寫`}>由 {ownersLabel(owners)} 填寫</p>
        ) : (
          <p className="text-amber-600 font-medium">未指派</p>
        ))}
      {stamp && (
        <p className="text-gray-400" title="填報人與時間">
          {stamp}
        </p>
      )}
    </div>
  )
}

/** One of the two numbers of an indicator: the input (read-only unless it is mine) and its caption. */
function FieldInput({
  indicator,
  field,
  value,
  placeholder,
  locked,
  hasError,
  onChange,
}: {
  indicator: IndicatorFormItem
  field: EntryField
  value: string
  placeholder: string
  locked: boolean
  hasError: boolean
  onChange: (v: string) => void
}) {
  const mine = indicator.editable_fields.includes(field)
  return (
    <div>
      <InputCell
        value={value}
        placeholder={placeholder}
        locked={locked}
        readOnly={!mine}
        title={mine ? undefined : ownerTitle(indicator, field)}
        onChange={onChange}
        hasError={hasError}
      />
      <FieldCaption indicator={indicator} field={field} mine={mine} />
    </div>
  )
}

export default function IndicatorRow({
  indicator,
  value,
  validation,
  locked,
  campusCode,
  year,
  month,
  onChange,
}: Props) {
  const fv = value ?? { numerator: '', denominator: '', note: '', sub_entries: {} }
  const hasError = validation.level === 'error'
  const hasWarning = validation.level === 'warning'
  // The note is one field per indicator, shared by whoever owns either number. The form only lists
  // indicators the user is assigned to, so any listed row (even a read-only case-list one) may annotate.
  const canEditNote = !locked
  // An input to type in, or - when nothing can be typed - the note that is already there.
  const showNote = canEditNote || fv.note !== ''

  const rateDisplay = indicator.has_denominator
    ? calcRate(fv.numerator, fv.denominator, indicator.unit, true)
    : calcRate(fv.numerator, '', indicator.unit, false)

  // The message of the validation (error / warning) under the row, whichever kind of row it is.
  const messageRow = (hasError || hasWarning) && (
    <tr>
      <td colSpan={7} className="px-3 pb-1.5 pt-0">
        <p className={`text-xs ${hasError ? 'text-red-600' : 'text-amber-600'}`}>
          {hasError ? '❌' : '⚠️'} {validation.message}
        </p>
      </td>
    </tr>
  )

  const noteRow = showNote && (
    <tr>
      <td colSpan={7} className="px-3 pb-2">
        <input
          type="text"
          value={fv.note}
          placeholder={`${indicator.indicator_code} 備註（選填）`}
          disabled={!canEditNote}
          onChange={(e) => onChange('note', null, e.target.value)}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
      </td>
    </tr>
  )

  // ── HA10 新竹：展開子類別 ────────────────────────────────
  if (indicator.is_ha10_hsinchu) {
    const mineNumerator = indicator.editable_fields.includes('numerator')
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
          <td className="px-3 py-2 align-top" colSpan={2}>
            <FieldCaption indicator={indicator} field="numerator" mine={mineNumerator} />
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
        {messageRow}
        {/* 子類別列：整組就是分子，有分子權限才能改 */}
        {indicator.sub_entries.map((sub) => (
          <tr key={sub.sub_code} className="hover:bg-gray-50">
            <td className="pl-8 pr-3 py-1.5 text-xs text-gray-400 font-mono whitespace-nowrap">
              └ {sub.sub_code}
            </td>
            <td className="px-3 py-1.5 text-xs text-gray-600">{sub.sub_name}</td>
            <td className="px-3 py-1.5" colSpan={2}>
              <InputCell
                value={fv.sub_entries[sub.sub_code] ?? ''}
                placeholder="0"
                locked={locked}
                readOnly={!mineNumerator}
                title={mineNumerator ? undefined : ownerTitle(indicator, 'numerator')}
                onChange={(v) => onChange('sub', sub.sub_code, v)}
              />
            </td>
            <td colSpan={3} />
          </tr>
        ))}
        {noteRow}
      </>
    )
  }

  // ── case_list 模式（個案清單路徑，唯讀 + 連結） ────────────
  if (indicator.entry_mode === 'case_list') {
    const caseListHref =
      `/entry/case-list/${indicator.indicator_code}` +
      `?campus=${encodeURIComponent(campusCode)}&year=${year}&month=${month}`
    return (
      <>
        <tr className="hover:bg-gray-50">
          <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">
            {indicator.indicator_code}
          </td>
          <td className="px-3 py-2 text-sm text-gray-700">
            {indicator.indicator_name}
            <span className="ml-1 text-xs text-purple-600">（個案清單）</span>
          </td>
          <td className="px-3 py-2 text-sm text-gray-700">
            {indicator.numerator !== null ? indicator.numerator : '—'}
            {(indicator.exclusion_count ?? 0) > 0 && (
              <span className="ml-1 text-xs text-gray-400">
                (排除{indicator.exclusion_count})
              </span>
            )}
          </td>
          <td className="px-3 py-2 text-sm text-gray-500">
            {indicator.has_denominator
              ? (indicator.denominator !== null ? indicator.denominator : '—')
              : 'N/A'}
          </td>
          <td className="px-3 py-2 text-sm text-right text-gray-700">
            {indicator.value !== null ? formatValue(indicator.value, indicator.unit) : '—'}
          </td>
          <td className="px-3 py-2 text-sm text-right text-gray-500">
            {formatValue(indicator.prev_value, indicator.unit)}
          </td>
          <td className="px-3 py-2 text-right">
            {locked ? (
              <ChangePill changePct={indicator.change_pct} />
            ) : (
              <Link
                href={caseListHref}
                className="text-xs text-blue-600 hover:underline font-medium whitespace-nowrap"
              >
                審查清單 →
              </Link>
            )}
          </td>
        </tr>
        {messageRow}
        {noteRow}
      </>
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
            <td className="px-3 py-2 w-32">
              <FieldInput
                indicator={indicator}
                field="numerator"
                value={fv.numerator}
                placeholder="分子"
                locked={locked}
                hasError={hasError}
                onChange={(v) => onChange('numerator', null, v)}
              />
            </td>
            <td className="px-3 py-2 w-32">
              <FieldInput
                indicator={indicator}
                field="denominator"
                value={fv.denominator}
                placeholder="分母"
                locked={locked}
                hasError={hasError}
                onChange={(v) => onChange('denominator', null, v)}
              />
            </td>
          </>
        ) : (
          <td className="px-3 py-2" colSpan={2}>
            <div className="max-w-[8rem]">
              <FieldInput
                indicator={indicator}
                field="numerator"
                value={fv.numerator}
                placeholder="數值"
                locked={locked}
                hasError={hasError}
                onChange={(v) => onChange('numerator', null, v)}
              />
            </div>
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
      {messageRow}

      {/* 備註列：有任一欄位的權限就能編；鎖定時有內容才顯示 */}
      {noteRow}
    </>
  )
}
