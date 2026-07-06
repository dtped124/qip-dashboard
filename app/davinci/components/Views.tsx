'use client';

/**
 * 達文西 — 表格檢視與矩陣檢視
 * 版型 1:1 鏡射 QIP 的 components/dashboard/TableView 與 StatusMatrix：
 * - 表格：shadow-sm 卡片、灰底表頭、燈號徽章、mono 藍色代碼連結、面向色點、趨勢箭頭
 * - 矩陣：面向分組標題 + 期別欄 + 狀態色塊格（同 QIP statusColorClass）
 */

import Link from 'next/link';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TrendArrow } from '@/components/dashboard/TrendArrow';
import type {
  DavinciIndicatorMeta,
  DavinciPeriodGroup,
  DavinciPeriodKey,
} from '../lib/types';
import { RATING_CELL_COLORS } from './RatingBadge';
import { DAVINCI_COLOR, unitLabel as fmtUnit } from '../lib/ui';

const CATEGORY_NAME = '達文西手術品質';

interface ViewProps {
  metas: DavinciIndicatorMeta[];
  groups: DavinciPeriodGroup[];
  selectedPeriod: DavinciPeriodKey;
}

function fmtValue(meta: DavinciIndicatorMeta, row: { numerator: number | null; denominator: number | null; value: number | null; median_value: number | null } | null): string {
  if (!row || row.value === null) return '—';
  if (meta.kind === 'rate') return `${row.numerator}/${row.denominator}（${row.value}%）`;
  return `${row.value} ${fmtUnit(meta.unit)}（中位 ${row.median_value ?? '—'}）`;
}

/** 表格檢視（鏡射 QIP TableView） */
export function TableView({ metas, groups, selectedPeriod }: ViewProps) {
  const group = groups.find(g => g.period === selectedPeriod);
  const idx = groups.findIndex(g => g.period === selectedPeriod);
  const prevGroup = idx > 0 ? groups[idx - 1] : null;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">狀態</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">代碼</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">指標名稱</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">面向</th>
            <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">本期值</th>
            <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">上期值</th>
            <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">趨勢</th>
          </tr>
        </thead>
        <tbody>
          {metas.map(meta => {
            const row = group?.indicators.find(r => r.code === meta.code) ?? null;
            const prevRow = prevGroup?.indicators.find(r => r.code === meta.code) ?? null;
            let trend: 'up' | 'down' | 'flat' = 'flat';
            if (row?.value != null && prevRow?.value != null) {
              if (row.value > prevRow.value) trend = 'up';
              else if (row.value < prevRow.value) trend = 'down';
            }
            return (
              <tr key={meta.code} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <StatusBadge status={row?.rating ?? 'neutral'} size="sm" />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/davinci/${meta.code}`} className="font-mono text-sm text-blue-600 hover:underline">
                    {meta.code}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-800 max-w-xs truncate">
                  {meta.name}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: DAVINCI_COLOR }} />
                    {CATEGORY_NAME}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium whitespace-nowrap">
                  {fmtValue(meta, row)}
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-500 whitespace-nowrap">
                  {fmtValue(meta, prevRow)}
                </td>
                <td className="px-4 py-3 text-center">
                  <TrendArrow trend={trend} isReverse={false} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 矩陣檢視（鏡射 QIP StatusMatrix：面向分組 + 期別欄 + 狀態色塊） */
export function MatrixView({ metas, groups }: Omit<ViewProps, 'selectedPeriod'>) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 overflow-x-auto">
      {/* 面向分組標題（鏡射 QIP CategorySection 標題列） */}
      <div className="flex items-center gap-3 mb-3">
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: DAVINCI_COLOR }} />
        <h3 className="text-sm font-bold text-gray-800">{CATEGORY_NAME}</h3>
        <span className="text-xs text-gray-400">{metas.length} 項指標</span>
      </div>
      <table className="text-xs">
        <thead>
          <tr>
            <th className="text-left font-medium text-gray-500 pr-4 pb-2 min-w-[180px]">指標</th>
            {groups.map(g => (
              <th key={String(g.period)} className="font-normal text-gray-400 px-1 pb-2 whitespace-nowrap text-center">
                {g.period_label.replace('年', '.').replace('月', '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metas.map(meta => (
            <tr key={meta.code}>
              <td className="pr-4 py-1 whitespace-nowrap">
                <Link href={`/davinci/${meta.code}`} className="text-sm text-gray-700 hover:text-blue-600">
                  <span className="font-mono text-xs text-gray-400 mr-1.5">{meta.code}</span>
                  {meta.name}
                </Link>
              </td>
              {groups.map(g => {
                const row = g.indicators.find(r => r.code === meta.code);
                const rating = row?.rating ?? 'neutral';
                const title = row
                  ? `${g.period_label}：${meta.kind === 'rate' ? `${row.numerator}/${row.denominator}（${row.value}%）` : `${row.value}`}（${row.rating_label}）`
                  : g.period_label;
                return (
                  <td key={String(g.period)} className="px-1 py-1">
                    <Link href={`/davinci/${meta.code}`}>
                      <div
                        title={title}
                        className={`w-9 h-7 rounded ${RATING_CELL_COLORS[rating]} flex items-center justify-center text-[10px] font-medium ${
                          rating === 'neutral' ? 'text-gray-500' : 'text-white'
                        } hover:ring-2 hover:ring-blue-300 transition-shadow`}
                      >
                        {meta.kind === 'rate' ? row?.numerator ?? '' : ''}
                      </div>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-400 mt-3">
        格內數字為事件數（比率型）；顏色 = 該期評級（紅警示／橘注意／黃留意／灰監測）
      </p>
    </div>
  );
}
