/**
 * Unit tests of what the entry form sends (buildDraftEntries) and how it takes the server's answer back
 * (applyServerEntries) - the rules that keep a reporter from overwriting somebody else's number.
 *
 * Run with `npm run test:unit` (node --test; see roles.test.ts for the setup). draft.ts has no runtime imports,
 * so it is loaded here with its `.ts` extension.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { FormValues, IndicatorFormItem, SavedEntry } from './types'
import {
  applyServerEntries,
  buildDraftEntries,
  buildInitialValues,
  mergeSavedIntoIndicators,
  parseNum,
  sumSubEntries,
} from './draft.ts'

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

function saved(code: string, over: Partial<SavedEntry> = {}): SavedEntry {
  return {
    indicator_code: code,
    numerator: null,
    denominator: null,
    value: null,
    note: '',
    numerator_filled_by: null,
    numerator_filled_at: null,
    denominator_filled_by: null,
    denominator_filled_at: null,
    filled_by: null,
    filled_at: null,
    sub_entries: [],
    is_ha10_hsinchu: false,
    ...over,
  }
}

const SUB_CODES = Array.from({ length: 13 }, (_, i) => `HA10-10-${String(i + 1).padStart(2, '0')}`)

/** HA10-01 at Hsinchu: 13 sub-categories, a count (no denominator), the numerator is their sum. */
function ha10(over: Partial<IndicatorFormItem> = {}): IndicatorFormItem {
  return indicator('HA10-01', {
    has_denominator: false,
    is_ha10_hsinchu: true,
    sub_entries: SUB_CODES.map((sub_code, i) => ({ sub_code, sub_name: `子項 ${i + 1}`, value: null })),
    editable_fields: ['numerator'],
    ...over,
  })
}

/** A form of two indicators: HA03-01 is mine in both numbers, HA03-02 only the numerator (the denominator is 李大華's). */
const MINE = indicator('HA03-01')
const HALF = indicator('HA03-02', {
  editable_fields: ['numerator'],
  field_owners: { numerator: ['王小明'], denominator: ['李大華'] },
  denominator: 100,
  denominator_filled_by: '李大華',
  denominator_filled_at: '2026-10-11T09:00:00+08:00',
})

/** A copy of the form values with some inputs changed. */
function edit(values: FormValues, code: string, changes: Partial<FormValues[string]>): FormValues {
  return { ...values, [code]: { ...values[code], ...changes } }
}

// ─── parseNum ────────────────────────────────────────────────────

describe('parseNum', () => {
  test('numbers, empty and garbage', () => {
    assert.equal(parseNum('5'), 5)
    assert.equal(parseNum(' 5.25 '), 5.25)
    assert.equal(parseNum('0'), 0)
    assert.equal(parseNum(''), null)
    assert.equal(parseNum('   '), null)
    assert.equal(parseNum(undefined), null)
    assert.equal(parseNum(null), null)
    assert.equal(parseNum('abc'), null)
  })

  test('never a non-finite number (JSON would turn it into null, i.e. "clear")', () => {
    assert.equal(parseNum('Infinity'), null)
    assert.equal(parseNum('-Infinity'), null)
    assert.equal(parseNum('NaN'), null)
  })
})

// ─── buildInitialValues ──────────────────────────────────────────

describe('buildInitialValues', () => {
  test('turns the loaded numbers into input strings, empty for null', () => {
    const values = buildInitialValues([
      indicator('A', { numerator: 5, denominator: 0, note: '備註' }),
      indicator('B'),
      ha10({ sub_entries: [{ sub_code: 'S1', sub_name: 'x', value: 3 }, { sub_code: 'S2', sub_name: 'y', value: null }] }),
    ])
    assert.deepEqual(values.A, { numerator: '5', denominator: '0', note: '備註', sub_entries: {} })
    assert.deepEqual(values.B, { numerator: '', denominator: '', note: '', sub_entries: {} })
    assert.deepEqual(values['HA10-01'].sub_entries, { S1: '3', S2: '' })
  })
})

// ─── buildDraftEntries ───────────────────────────────────────────

