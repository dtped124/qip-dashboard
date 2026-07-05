'use client';

/** 達文西 — 表格檢視與矩陣檢視（Phase 4） */

import Link from 'next/link';
import type {
  DavinciCampus,
  DavinciIndicatorMeta,
  DavinciPeriodGroup,
  DavinciPeriodKey,
} from '../lib/types';
import { RatingBadge, RATING_CELL_COLORS } from './RatingBadge';
import { unitLabel as fmtUnit } from '../lib/ui';

interface ViewProps {
  metas: DavinciIndicatorMeta[];
  groups: DavinciPeriodGroup[];
  selectedPeriod: DavinciPeriodKey;
  campus: DavinciCampus;
}

function fmtValue(meta: DavinciIndicatorMeta, row: { numerator: number | null; denominator: number | null; value: number | null; median_value: number | null } | null): string {
  if (!row || row.value === null) return '—';
  if (meta.kind === 'rate') return `${row.numerator}/${row.denominator}（${row.value}%）`;
  return `${row.value} ${fmtUnit(meta.unit)}（中位 ${row.median_value ?? '—'}）`;
}

/** 表格檢視：指標 × 當期值/評級/訊號 */
export function TableView({ metas, groups, selectedPeriod, campus }: ViewProps) {
  const group = groups.find(g => g.period === selectedPeriod);
  const prevIdx = groups.findIndex(g => g.period === selectedPeriod) - 1;
  const prevGroup = prevIdx >= 0 ? groups[prevIdx] : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 border-b">
            <th className="text-left font-normal px-4 py-2">指標</th>
            <th className="text-right font-normal px-4 py-2">本期</th>
            <th className="text-right font-normal px-4 py-2">上期</th>
            <th className="text-left font-normal px-4 py-2">評級</th>
            <th className="text-left font-normal px-4 py-2">WER 訊號</th>
          </tr>
        </thead>
        <tbody>
          {metas.map(meta => {
            const row = group?.indicators.find(r => r.code === meta.code) ?? null;
            const prevRow = prevGroup?.indicators.find(r => r.code === meta.code) ?? null;
            return (
              <tr key={meta.code} className="border-b border-gray-50 hover:bg-blue-50/40">
                <td className="px-4 py-2">
                  <Link
                    href={`/davinci/${meta.code}`}
                    className="text-blue-700 hover:underline"
                  >
                    <span className="text-gray-400 mr-1">{meta.code}</span>
                    {meta.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{fmtValue(meta, row)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap text-gray-400">{fmtValue(meta, prevRow)}</td>
                <td className="px-4 py-2"><RatingBadge rating={row?.rating ?? 'neutral'} small /></td>
                <td className="px-4 py-2 text-xs text-red-600">
                  {(row?.signals ?? []).map(s => s.message).join('；') || <span className="text-gray-300">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 矩陣檢視：指標 × 期別 的評級網格 */
export function MatrixView({ metas, groups, campus }: Omit<ViewProps, 'selectedPeriod'>) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto p-4">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="text-left font-normal text-gray-400 pr-3 pb-2">指標</th>
            {groups.map(g => (
              <th key={String(g.period)} className="font-normal text-gray-400 px-1 pb-2 whitespace-nowrap">
                {g.period_label.replace('年', '.')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metas.map(meta => (
            <tr key={meta.code}>
              <td className="pr-3 py-1 whitespace-nowrap">
                <Link
                  href={`/davinci/${meta.code}`}
                  className="text-blue-700 hover:underline"
                >
                  {meta.code} {meta.name}
                </Link>
              </td>
              {groups.map(g => {
                const row = g.indicators.find(r => r.code === meta.code);
                const rating = row?.rating ?? 'neutral';
                const title = row
                  ? `${g.period_label}：${meta.kind === 'rate' ? `${row.numerator}/${row.denominator}` : row.value}（${row.rating_label}）`
                  : g.period_label;
                return (
                  <td key={String(g.period)} className="px-1 py-1">
                    <div
                      title={title}
                      className={`w-8 h-6 rounded ${RATING_CELL_COLORS[rating]} flex items-center justify-center text-[9px] ${rating === 'neutral' ? 'text-gray-500' : 'text-white'}`}
                    >
                      {meta.kind === 'rate' ? row?.numerator ?? '' : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-400 mt-2">
        格內數字為事件數（比率型）；顏色 = 該期評級（紅警示/橘注意/黃留意/灰監測）
      </p>
    </div>
  );
}
