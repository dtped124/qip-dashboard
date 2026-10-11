/**
 * Unit tests of the form validation under field-level assignment, and of the small display helpers next to it.
 *
 * Run with `npm run test:unit` (node --test; see roles.test.ts for the setup).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { FormValue, IndicatorFormItem } from './types'
import {
  filledStamp,
  formatStamp,
  hasErrors,
  missingLabel,
  ownersLabel,
  parseMissing,
  usesSubEntries,
  validateForm,
  validateIndicator,
} from './validation.ts'

// ─── fixtures ────────────────────────────────────────────────────

function indicator(code: string, over: Partial<IndicatorFormItem> = {}): IndicatorFormItem {
  return {
    indicator_code: code,
    indicator_name: `指標 ${code}`,
    unit: 'percent',
    direction: 'lower',
    has_denominator: true,
    entry_mode: 'manual',
    numerator: null,
    denominator: null,
    value: null,
    note: '',
    prev_value: null,
    prev_numerator: null,
    prev_denominator: null,
    change_pct: null,
    sub_entries: [],
    is_ha10_hsinchu: false,
    editable_fields: ['numerator', 'denominator'],
    field_owners: { numerator: ['王小明'], denominator: ['王小明'] },
    numerator_filled_by: null,
    numerator_filled_at: null,
    denominator_filled_by: null,
    denominator_filled_at: null,
    ...over,
  }
}

function values(numerator: string, denominator: string, extra: Partial<FormValue> = {}): FormValue {
  return { numerator, denominator, note: '', sub_entries: {}, ...extra }
}

/** HA03-02 where only the numerator is mine and 李大華 owns the denominator. */
const HALF = indicator('HA03-02', {
  editable_fields: ['numerator'],
  field_owners: { numerator: ['王小明'], denominator: ['李大華'] },
})

// ─── submit-time checks cover the user's own fields only ─────────

describe('validateIndicator at submit time', () => {
  test('an empty field of mine is a hard error', () => {
    const own = indicator('A')
    assert.deepEqual(validateIndicator(own, values('', '10'), true), { level: 'error', message: '送審前分子必須填寫' })
    assert.deepEqual(validateIndicator(own, values('5', ''), true), { level: 'error', message: '送審前分母必須填寫' })
    assert.deepEqual(validateIndicator(own, values('', ''), true), { level: 'error', message: '送審前分子與分母皆必須填寫' })
  })

  test('a count indicator asks for the value', () => {
    const count = indicator('C', { has_denominator: false })
    assert.deepEqual(validateIndicator(count, values('', ''), true), { level: 'error', message: '送審前必須填寫數值' })
    assert.equal(validateIndicator(count, values('4', ''), true).level, 'ok')
  })

  test("somebody else's empty field is only a warning, naming the owner", () => {
    const result = validateIndicator(HALF, values('5', ''), true)
    assert.equal(result.level, 'warning')
    assert.match(result.message, /分母/)
    assert.match(result.message, /李大華/)
    assert.equal(hasErrors({ x: result }), false)
  })

  test('a field nobody owns says so, and points to the administrator', () => {
    const orphan = indicator('A', {
      editable_fields: ['numerator'],
      field_owners: { numerator: ['王小明'], denominator: [] },
    })
    const result = validateIndicator(orphan, values('5', ''), true)
    assert.equal(result.level, 'warning')
    assert.match(result.message, /未指派/)
    assert.match(result.message, /管理員/)
  })

  test("my own empty field wins over the other person's warning", () => {
    assert.equal(validateIndicator(HALF, values('', ''), true).level, 'error')
  })

  test("nothing is demanded of the other person's field before submitting", () => {
    assert.equal(validateIndicator(HALF, values('5', ''), false).level, 'ok')
    assert.equal(validateIndicator(HALF, values('', ''), false).level, 'ok')
  })

  test('with the other field filled in there is nothing to say', () => {
    assert.equal(validateIndicator(HALF, values('5', '100'), true).level, 'ok')
  })

  test('a case-list indicator (nothing editable) with no number yet is a warning, never an error', () => {
    const caseList = indicator('HA03-05', { entry_mode: 'case_list', editable_fields: [] })
    const result = validateIndicator(caseList, values('', ''), true)
    assert.equal(result.level, 'warning')
    assert.match(result.message, /個案清單/)
  })

  test('the numerator may not exceed the denominator, whoever owns the denominator', () => {
    const result = validateIndicator(HALF, values('120', '100'), true)
    assert.equal(result.level, 'error')
    assert.match(result.message, /不可大於分母/)
  })

  test('a missing value object is an error only when there is something of mine to fill', () => {
    assert.equal(validateIndicator(indicator('A'), undefined, true).level, 'error')
    assert.equal(validateIndicator(indicator('A', { editable_fields: [] }), undefined, true).level, 'ok')
  })
})

describe('validateIndicator for HA10-01 at Hsinchu', () => {
  const SUBS = ['S1', 'S2', 'S3'].map((sub_code) => ({ sub_code, sub_name: sub_code, value: null }))
  const ha10 = indicator('HA10-01', {
    has_denominator: false,
    is_ha10_hsinchu: true,
    sub_entries: SUBS,
    editable_fields: ['numerator'],
  })

  test('all sub-categories filled is enough, whatever the numerator text says', () => {
    const filled = values('', '', { sub_entries: { S1: '1', S2: '0', S3: '2' } })
    assert.equal(validateIndicator(ha10, filled, true).level, 'ok')
  })

  test('a sub-category left empty is an error', () => {
    const partial = values('3', '', { sub_entries: { S1: '1', S2: '', S3: '2' } })
    assert.deepEqual(validateIndicator(ha10, partial, true), { level: 'error', message: '送審前所有子類別皆必須填寫' })
  })

  test('without the numerator right the sub-categories are not demanded', () => {
    const readOnly = indicator('HA10-01', { ...ha10, editable_fields: [] })
    const result = validateIndicator(readOnly, values('', '', { sub_entries: { S1: '', S2: '', S3: '' } }), true)
    assert.equal(result.level, 'warning')
  })
})