describe('buildDraftEntries', () => {
  const indicators = [MINE, HALF]
  const baseline = buildInitialValues(indicators)

  test('an unchanged form sends nothing (an empty list is "do not call the API")', () => {
    assert.deepEqual(buildDraftEntries(baseline, baseline, indicators), [])
  })

  test('sends only the indicator that changed, and only the key that changed', () => {
    const current = edit(baseline, 'HA03-01', { numerator: '5' })
    assert.deepEqual(buildDraftEntries(current, baseline, indicators), [
      { indicator_code: 'HA03-01', numerator: 5 },
    ])
  })

  test('never sends a field the user is not responsible for, whatever the form holds', () => {
    // HA03-02's denominator is 李大華's. A value that differs from the baseline (e.g. merged from the server)
    // must still stay out of the payload: the backend answers 400 field_not_assigned to a key that is present.
    const current = edit(baseline, 'HA03-02', { numerator: '7', denominator: '999' })
    assert.deepEqual(buildDraftEntries(current, baseline, indicators), [
      { indicator_code: 'HA03-02', numerator: 7 },
    ])
  })

  test('a cleared input is sent as null (clear), not left out', () => {
    const filled = buildInitialValues([indicator('A', { numerator: 5, denominator: 100 })])
    const current = edit(filled, 'A', { numerator: '' })
    assert.deepEqual(buildDraftEntries(current, filled, [indicator('A')]), [
      { indicator_code: 'A', numerator: null },
    ])
  })

  test('the same number typed differently is not a change', () => {
    const filled = buildInitialValues([indicator('A', { numerator: 5 })])
    assert.deepEqual(buildDraftEntries(edit(filled, 'A', { numerator: '5.0' }), filled, [indicator('A')]), [])
    assert.deepEqual(buildDraftEntries(edit(filled, 'A', { denominator: '  ' }), filled, [indicator('A')]), [])
  })

  test('zero is a value like any other', () => {
    const current = edit(baseline, 'HA03-01', { numerator: '0', denominator: '0' })
    assert.deepEqual(buildDraftEntries(current, baseline, indicators), [
      { indicator_code: 'HA03-01', numerator: 0, denominator: 0 },
    ])
  })

  test('the note travels only when the user changed it', () => {
    const withNote = buildInitialValues([indicator('A', { note: '李大華寫的備註' })])
    const a = [indicator('A')]
    // untouched: the other owner's note must not be sent back over itself
    assert.deepEqual(buildDraftEntries(withNote, withNote, a), [])
    // a number changed but the note did not: no note key
    assert.deepEqual(buildDraftEntries(edit(withNote, 'A', { numerator: '3' }), withNote, a), [
      { indicator_code: 'A', numerator: 3 },
    ])
    // changed
    assert.deepEqual(buildDraftEntries(edit(withNote, 'A', { note: '改過' }), withNote, a), [
      { indicator_code: 'A', note: '改過' },
    ])
    // cleared: an empty string is sent (null/"" both clear, and the backend counts "" as something to write)
    assert.deepEqual(buildDraftEntries(edit(withNote, 'A', { note: '' }), withNote, a), [
      { indicator_code: 'A', note: '' },
    ])
  })

  test('a count indicator never sends a denominator', () => {
    const count = indicator('C', { has_denominator: false, editable_fields: ['numerator', 'denominator'] })
    const base = buildInitialValues([count])
    assert.deepEqual(buildDraftEntries(edit(base, 'C', { numerator: '4', denominator: '9' }), base, [count]), [
      { indicator_code: 'C', numerator: 4 },
    ])
  })

  test('a case-list indicator (no editable field) can only send a note', () => {
    const caseList = indicator('HA03-05', { entry_mode: 'case_list', editable_fields: [], numerator: 3, denominator: 90 })
    const base = buildInitialValues([caseList])
    assert.deepEqual(buildDraftEntries(edit(base, 'HA03-05', { numerator: '50' }), base, [caseList]), [])
    assert.deepEqual(buildDraftEntries(edit(base, 'HA03-05', { note: '已核對' }), base, [caseList]), [
      { indicator_code: 'HA03-05', note: '已核對' },
    ])
  })

  test('an indicator missing from the form values is skipped', () => {
    assert.deepEqual(buildDraftEntries({}, {}, indicators), [])
  })

  test('keeps the order of the indicators', () => {
    let current = edit(baseline, 'HA03-02', { numerator: '1' })
    current = edit(current, 'HA03-01', { numerator: '2' })
    assert.deepEqual(
      buildDraftEntries(current, baseline, indicators).map((e) => e.indicator_code),
      ['HA03-01', 'HA03-02'],
    )
  })

  describe('HA10-01 at Hsinchu (13 sub-categories)', () => {
    const form = [ha10()]
    const base = buildInitialValues(form)
    const withSub = (code: string, value: string, from: FormValues = base): FormValues =>
      edit(from, 'HA10-01', { sub_entries: { ...from['HA10-01'].sub_entries, [code]: value }, numerator: value })

    test('unchanged sub-categories send nothing (and never an empty sub_entries list)', () => {
      assert.deepEqual(buildDraftEntries(base, base, form), [])
    })

    test('one changed sub-category sends all 13, as sub_entries and without a bare numerator', () => {
      const current = withSub('HA10-10-03', '4')
      const [entry, ...rest] = buildDraftEntries(current, base, form)
      assert.equal(rest.length, 0)
      assert.equal(entry.indicator_code, 'HA10-01')
      assert.equal('numerator' in entry, false) // the backend answers 400 to a numerator without sub_entries
      assert.equal(entry.sub_entries?.length, 13)
      assert.deepEqual(entry.sub_entries?.map((s) => s.sub_code), SUB_CODES)
      assert.equal(entry.sub_entries?.find((s) => s.sub_code === 'HA10-10-03')?.value, 4)
      assert.equal(entry.sub_entries?.filter((s) => s.value === null).length, 12)
    })

    test('a cleared sub-category is sent as null inside the full list', () => {
      const loaded = ha10({
        sub_entries: SUB_CODES.map((sub_code) => ({ sub_code, sub_name: 'x', value: 2 })),
      })
      const loadedValues = buildInitialValues([loaded])
      const current = withSub('HA10-10-01', '', loadedValues)
      const [entry] = buildDraftEntries(current, loadedValues, [loaded])
      assert.equal(entry.sub_entries?.length, 13)
      assert.equal(entry.sub_entries?.[0].value, null)
      assert.equal(entry.sub_entries?.[1].value, 2)
    })

    test('without the numerator right the sub-categories are never sent', () => {
      const readOnly = [ha10({ editable_fields: [] })]
      assert.deepEqual(buildDraftEntries(withSub('HA10-10-03', '4'), base, readOnly), [])
    })

    test('a note change alone does not drag the sub-categories along', () => {
      assert.deepEqual(buildDraftEntries(edit(base, 'HA10-01', { note: '備註' }), base, form), [
        { indicator_code: 'HA10-01', note: '備註' },
      ])
    })
  })
})

