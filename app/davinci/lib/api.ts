/** 達文西模組 API client（前綴 /api/davinci/，獨立於 QIP lib/api.ts） */

import type {
  DavinciCampus,
  DavinciCaseRow,
  DavinciImportPreview,
  DavinciMeta,
  DavinciMode,
  DavinciPeriodGroup,
  DavinciPeriodKey,
  DavinciScope,
  DavinciSeries,
  DavinciSpcSummary,
  DrilldownBy,
  DrilldownRow,
} from './types';
import { apiUrl, request } from '@/lib/http';

// Errors are ApiError (lib/http.ts); `{error: {code, message}}` bodies surface their message.

export async function fetchDavinciMeta(): Promise<DavinciMeta> {
  return request<DavinciMeta>('/api/davinci/meta/');
}

export async function fetchDavinciIndicators(
  campus: DavinciCampus,
  mode: DavinciMode = 'monthly',
): Promise<{ groups: DavinciPeriodGroup[]; spc: Record<string, DavinciSpcSummary> }> {
  const body = await request<{ data: DavinciPeriodGroup[]; spc?: Record<string, DavinciSpcSummary> }>(
    `/api/davinci/indicators/?campus=${encodeURIComponent(campus)}&mode=${mode}`,
  );
  return { groups: body.data, spc: body.spc ?? {} };
}

/**
 * 跨期序列。scope 為選填，用於「完整數據」跟隨下鑽選取的科別／醫師。
 * 帶 scope 時後端不回傳管制限（科別層人次過少），呼叫端只該取 points。
 */
export async function fetchDavinciSeries(
  code: string,
  campus: DavinciCampus,
  mode: DavinciMode = 'monthly',
  scope?: DavinciScope,
): Promise<DavinciSeries> {
  const q = new URLSearchParams({ campus, mode });
  if (scope?.dept) q.set('dept', scope.dept);
  if (scope?.surgeon) q.set('surgeon', scope.surgeon);
  return request<DavinciSeries>(
    `/api/davinci/indicators/${encodeURIComponent(code)}/series/?${q}`,
  );
}

export async function fetchDrilldown(params: {
  code: string;
  campus: DavinciCampus;
  period: DavinciPeriodKey;
  by: DrilldownBy;
  dept?: string;
  surgeon?: string;
  order?: string;
}): Promise<DrilldownRow[]> {
  const q = new URLSearchParams({
    code: params.code,
    campus: params.campus,
    period: String(params.period),
    by: params.by,
  });
  if (params.dept) q.set('dept', params.dept);
  if (params.surgeon) q.set('surgeon', params.surgeon);
  if (params.order) q.set('order', params.order);
  const body = await request<{ data: DrilldownRow[] }>(`/api/davinci/drilldown/?${q}`);
  return body.data;
}

export async function fetchCases(params: {
  campus: DavinciCampus;
  period: DavinciPeriodKey;
  code?: string;
  dept?: string;
  surgeon?: string;
  order?: string;
}): Promise<{ data: DavinciCaseRow[]; total: number; truncated: boolean }> {
  const q = new URLSearchParams({
    campus: params.campus,
    period: String(params.period),
  });
  if (params.code) q.set('code', params.code);
  if (params.dept) q.set('dept', params.dept);
  if (params.surgeon) q.set('surgeon', params.surgeon);
  if (params.order) q.set('order', params.order);
  const body = await request<{ data: DavinciCaseRow[]; total?: number; truncated?: boolean }>(
    `/api/davinci/cases/?${q}`,
  );
  return {
    data: body.data,
    total: body.total ?? body.data.length,
    truncated: body.truncated ?? false,
  };
}

/** href for the xlsx export link (plain `<a>`, so it goes through apiUrl rather than request). */
export function davinciExportUrl(campus: DavinciCampus): string {
  return apiUrl(`/api/davinci/export/?campus=${encodeURIComponent(campus)}`);
}

export async function uploadDavinciExcel(file: File): Promise<DavinciImportPreview> {
  const form = new FormData();
  form.append('file', file);
  const body = await request<{ data: DavinciImportPreview }>('/api/davinci/import/', {
    method: 'POST',
    form,
  });
  return body.data;
}

interface DavinciImportConfirmResult {
  log_id: number;
  periods: number[];
  campuses: string[];
  cases_written: number;
  values_created: number;
  values_updated: number;
}

export async function confirmDavinciImport(logId: number): Promise<DavinciImportConfirmResult> {
  const body = await request<{ data: DavinciImportConfirmResult }>('/api/davinci/import/confirm/', {
    method: 'POST',
    json: { log_id: logId },
  });
  return body.data;
}
