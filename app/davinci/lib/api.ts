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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body;
}

export async function fetchDavinciMeta(): Promise<DavinciMeta> {
  const res = await fetch(`${API_BASE}/api/davinci/meta/`);
  return jsonOrThrow(res);
}

export async function fetchDavinciIndicators(
  campus: DavinciCampus,
  mode: DavinciMode = 'monthly',
): Promise<{ groups: DavinciPeriodGroup[]; spc: Record<string, DavinciSpcSummary> }> {
  const res = await fetch(
    `${API_BASE}/api/davinci/indicators/?campus=${encodeURIComponent(campus)}&mode=${mode}`,
  );
  const body = await jsonOrThrow(res);
  return { groups: body.data as DavinciPeriodGroup[], spc: body.spc ?? {} };
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
  const res = await fetch(
    `${API_BASE}/api/davinci/indicators/${encodeURIComponent(code)}/series/?${q}`,
  );
  return (await jsonOrThrow(res)) as DavinciSeries;
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
  const res = await fetch(`${API_BASE}/api/davinci/drilldown/?${q}`);
  const body = await jsonOrThrow(res);
  return body.data as DrilldownRow[];
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
  const res = await fetch(`${API_BASE}/api/davinci/cases/?${q}`);
  const body = await jsonOrThrow(res);
  return {
    data: body.data as DavinciCaseRow[],
    total: body.total ?? body.data.length,
    truncated: body.truncated ?? false,
  };
}

export function davinciExportUrl(campus: DavinciCampus): string {
  return `${API_BASE}/api/davinci/export/?campus=${encodeURIComponent(campus)}`;
}

export async function uploadDavinciExcel(file: File): Promise<DavinciImportPreview> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/api/davinci/import/`, {
    method: 'POST',
    body: form,
  });
  const body = await jsonOrThrow(res);
  return body.data as DavinciImportPreview;
}

export async function confirmDavinciImport(logId: number): Promise<{
  log_id: number;
  periods: number[];
  campuses: string[];
  cases_written: number;
  values_created: number;
  values_updated: number;
}> {
  const res = await fetch(`${API_BASE}/api/davinci/import/confirm/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ log_id: logId }),
  });
  const body = await jsonOrThrow(res);
  return body.data;
}
