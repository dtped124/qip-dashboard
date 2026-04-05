/**
 * 填報系統 API 客戶端
 * 所有 API 呼叫集中在此，方便日後切換 base URL
 */
import type {
  AssignmentCreatePayload,
  Campus,
  EntryFormResponse,
  FormValue,
  IndicatorAssignment,
  MyTasksResponse,
  SaveDraftResponse,
  SubmitResponse,
  User,
  UserCreatePayload,
  UserUpdatePayload,
} from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001'

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  return match ? match[1] : ''
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  // Django CSRF: non-safe methods 需帶 X-CSRFToken header
  const method = (options.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const token = getCsrfToken()
    if (token) headers['X-CSRFToken'] = token
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers,
    ...options,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

// ─── 認證 ──────────────────────────────────────────────────────

export async function login(employeeId: string, password: string): Promise<User> {
  return apiFetch<User>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ employee_id: employeeId, password }),
  })
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' })
}

export async function getMe(): Promise<User> {
  return apiFetch<User>('/api/auth/me')
}

// ─── 帳號管理（系統管理員）──────────────────────────────────────

export async function listUsers(): Promise<User[]> {
  return apiFetch<User[]>('/api/admin/users')
}

export async function createUser(data: UserCreatePayload): Promise<User> {
  return apiFetch<User>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateUser(id: number, data: UserUpdatePayload): Promise<User> {
  return apiFetch<User>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteUser(id: number): Promise<void> {
  await apiFetch<void>(`/api/admin/users/${id}`, { method: 'DELETE' })
}

export async function resetPassword(id: number): Promise<{ detail: string }> {
  return apiFetch<{ detail: string }>(`/api/admin/users/${id}/reset-password`, {
    method: 'POST',
  })
}

export async function changePassword(newPassword: string): Promise<void> {
  await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export async function listCampuses(): Promise<Campus[]> {
  return apiFetch<Campus[]>('/api/admin/campuses')
}

// ─── 指標負責人指派 ──────────────────────────────────────────────

export async function listAssignments(campus?: string, indicator?: string): Promise<IndicatorAssignment[]> {
  const params = new URLSearchParams()
  if (campus) params.set('campus', campus)
  if (indicator) params.set('indicator', indicator)
  const qs = params.toString()
  return apiFetch<IndicatorAssignment[]>(`/api/admin/assignments${qs ? `?${qs}` : ''}`)
}

export async function createAssignment(data: AssignmentCreatePayload): Promise<IndicatorAssignment> {
  return apiFetch<IndicatorAssignment>('/api/admin/assignments', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteAssignment(id: number): Promise<void> {
  await apiFetch<void>(`/api/admin/assignments/${id}`, { method: 'DELETE' })
}

// ─── 填報 API ──────────────────────────────────────────────────

export async function getMyTasks(year: number, month: number): Promise<MyTasksResponse> {
  return apiFetch<MyTasksResponse>(
    `/api/entry/my-tasks?year=${year}&month=${month}`
  )
}

export async function getEntryForm(
  year: number,
  month: number,
  categoryCode: string
): Promise<EntryFormResponse> {
  return apiFetch<EntryFormResponse>(
    `/api/entry/form?year=${year}&month=${month}&category=${categoryCode}`
  )
}

export interface DraftPayload {
  year: number
  month: number
  category: string
  entries: Array<{
    indicator_code: string
    numerator: number | null
    denominator: number | null
    note: string
    sub_entries?: Array<{ sub_code: string; sub_name: string; value: number | null }>
  }>
}

export async function saveDraft(payload: DraftPayload): Promise<SaveDraftResponse> {
  return apiFetch<SaveDraftResponse>('/api/entry/save-draft', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function submitCategory(
  year: number,
  month: number,
  category: string
): Promise<SubmitResponse> {
  return apiFetch<SubmitResponse>('/api/entry/submit', {
    method: 'POST',
    body: JSON.stringify({ year, month, category }),
  })
}

// ─── 審核 API ──────────────────────────────────────────────────

export async function getReviewOverview(year: number, month: number) {
  return apiFetch<ReviewOverviewResponse>(`/api/review/overview?year=${year}&month=${month}`)
}

export async function getReviewDetail(
  campus: string, year: number, month: number, category: string
) {
  return apiFetch<ReviewDetailResponse>(
    `/api/review/detail?campus=${campus}&year=${year}&month=${month}&category=${category}`
  )
}

export async function approveCategory(campus: string, year: number, month: number, category: string) {
  return apiFetch('/api/review/approve', {
    method: 'POST',
    body: JSON.stringify({ campus, year, month, category }),
  })
}

export async function rejectCategory(
  campus: string, year: number, month: number, category: string, reason: string
) {
  return apiFetch('/api/review/reject', {
    method: 'POST',
    body: JSON.stringify({ campus, year, month, category, reason }),
  })
}

export async function editEntry(
  entryId: number, field: string, newValue: string, reason: string
) {
  return apiFetch('/api/review/edit-entry', {
    method: 'PATCH',
    body: JSON.stringify({ entry_id: entryId, field, new_value: newValue, reason }),
  })
}

export async function finalizeMonth(campus: string, year: number, month: number) {
  return apiFetch('/api/review/finalize', {
    method: 'POST',
    body: JSON.stringify({ campus, year, month }),
  })
}

// ─── 個案清單 API ───────────────────────────────────────────────

export async function getCaseList(
  indicator: string, campus: string, year: number, month: number
) {
  return apiFetch<CaseListResponse>(
    `/api/case-list/?indicator=${indicator}&campus=${campus}&year=${year}&month=${month}`
  )
}

export async function excludeCases(
  caseRecordIds: number[], exclusionReasonCode: string, exclusionNote: string
) {
  return apiFetch('/api/case-list/exclude', {
    method: 'POST',
    body: JSON.stringify({
      case_record_ids: caseRecordIds,
      exclusion_reason_code: exclusionReasonCode,
      exclusion_note: exclusionNote,
    }),
  })
}

export async function restoreCases(caseRecordIds: number[]) {
  return apiFetch('/api/case-list/restore', {
    method: 'POST',
    body: JSON.stringify({ case_record_ids: caseRecordIds }),
  })
}

export async function getExclusionReasons(): Promise<ExclusionReason[]> {
  return apiFetch('/api/case-list/exclusion-reasons')
}

export async function reviewExclusion(
  caseRecordId: number, approved: boolean, reviewerNote: string
) {
  return apiFetch('/api/case-list/review-exclusion', {
    method: 'POST',
    body: JSON.stringify({ case_record_id: caseRecordId, approved, reviewer_note: reviewerNote }),
  })
}

// ─── 型別（review + case-list）────────────────────────────────

export interface ReviewCategoryStatus {
  category_code: string
  category_name: string
  status: string
  report_id: number | null
  is_late: boolean
}

export interface ReviewCampusRow {
  campus_code: string
  campus_name: string
  benchmark_level: string
  categories: ReviewCategoryStatus[]
  all_approved: boolean
  submitted_count: number
}

export interface ReviewOverviewResponse {
  year: number
  month: number
  campuses: ReviewCampusRow[]
  categories: Array<{ code: string; name: string; color: string }>
}

export interface ReviewIndicatorRow {
  entry_id: number
  indicator_code: string
  indicator_name: string
  unit: string
  direction: string
  has_denominator: boolean
  entry_mode: string
  numerator: number | null
  denominator: number | null
  raw_numerator: number | null
  exclusion_count: number
  value: number | null
  note: string
  data_source: string
  filled_by: string | null
  filled_at: string | null
  prev_value: number | null
  change_pct: number | null
  is_anomaly: boolean
  audit_logs: Array<{
    field_name: string
    old_value: string
    new_value: string
    changed_by: string
    changed_at: string
    reason: string
  }>
}

export interface ReviewDetailResponse {
  report: {
    id: number
    status: string
    rejection_reason: string
    submitted_at: string | null
    submitted_by: string | null
    approved_at: string | null
    approved_by: string | null
    is_late: boolean
  }
  category: { code: string; name: string; color: string }
  campus: { code: string; name: string }
  period: { year: number; month: number }
  indicators: ReviewIndicatorRow[]
}

export interface CaseRecord {
  id: number
  case_role: 'numerator' | 'denominator'
  his_raw_data: Record<string, unknown>
  is_excluded: boolean
  excluded_by: string | null
  excluded_at: string | null
  exclusion_reason_code: string | null
  exclusion_reason_name: string | null
  exclusion_note: string
  reviewer_approved: boolean | null
  reviewer_note: string
}

export interface CaseListResponse {
  entry_id: number
  indicator_code: string
  summary: {
    denominator_total: number
    raw_numerator: number
    excluded: number
    final_numerator: number
  }
  records: CaseRecord[]
}

export interface ExclusionReason {
  code: string
  name: string
  description: string
}

// ─── 輔助：將 FormValues 轉成 DraftPayload.entries ─────────────

export function formValuesToDraftEntries(
  formValues: Record<string, FormValue>,
  indicators: Array<{
    indicator_code: string
    has_denominator: boolean
    is_ha10_hsinchu: boolean
    sub_entries: Array<{ sub_code: string; sub_name: string }>
  }>
): DraftPayload['entries'] {
  return indicators.map((ind) => {
    const fv = formValues[ind.indicator_code]
    const parseNum = (s: string) => {
      const n = parseFloat(s)
      return isNaN(n) ? null : n
    }

    const entry: DraftPayload['entries'][0] = {
      indicator_code: ind.indicator_code,
      numerator: parseNum(fv?.numerator ?? ''),
      denominator: ind.has_denominator ? parseNum(fv?.denominator ?? '') : null,
      note: fv?.note ?? '',
    }

    if (ind.is_ha10_hsinchu) {
      entry.sub_entries = ind.sub_entries.map((sub) => ({
        sub_code: sub.sub_code,
        sub_name: sub.sub_name,
        value: parseNum(fv?.sub_entries?.[sub.sub_code] ?? ''),
      }))
    }

    return entry
  })
}
