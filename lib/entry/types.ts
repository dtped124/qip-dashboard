// ─── 填報系統 TypeScript 型別定義 ───────────────────────────────

export type ReportStatus = 'unfilled' | 'draft' | 'submitted' | 'approved' | 'finalized'

export type UserRole = 'reporter' | 'reviewer' | 'admin'

export interface User {
  id: number
  employee_id: string
  full_name: string
  email: string
  campus_code: string | null
  campus_name: string | null
  roles: UserRole[]
  is_active: boolean
  must_change_password: boolean
}

export interface UserCreatePayload {
  employee_id: string
  full_name: string
  email: string
  campus: number | null
  roles: UserRole[]
  password: string
}

export interface UserUpdatePayload {
  full_name?: string
  email?: string
  campus?: number | null
  roles?: UserRole[]
  is_active?: boolean
}

export interface Campus {
  id: number
  code: string
  name: string
}

export interface DeadlineInfo {
  deadline_day: number
  deadline_date: string
  tw_deadline_date: string
  days_remaining: number
  is_overdue: boolean
}

// ─── my-tasks ─────────────────────────────────────────────────

export interface RejectionNotice {
  category_code: string
  category_name: string
  reason: string
  report_id: number
}

export interface CategoryTask {
  category_code: string
  category_name: string
  category_color: string
  report_id: number | null
  status: ReportStatus
  filled_count: number
  total_count: number
  rejection_reason: string
}

export interface MyTasksResponse {
  period: { year: number; month: number }
  deadline: DeadlineInfo
  rejection_notices: RejectionNotice[]
  categories: CategoryTask[]
  overall_progress: { filled: number; total: number }
}

// ─── form ────────────────────────────────────────────────────

export interface HA10SubEntry {
  sub_code: string
  sub_name: string
  value: number | null
}

export interface IndicatorFormItem {
  indicator_code: string
  indicator_name: string
  unit: string            // 'percent' | 'permille' | 'count' | 'ratio'
  direction: string       // 'lower' | 'higher' | 'monitor'
  has_denominator: boolean
  entry_mode: string      // 'manual' | 'case_list'
  numerator: number | null
  denominator: number | null
  value: number | null
  note: string
  prev_value: number | null
  prev_numerator: number | null
  prev_denominator: number | null
  change_pct: number | null
  exclusion_count?: number
  sub_entries: HA10SubEntry[]
  is_ha10_hsinchu: boolean
}

export interface EntryFormResponse {
  report: {
    id: number
    status: ReportStatus
    rejection_reason: string
    submitted_at: string | null
    is_late: boolean
  }
  category: { code: string; name: string; color: string }
  campus: { code: string; name: string }
  period: { year: number; month: number }
  deadline: DeadlineInfo
  indicators: IndicatorFormItem[]
}

// ─── 本地表單狀態 ─────────────────────────────────────────────

export interface FormValue {
  numerator: string       // 字串，避免輸入途中就觸發驗證
  denominator: string
  note: string
  sub_entries: Record<string, string>  // sub_code → value string
}

export type FormValues = Record<string, FormValue>  // indicator_code → FormValue

// ─── 指標負責人指派 ─────────────────────────────────────────────

export type AssignmentRole = 'primary' | 'deputy'

export interface IndicatorAssignment {
  id: number
  indicator_code: string
  campus: number
  campus_name: string
  user: number
  user_name: string
  user_employee_id: string
  role: AssignmentRole
  effective_from: string
  effective_to: string | null
  created_by: number | null
  created_at: string
}

export interface AssignmentCreatePayload {
  indicator_code: string
  campus: number
  user: number
  role: AssignmentRole
  effective_from: string
}

// ─── 驗證結果 ─────────────────────────────────────────────────

export type ValidationLevel = 'error' | 'warning' | 'ok'

export interface ValidationResult {
  level: ValidationLevel
  message: string
}

export type FormValidations = Record<string, ValidationResult>  // indicator_code → result

// ─── save-draft / submit 回應 ────────────────────────────────

export interface SaveDraftResponse {
  ok: boolean
  report_id: number
  status: ReportStatus
}

export interface SubmitResponse {
  ok: boolean
  report_id: number
  status: ReportStatus
  unfilled_codes?: string[]
}
