// ─── 填報系統 TypeScript 型別定義 ───────────────────────────────

export type ReportStatus = 'unfilled' | 'draft' | 'submitted' | 'approved' | 'finalized'

export type UserRole = 'reporter' | 'reviewer' | 'admin' | 'viewer'

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
  /** Optional: left out, the server generates a temporary password (see UserCreateResponse). */
  password?: string
}

/** POST /api/admin/users: the new user, plus the generated password when none was supplied (shown once). */
export interface UserCreateResponse extends User {
  temporary_password?: string
}

/** POST /api/admin/users/:id/reset-password: the one-time temporary password. */
export interface ResetPasswordResponse {
  temporary_password: string
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

/** One row of my-tasks is a campus x category (the same category can appear once per campus). */
export interface RejectionNotice {
  category_code: string
  category_name: string
  campus_code: string
  campus_name: string
  reason: string
  report_id: number
}

export interface CategoryTask {
  category_code: string
  category_name: string
  category_color: string
  campus_code: string
  campus_name: string
  report_id: number | null
  status: ReportStatus
  /** Indicators I am responsible for / of those, the ones whose fields of mine are all filled. */
  filled_count: number
  total_count: number
  /** Fields (numerator / denominator) I am responsible for / of those, the ones already filled. */
  my_filled: number
  my_total: number
  /** Required fields still empty in the whole campus x category, whoever owns them. */
  category_missing: number
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

/** The two numbers of an indicator that can be assigned to different people. */
export type EntryField = 'numerator' | 'denominator'

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
  /** The fields I may type into (empty for a case-list indicator, whose numbers do not come from the form). */
  editable_fields: EntryField[]
  /** Names of the people currently responsible for each field ([] = nobody; a count indicator has no denominator). */
  field_owners: { numerator: string[]; denominator: string[] }
  /** Who last filled each field and when (ISO time); null = never filled. */
  numerator_filled_by: string | null
  numerator_filled_at: string | null
  denominator_filled_by: string | null
  denominator_filled_at: string | null
}

export interface EntryFormResponse {
  report: {
    /** null while the monthly report does not exist yet (GET /api/entry/form creates nothing). */
    id: number | null
    status: ReportStatus
    rejection_reason: string
    submitted_at: string | null
    is_late: boolean
    /** Computed by the backend: the reporter may not change anything any more. */
    locked: boolean
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

/** What an input of the form reports: a number field, the note, or one HA10 sub-category (`sub`). */
export type FormField = 'numerator' | 'denominator' | 'note' | 'sub'

// ─── 指標負責人指派 ─────────────────────────────────────────────

export type AssignmentRole = 'primary' | 'deputy'

/** Which numbers of an indicator an assignment covers; `both` is the numerator and the denominator. */
export type AssignmentField = 'both' | 'numerator' | 'denominator'

export interface IndicatorAssignment {
  id: number
  indicator_code: string
  campus: number
  campus_name: string
  user: number
  user_name: string
  user_employee_id: string
  role: AssignmentRole
  field: AssignmentField
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
  field: AssignmentField
  effective_from: string
}

// ─── 填報截止日設定（/api/admin/deadlines）──────────────────────

export interface DeadlineSetting {
  id: number
  year: number          // ROC year (民國年)
  month: number
  deadline_day: number
  note: string
}

export type DeadlineSettingPayload = Omit<DeadlineSetting, 'id'>

// ─── 驗證結果 ─────────────────────────────────────────────────

export type ValidationLevel = 'error' | 'warning' | 'ok'

export interface ValidationResult {
  level: ValidationLevel
  message: string
}

export type FormValidations = Record<string, ValidationResult>  // indicator_code → result

// ─── save-draft / submit 回應 ────────────────────────────────

/** One entry of a save-draft payload: only the keys present are written (absent = untouched, null = clear). */
export interface DraftEntry {
  indicator_code: string
  numerator?: number | null
  denominator?: number | null
  note?: string
  /** HA10-01 at Hsinchu only, always all 13 sub-categories. */
  sub_entries?: Array<{ sub_code: string; value: number | null }>
}

/** What the server stored for an indicator of the payload (other people's fields included). */
export interface SavedEntry {
  indicator_code: string
  numerator: number | null
  denominator: number | null
  value: number | null
  note: string
  numerator_filled_by: string | null
  numerator_filled_at: string | null
  denominator_filled_by: string | null
  denominator_filled_at: string | null
  filled_by: string | null
  filled_at: string | null
  sub_entries: HA10SubEntry[]
  is_ha10_hsinchu: boolean
}

export interface SaveDraftResponse {
  ok: boolean
  /** null when the payload had nothing to write and the report does not exist yet. */
  report_id: number | null
  status: ReportStatus
  entries: SavedEntry[]
}

export interface SubmitResponse {
  ok: boolean
  report_id: number
  status: ReportStatus
}

/** A required field that is still empty, as listed by the 400 `incomplete` answer of submit. */
export interface MissingField {
  indicator_code: string
  indicator_name: string
  field: EntryField
  /** Names of the people responsible for the field; empty = nobody (`unassigned`). */
  owners: string[]
  unassigned: boolean
  /** HA10-01 at Hsinchu: the sub-categories without a value. */
  sub_codes?: string[]
}

/** Body of the 400 `incomplete` answer of POST /api/entry/submit (ApiError.data). */
export interface SubmitIncompleteBody {
  detail: string
  code: 'incomplete'
  missing: MissingField[]
  /** Indicator codes with a gap; kept by the backend for clients that predate `missing`. */
  unfilled_codes?: string[]
}
