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

export interface DavinciIndicatorRow {
  period: number;                    // 西元 yyyymm
  indicator_code: string;
  numerator: number | null;
  denominator: number | null;
  value: number | null;              // 比率(%) 或 月平均
  median_value: number | null;
  n_cases: number;
  n_excluded: number;
}

export interface DavinciPeriodGroup {
  period: number;
  period_label: string;              // '115年5月'
  indicators: DavinciIndicatorRow[];
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
    cleaned: number | null;
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
