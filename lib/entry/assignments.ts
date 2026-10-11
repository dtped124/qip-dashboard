/**
 * Field-level assignment rules the assignment admin page needs on the client side (P6).
 *
 * Pure functions with type-only imports (like draft.ts) so `npm run test:unit` can run them. The backend is the
 * judge of what is valid (serializers.IndicatorAssignmentSerializer.validate); these only mirror its overlap rule so
 * the page can skip what would be refused anyway, and describe who covers which number.
 */
import type { AssignmentField, EntryField, IndicatorAssignment } from './types'

export const ASSIGNMENT_FIELD_LABEL: Record<AssignmentField, string> = {
  both: '分子＋分母',
  numerator: '僅分子',
  denominator: '僅分母',
}

/** The numbers an assignment covers: `both` is the numerator and the denominator. */
export function fieldsCovered(field: AssignmentField): EntryField[] {
  return field === 'both' ? ['numerator', 'denominator'] : [field]
}

/**
 * Whether two assignments of one indicator, campus and person clash: they cover a number in common
 * (`both` clashes with everything, a numerator and a denominator assignment do not clash).
 */
export function fieldsOverlap(a: AssignmentField, b: AssignmentField): boolean {
  const covered = fieldsCovered(a)
  return fieldsCovered(b).some((f) => covered.includes(f))
}

export interface FieldCoverage {
  /** Names of the people responsible for each number, primaries before deputies. */
  numerator: string[]
  denominator: string[]
}

/** Who covers each number of one indicator at one campus, given the current assignments of that pair. */
export function coverageOf(
  assignments: ReadonlyArray<Pick<IndicatorAssignment, 'field' | 'role' | 'user_name'>>,
): FieldCoverage {
  const ordered = [...assignments].sort((a, b) => Number(a.role !== 'primary') - Number(b.role !== 'primary'))
  const coverage: FieldCoverage = { numerator: [], denominator: [] }
  for (const a of ordered) {
    for (const field of fieldsCovered(a.field)) {
      if (!coverage[field].includes(a.user_name)) coverage[field].push(a.user_name)
    }
  }
  return coverage
}

/** Every string inside an error body, in order (DRF answers {"field": ["message", ...]}). */
function collectMessages(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value) out.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectMessages(item, out)
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectMessages(item, out)
  }
}

/**
 * The reason a create / update of an assignment was refused (400 body, ApiError.data), all of it: the first message
 * alone (what lib/http.ts keeps) would hide the second problem. The serializer's messages are whole sentences, so no
 * field names are put in front. `fallback` when the body holds no text.
 */
export function describeAssignmentError(data: unknown, fallback: string): string {
  // {"detail": "...", "code": "..."} (permission and CSRF errors): the detail is the message, the code is not.
  const detail = typeof data === 'object' && data !== null ? (data as { detail?: unknown }).detail : undefined
  if (typeof detail === 'string' && detail) return detail
  const messages: string[] = []
  collectMessages(data, messages)
  return messages.length > 0 ? Array.from(new Set(messages)).join('；') : fallback
}