describe('validateForm', () => {
  test('one result per indicator, and hasErrors sees only hard errors', () => {
    const list = [indicator('A'), HALF]
    const results = validateForm(list, { A: values('5', '10'), 'HA03-02': values('5', '') }, true)
    assert.equal(results.A.level, 'ok')
    assert.equal(results['HA03-02'].level, 'warning')
    assert.equal(hasErrors(results), false)
    assert.equal(hasErrors(validateForm(list, { A: values('', ''), 'HA03-02': values('5', '') }, true)), true)
  })
})

// ─── display helpers ─────────────────────────────────────────────

describe('ownersLabel / missingLabel', () => {
  test('owners are joined, nobody is 未指派', () => {
    assert.equal(ownersLabel(['王小明']), '王小明')
    assert.equal(ownersLabel(['王小明', '李大華']), '王小明、李大華')
    assert.equal(ownersLabel([]), '未指派')
  })

  test('a missing field reads "code name — field（owner）"', () => {
    const base = { indicator_code: 'HA03-01', indicator_name: '住院死亡率', field: 'denominator' as const }
    assert.equal(
      missingLabel({ ...base, owners: ['王小明'], unassigned: false }),
      'HA03-01 住院死亡率 — 分母（王小明）',
    )
    assert.equal(
      missingLabel({ ...base, owners: [], unassigned: true }),
      'HA03-01 住院死亡率 — 分母（未指派）',
    )
    assert.equal(
      missingLabel({ ...base, field: 'numerator', owners: ['甲', '乙'], unassigned: false }),
      'HA03-01 住院死亡率 — 分子（甲、乙）',
    )
  })
})

describe('parseMissing', () => {
  test('reads the missing list of a 400 incomplete body', () => {
    const body = {
      detail: '送審前提未達',
      code: 'incomplete',
      unfilled_codes: ['HA01-01', 'HA01-02'],
      missing: [
        { indicator_code: 'HA01-01', indicator_name: '住院死亡率', field: 'denominator', owners: ['李大華'], unassigned: false },
        { indicator_code: 'HA01-02', indicator_name: 'x', field: 'numerator', owners: [], unassigned: true, sub_codes: ['S1'] },
      ],
    }
    const items = parseMissing(body)
    assert.equal(items?.length, 2)
    assert.deepEqual(items?.[0], {
      indicator_code: 'HA01-01',
      indicator_name: '住院死亡率',
      field: 'denominator',
      owners: ['李大華'],
      unassigned: false,
      sub_codes: undefined,
    })
    assert.equal(items?.[1].unassigned, true)
    assert.deepEqual(items?.[1].sub_codes, ['S1'])
  })

  test('is null without a list, and drops entries that are not gaps', () => {
    assert.equal(parseMissing(null), null)
    assert.equal(parseMissing('x'), null)
    assert.equal(parseMissing({ detail: 'x' }), null)
    const items = parseMissing({
      missing: [null, 3, { indicator_code: 'A', field: 'weird' }, { field: 'numerator' }, { indicator_code: 'B', field: 'numerator' }],
    })
    assert.equal(items?.length, 1)
    assert.equal(items?.[0].indicator_code, 'B')
    assert.equal(items?.[0].unassigned, true) // no owners listed means nobody is responsible
    assert.equal(items?.[0].indicator_name, 'B')
  })
})

describe('formatStamp / filledStamp', () => {
  test('shows month/day and the time on the hospital clock, whatever the offset of the input', () => {
    assert.equal(formatStamp('2026-10-11T14:32:00+08:00'), '10/11 14:32')
    assert.equal(formatStamp('2026-10-11T06:32:00Z'), '10/11 14:32')
    assert.equal(formatStamp('2026-10-11T22:05:00-02:00'), '10/12 08:05') // crosses midnight in Taipei
    assert.equal(formatStamp('2026-03-05T09:07:00+08:00'), '3/5 09:07')
  })

  test('a missing or unreadable time is empty', () => {
    assert.equal(formatStamp(null), '')
    assert.equal(formatStamp(undefined), '')
    assert.equal(formatStamp(''), '')
    assert.equal(formatStamp('not a date'), '')
  })

  test('who and when; nothing when nobody filled the field', () => {
    assert.equal(filledStamp('王小明', '2026-10-11T14:32:00+08:00'), '王小明 10/11 14:32')
    assert.equal(filledStamp('王小明', null), '王小明')
    assert.equal(filledStamp(null, '2026-10-11T14:32:00+08:00'), '')
    assert.equal(filledStamp(null, null), '')
  })
})

describe('usesSubEntries', () => {
  test('only HA10-01 at Hsinchu is entered as sub-categories', () => {
    assert.equal(usesSubEntries('HA10-01', 'hsinchu'), true)
    assert.equal(usesSubEntries('HA10-01', 'zhubei'), false)
    assert.equal(usesSubEntries('HA10-04', 'hsinchu'), false)
    assert.equal(usesSubEntries('HA03-01', 'hsinchu'), false)
  })
})