// ─── applyServerEntries ──────────────────────────────────────────

describe('applyServerEntries', () => {
  const indicators = [MINE, HALF]
  const baseline = buildInitialValues(indicators)

  test("takes another person's field from the answer", () => {
    // 王小明 typed the numerator of HA03-02; meanwhile 李大華 filled its denominator (80).
    const sent = edit(baseline, 'HA03-02', { numerator: '6' })
    const answer = [saved('HA03-02', { numerator: 6, denominator: 80, denominator_filled_by: '李大華' })]
    const next = applyServerEntries(sent, answer, sent)
    assert.equal(next['HA03-02'].denominator, '80')
    assert.equal(next['HA03-02'].numerator, '6')
  })

  test("keeps the user's own input that is not part of the answer yet", () => {
    // The request carried numerator 6. While it was in flight the user typed 7 and wrote a note.
    const sent = edit(baseline, 'HA03-02', { numerator: '6' })
    const typedSince = edit(sent, 'HA03-02', { numerator: '7', note: '送出後才打的' })
    const answer = [saved('HA03-02', { numerator: 6, denominator: 80 })]
    const next = applyServerEntries(typedSince, answer, sent)
    assert.equal(next['HA03-02'].numerator, '7') // not overwritten by the 6 the server confirms
    assert.equal(next['HA03-02'].note, '送出後才打的')
    assert.equal(next['HA03-02'].denominator, '80') // someone else's field still arrives
  })

  test('what was sent is confirmed with the value the server stored (rounding included)', () => {
    const sent = edit(baseline, 'HA03-01', { numerator: '5.126' })
    const next = applyServerEntries(sent, [saved('HA03-01', { numerator: 5.13 })], sent)
    assert.equal(next['HA03-01'].numerator, '5.13')
  })

  test('an input that already says the number the server confirms is kept as typed', () => {
    // "5." and "5.10" are the same numbers as 5 and 5.1: rewriting them under the user's cursor would eat the dot
    const sent = edit(baseline, 'HA03-01', { numerator: '5.', denominator: '5.10' })
    const next = applyServerEntries(sent, [saved('HA03-01', { numerator: 5, denominator: 5.1 })], sent)
    assert.equal(next['HA03-01'].numerator, '5.')
    assert.equal(next['HA03-01'].denominator, '5.10')
    // also when the same rule builds the new baseline (no baseline given)
    const base = applyServerEntries(sent, [saved('HA03-01', { numerator: 5, denominator: 5.1 })])
    assert.equal(base['HA03-01'].numerator, '5.')
    assert.equal(base['HA03-01'].denominator, '5.10')
  })

  test('a field of mine that was not edited follows the server (a deputy saved it meanwhile)', () => {
    const next = applyServerEntries(baseline, [saved('HA03-01', { numerator: 9, denominator: 10 })], baseline)
    assert.equal(next['HA03-01'].numerator, '9')
    assert.equal(next['HA03-01'].denominator, '10')
  })

  test('without a baseline the answer replaces everything it covers', () => {
    const typed = edit(baseline, 'HA03-01', { numerator: '7' })
    const next = applyServerEntries(typed, [saved('HA03-01', { numerator: 6 })])
    assert.equal(next['HA03-01'].numerator, '6')
  })

  test('indicators that are not in the answer are left alone (same object)', () => {
    const typed = edit(baseline, 'HA03-01', { numerator: '7' })
    const next = applyServerEntries(typed, [saved('HA03-02', { numerator: 1 })], baseline)
    assert.equal(next['HA03-01'], typed['HA03-01'])
    assert.notEqual(next['HA03-02'], typed['HA03-02'])
  })

  test('nothing to apply returns the very same values', () => {
    assert.equal(applyServerEntries(baseline, [], baseline), baseline)
    assert.equal(applyServerEntries(baseline, [saved('NOT-ON-THE-FORM')], baseline), baseline)
  })

  test('does not modify its inputs', () => {
    const typed = edit(baseline, 'HA03-02', { numerator: '6' })
    const snapshot = JSON.stringify(typed)
    applyServerEntries(typed, [saved('HA03-02', { numerator: 6, denominator: 80 })], typed)
    assert.equal(JSON.stringify(typed), snapshot)
  })

  test('the note follows the same rule', () => {
    const base = buildInitialValues([indicator('A', { note: '舊' })])
    // not edited: the server's note (somebody else's) comes in
    assert.equal(applyServerEntries(base, [saved('A', { note: '新' })], base).A.note, '新')
    // edited since the request: kept
    const typed = edit(base, 'A', { note: '我改的' })
    assert.equal(applyServerEntries(typed, [saved('A', { note: '新' })], base).A.note, '我改的')
  })

  test('HA10 sub-categories: edited ones are kept, the rest follow the answer', () => {
    const form = [ha10()]
    const base = buildInitialValues(form)
    const sent = edit(base, 'HA10-01', { sub_entries: { ...base['HA10-01'].sub_entries, 'HA10-10-01': '4' }, numerator: '4' })
    const typedSince = edit(sent, 'HA10-01', {
      sub_entries: { ...sent['HA10-01'].sub_entries, 'HA10-10-02': '5' },
      numerator: '9',
    })
    const answer = [
      saved('HA10-01', {
        numerator: 4,
        is_ha10_hsinchu: true,
        sub_entries: SUB_CODES.map((sub_code) => ({ sub_code, sub_name: 'x', value: sub_code === 'HA10-10-01' ? 4 : null })),
      }),
    ]
    const next = applyServerEntries(typedSince, answer, sent)
    assert.equal(next['HA10-01'].sub_entries['HA10-10-01'], '4')
    assert.equal(next['HA10-01'].sub_entries['HA10-10-02'], '5') // typed after the request
    assert.equal(next['HA10-01'].numerator, '9')
  })
})

