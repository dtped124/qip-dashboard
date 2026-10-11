/**
 * What the entry form sends to the server and how it takes the answer back.
 *
 * Pure functions, no React and no I/O, so `npm run test:unit` (node --test) can run them. Like
 * lib/auth/roles.ts this file must stay free of runtime imports (`import type` is erased): Node cannot resolve
 * this app's extension-less specifiers.
 *
 * The form keeps two snapshots of its values, both `FormValues`:
 *   - the current values (what the inputs show), and
 *   - the baseline: what the server is known to hold, i.e. the values loaded or last sent successfully.
 * A key is "edited" when the current value differs from the baseline. Only edited keys are ever sent, because the
 * backend (P5) refuses a payload that names a field the user is not responsible for, and it overwrites whatever
 * key is present - so a whole-form resend would both be rejected and, were it accepted, clobber other people's work.
 */
import type {
  DraftEntry,
  FormValue,
  FormValues,
  IndicatorFormItem,
  SavedEntry,
} from './types'

/** The part of an indicator that decides what may be sent for it. */
export type DraftIndicator = Pick<
  IndicatorFormItem,
  'indicator_code' | 'has_denominator' | 'is_ha10_hsinchu' | 'editable_fields' | 'sub_entries'
>

const NUMBER_FIELDS = ['numerator', 'denominator'] as const

// ─── Small helpers ───────────────────────────────────────────────

/** An input string as a number; empty, blank or not a finite number all mean "no value" (null). */
export function parseNum(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/** Two input strings hold the same number ("5" and "5.0" do; "" and a blank do). */
function sameNumber(a: string | undefined, b: string | undefined): boolean {
  return parseNum(a) === parseNum(b)
}

function numberText(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n)
}

/** Sum of the filled sub-category inputs as text ('' when none is filled), rounded to the 2 decimals the server keeps. */
export function sumSubEntries(subs: Record<string, string>): string {
  let total = 0
  let any = false
  for (const text of Object.values(subs)) {
    const n = parseNum(text)
    if (n !== null) {
      total += n
      any = true
    }
  }
  return any ? String(Math.round(total * 100) / 100) : ''
}

// ─── Form values <-> indicators ──────────────────────────────────

/** The input strings of a freshly loaded form (also its baseline). */
export function buildInitialValues(indicators: IndicatorFormItem[]): FormValues {
  const values: FormValues = {}
  for (const ind of indicators) {
    const subs: Record<string, string> = {}
    for (const sub of ind.sub_entries) subs[sub.sub_code] = numberText(sub.value)
    values[ind.indicator_code] = {
      numerator: numberText(ind.numerator),
      denominator: numberText(ind.denominator),
      note: ind.note ?? '',
      sub_entries: subs,
    }
  }
  return values
}

/**
 * The `entries` of a save-draft request: only what the user changed since `baseline`, and only what they may write.
 *
 *   - numerator / denominator: only a field listed in `editable_fields`, and only when its number differs from the
 *     baseline. A cleared input is sent as null (the backend reads null as "clear", an absent key as "leave alone").
 *   - HA10-01 at Hsinchu: the numerator is the sum of 13 sub-categories, so it travels as `sub_entries` instead (the
 *     backend answers 400 to a bare numerator there) - only when one of them changed, and then all 13 of them.
 *   - note: only when the text differs from the baseline (it is one field shared by the numerator's and the
 *     denominator's owner, so an unchanged note must not be sent back over the other person's).
 *   - an indicator without any change is left out, so an unchanged form gives [] and the caller sends nothing.
 */
