/** 達文西模組 API client（前綴 /api/davinci/，獨立於 QIP lib/api.ts） */

import type {
  DavinciCampus,
  DavinciImportPreview,
  DavinciMeta,
  DavinciPeriodGroup,
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
): Promise<DavinciPeriodGroup[]> {
  const res = await fetch(
    `${API_BASE}/api/davinci/indicators/?campus=${encodeURIComponent(campus)}`,
  );
  const body = await jsonOrThrow(res);
  return body.data as DavinciPeriodGroup[];
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