// ─── the whole save cycle ────────────────────────────────────────

describe('save cycle (build, answer, build again)', () => {
  const indicators = [MINE, HALF]

  test('after a save only what was typed since is sent again', () => {
    const loaded = buildInitialValues(indicators)

    // 1st save: numerator of HA03-02 typed and sent
    const sent1 = edit(loaded, 'HA03-02', { numerator: '6' })
    const payload1 = buildDraftEntries(sent1, loaded, indicators)
    assert.deepEqual(payload1, [{ indicator_code: 'HA03-02', numerator: 6 }])

    // the answer arrives; the user had typed into HA03-01 meanwhile
    const answer = [saved('HA03-02', { numerator: 6, denominator: 80 })]
    const current = edit(sent1, 'HA03-01', { numerator: '3' })
    const merged = applyServerEntries(current, answer, sent1)
    const baseline1 = applyServerEntries(sent1, answer)

    // 2nd save: HA03-02 is settled (not sent again), HA03-01's typing goes out
    assert.deepEqual(buildDraftEntries(merged, baseline1, indicators), [
      { indicator_code: 'HA03-01', numerator: 3 },
    ])
    // and an untouched form after that sends nothing
    assert.deepEqual(buildDraftEntries(baseline1, baseline1, indicators), [])
  })

  test('a failed save leaves the baseline alone, so the same edit is sent again', () => {
    const loaded = buildInitialValues(indicators)
    const current = edit(loaded, 'HA03-01', { numerator: '5' })
    const first = buildDraftEntries(current, loaded, indicators)
    // the request failed: the caller keeps `loaded` as the baseline, nothing counts as sent
    const retry = buildDraftEntries(current, loaded, indicators)
    assert.deepEqual(first, [{ indicator_code: 'HA03-01', numerator: 5 }])
    assert.deepEqual(retry, first)
  })
})