export function buildDraftEntries(
  formValues: FormValues,
  baseline: FormValues,
  indicators: DraftIndicator[],
): DraftEntry[] {
  const entries: DraftEntry[] = []
  for (const ind of indicators) {
    const cur = formValues[ind.indicator_code]
    if (!cur) continue
    const base: FormValue | undefined = baseline[ind.indicator_code]
    const mine = new Set(ind.editable_fields)
    const entry: DraftEntry = { indicator_code: ind.indicator_code }

    for (const field of NUMBER_FIELDS) {
      if (!mine.has(field)) continue
      if (field === 'denominator' && !ind.has_denominator) continue
      if (field === 'numerator' && ind.is_ha10_hsinchu) continue
      if (!sameNumber(cur[field], base?.[field])) entry[field] = parseNum(cur[field])
    }

    if (
      ind.is_ha10_hsinchu &&
      mine.has('numerator') &&
      ind.sub_entries.some((sub) => !sameNumber(cur.sub_entries[sub.sub_code], base?.sub_entries?.[sub.sub_code]))
    ) {
      entry.sub_entries = ind.sub_entries.map((sub) => ({
        sub_code: sub.sub_code,
        value: parseNum(cur.sub_entries[sub.sub_code]),
      }))
    }

    if (cur.note !== (base?.note ?? '')) entry.note = cur.note

    if (Object.keys(entry).length > 1) entries.push(entry)
  }
  return entries
}

// ─── The server's answer ─────────────────────────────────────────

/**
 * `text` is the user's input, `base` the baseline's: keep the input when it is an edit, else take the server's value.
 * An input that already says the server's number is kept as typed ("5." or "5.10" must not turn into "5" / "5.1"
 * under the cursor of somebody who paused for the autosave).
 */
function mergeNumber(text: string, base: string | undefined, server: number | null): string {
  if (base !== undefined && !sameNumber(text, base)) return text
  if (parseNum(text) === (server ?? null)) return text
  return numberText(server)
}

function mergeText(text: string, base: string | undefined, server: string): string {
  if (base !== undefined && text !== base) return text
  return server
}

/**
 * Put the server's latest values (the `entries` of a save-draft answer, other people's fields included) into the
 * form values. Indicators that are not in `entries` are left alone.
 *
 * `baseline` says which keys the user has edited since the request was sent: those are kept, because the answer
 * cannot know about them yet (typed while the request was in flight) and they go out with the next save. Every
 * other key takes the server's value - which is how another person's fresh denominator reaches this screen.
 * Without a baseline nothing counts as edited and the answer replaces everything it covers.
 */
export function applyServerEntries(
  formValues: FormValues,
  entries: SavedEntry[],
  baseline?: FormValues,
): FormValues {
  let next: FormValues | null = null
  for (const entry of entries) {
    const cur = formValues[entry.indicator_code]
    if (!cur) continue
    // With a baseline, a key it does not know counts as empty there (so typing into it is an edit).
    const base: FormValue | undefined = baseline
      ? (baseline[entry.indicator_code] ?? { numerator: '', denominator: '', note: '', sub_entries: {} })
      : undefined

    const subs: Record<string, string> = { ...cur.sub_entries }
    for (const sub of entry.sub_entries) {
      const baseSub = base ? (base.sub_entries[sub.sub_code] ?? '') : undefined
      subs[sub.sub_code] = mergeNumber(cur.sub_entries[sub.sub_code] ?? '', baseSub, sub.value)
    }
    const merged: FormValue = {
      numerator: mergeNumber(cur.numerator, base?.numerator, entry.numerator),
      denominator: mergeNumber(cur.denominator, base?.denominator, entry.denominator),
      note: mergeText(cur.note, base?.note, entry.note ?? ''),
      sub_entries: subs,
    }
    next = { ...(next ?? formValues), [entry.indicator_code]: merged }
  }
  return next ?? formValues
}

/**
 * The server's latest numbers and "filled by" stamps in the indicators the form was loaded with, so the captions
 * next to the inputs (and a case-list row's value) are not those of the moment the page opened.
 */
export function mergeSavedIntoIndicators(
  indicators: IndicatorFormItem[],
  entries: SavedEntry[],
): IndicatorFormItem[] {
  const saved = new Map(entries.map((e) => [e.indicator_code, e]))
  return indicators.map((ind) => {
    const e = saved.get(ind.indicator_code)
    if (!e) return ind
    return {
      ...ind,
      numerator: e.numerator,
      denominator: e.denominator,
      value: e.value,
      note: e.note ?? '',
      sub_entries: e.sub_entries.length > 0 ? e.sub_entries : ind.sub_entries,
      numerator_filled_by: e.numerator_filled_by,
      numerator_filled_at: e.numerator_filled_at,
      denominator_filled_by: e.denominator_filled_by,
      denominator_filled_at: e.denominator_filled_at,
    }
  })
}
