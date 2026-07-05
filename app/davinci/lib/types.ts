/** 達文西模組型別（獨立於 QIP lib/types.ts，不共用） */

export type DavinciCampus = '竹北' | '新竹';

export interface DavinciIndicatorMeta {
  code: string;                      // DV01–DV07
  name: string;
  kind: 'rate' | 'continuous';
  unit: string;                      // percent / min / ml
}

export interface DavinciMeta {
  category: string;
  indicators: DavinciIndicatorMeta[];
  campuses: DavinciCampus[];
  adverse_event_codes: Record<string, string>;
  severe_comp_codes: Record<string, string>;
  p_chart_min_n: number;
}

export type DavinciMode = 'monthly' | 'quarterly';
export type DavinciRating = 'alert' | 'warning' | 'watch' | 'neutral';
export type DavinciPeriodKey = number | string;   // 月 202605 / 季 '2026Q2'

export interface DavinciSignal {
  rule: string;
  severity: string;
  message: string;
}

export interface DavinciIndicatorRow {
  code: string;                      // DV01–DV07
  numerator: number | null;
  denominator: number | null;
  value: number | null;              // 比率(%) 或 月平均
  median_value: number | null;
  n_cases: number;
  n_excluded: number;
  rating: DavinciRating;
  rating_label: string;
  signals: DavinciSignal[];
}

export interface DavinciPeriodGroup {
  period: DavinciPeriodKey;
  period_label: string;              // '115年5月' / '115年Q2'
  indicators: DavinciIndicatorRow[];
}

export interface DavinciSpcSummary {
  rating: DavinciRating;
  rating_label: string;
  insufficient: boolean;
  baseline_warning: boolean;
  baseline_n: number;
}

export interface DavinciSeriesPoint {
  period: DavinciPeriodKey;
  label: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  rating: DavinciRating;
}

export interface DavinciSeries {
  code: string;
  name: string;
  kind: 'rate' | 'continuous';
  unit: string;
  campus: string;
  mode: DavinciMode;
  points: DavinciSeriesPoint[];
  spc: {
    has_chart: boolean;
    insufficient: boolean;
    baseline_warning: boolean;
    baseline_n: number;
    cl: number | null;
    sigma: number | null;
    ucl: number | null;
    lcl: number | null;
    ucl2: number | null;
    lcl2: number | null;
    p_cl: number | null;
    p_limits: { period: DavinciPeriodKey; ucl: number; lcl: number; ucl2: number; lcl2: number; n: number }[];
    rating: DavinciRating;
    rating_label: string;
    signals: {
      rule: string;
      period: DavinciPeriodKey;
      label: string;
      value: number | null;
      side: 'high' | 'low';
      severity: string;
      message: string;
    }[];
  };
}

export type DrilldownBy = 'dept' | 'surgeon' | 'order';

export interface DrilldownRow {
  key: string;
  numerator: number | null;
  denominator: number;
  value: number | null;
}

export interface DavinciCaseRow {
  period: number;
  period_label: string;
  account: string;
  chart_no: string;
  patient: string;
  dept: string;
  surgeon: string;
  orders: string[];
  op_date: string | null;
  op_time_min: number | null;
  blood_ml: number | null;
  conversion: boolean;
  adverse_14d: boolean;
  adverse: { code: string; label: string }[];
  adverse_free_text: string;
  severe_comp_30d: boolean;
  severe: { code: string; label: string }[];
  infection_14d: boolean;
  reoperation_14d: boolean;
  flags: string[];
  is_event: boolean | null;
}

export interface DavinciImportReport {
  summary: {
    campus: string;
    period: number;
    period_label: string;
    cases_dedup: number;
    rows_raw: number;
    indicators: {
      code: string;
      numerator: number | null;
      denominator: number | null;
      value: number | null;
      median: number | null;
      n_excluded: number;
    }[];
  }[];
  cleaned: {
    sheet: string;
    row: number;
    campus: string;
    period: number;
    field: string;
    raw: string | null;
    cleaned: number | string | null;
    flag: string;
  }[];
  conflicts: {
    sheet: string;
    row: number | number[];
    campus: string;
    period: number;
    field: string;
    flag: string;
  }[];
  pending: { sheet: string; row: number; issue: string; detail: string }[];
  header_warnings: string[];
  masked: number;
}

export interface DavinciImportPreview {
  log_id: number;
  file_name: string;
  rows_raw: number;
  cases_dedup: number;
  periods: number[];
  period_labels: string[];
  campuses: string[];
  report: DavinciImportReport;
}