// ─── mergeSavedIntoIndicators ────────────────────────────────────

describe('mergeSavedIntoIndicators', () => {
  test('puts the stored numbers and who filled them into the indicators of the answer only', () => {
    const list = [MINE, HALF]
    const next = mergeSavedIntoIndicators(list, [
      saved('HA03-01', {
        numerator: 5,
        value: 5,
        numerator_filled_by: '王小明',
        numerator_filled_at: '2026-10-11T14:32:00+08:00',
      }),
    ])
    assert.equal(next[0].numerator, 5)
    assert.equal(next[0].value, 5)
    assert.equal(next[0].numerator_filled_by, '王小明')
    assert.equal(next[0].numerator_filled_at, '2026-10-11T14:32:00+08:00')
    assert.equal(next[1], list[1]) // not in the answer: the same object
    assert.equal(list[0].numerator, null) // the input is untouched
  })
})

// ─── sumSubEntries ───────────────────────────────────────────────

describe('sumSubEntries', () => {
  test('is empty until a sub-category has a value, then the sum of the filled ones', () => {
    assert.equal(sumSubEntries({}), '')
    assert.equal(sumSubEntries({ a: '', b: '  ' }), '')
    assert.equal(sumSubEntries({ a: '2', b: '', c: '3' }), '5')
    assert.equal(sumSubEntries({ a: '0' }), '0')
  })

  test('rounds away floating point noise to the 2 decimals the server keeps', () => {
    assert.equal(sumSubEntries({ a: '0.1', b: '0.2' }), '0.3')
  })
})
