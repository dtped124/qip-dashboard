'use client';

import { useRouter } from 'next/navigation';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import type { IndicatorData, Campus, IndicatorStatus } from '@/lib/types';

const ALL_CAMPUSES: Campus[] = ['竹北', '竹東', '新竹'];

const STATUS_LABEL: Record<IndicatorStatus, string> = {
  alert: '警示', warning: '注意', watch: '留意',
  good: '良好', excellent: '卓越', neutral: '監測中',
};

const STATUS_STYLE: Record<IndicatorStatus, string> = {
  alert:    'bg-red-100 text-red-700 border border-red-200',
  warning:  'bg-orange-100 text-orange-700 border border-orange-200',
  watch:    'bg-yellow-100 text-yellow-700 border border-yellow-200',
  good:     'bg-green-100 text-green-700 border border-green-200',
  excellent:'bg-emerald-100 text-emerald-800 border border-emerald-200',
  neutral:  'bg-gray-100 text-gray-500 border border-gray-200',
};

const ANOMALOUS_STATUSES = ['alert', 'warning', 'watch'] as const;
function isAnomalous(s: IndicatorStatus) { return (ANOMALOUS_STATUSES as readonly string[]).includes(s); }

// 判斷變化是否有利
function isFavorableChange(arrow: '↑' | '↓' | '→', direction: string): boolean | null {
  if (arrow === '→') return null;
  if (direction === 'lower') return arrow === '↓';
  if (direction === 'higher') return arrow === '↑';
  return null; // monitor — no good/bad judgment
}

interface CampusCellData {
  exists: boolean;
  value: number | null;
  status: IndicatorStatus;
  prevValue: number | null;
  changeArrow: '↑' | '↓' | '→';
}

interface TableRow {
  code: string;
  name: string;
  category: string;
  direction: string;
  isSingleCampus: boolean;
  cells: Record<string, CampusCellData>;
  hasAnomaly: boolean;
}

// 支援 "115.03" (Django) 和 "115年3月" 兩種格式
function parseLatestMonth(s: string | null): { year: number; month: number } | null {
  if (!s) return null;
  const m1 = s.match(/^(\d+)\.(\d+)$/);
  if (m1) return { year: parseInt(m1[1]), month: parseInt(m1[2]) };
  const m2 = s.match(/^(\d+)年(\d+)月$/);
  if (m2) return { year: parseInt(m2[1]), month: parseInt(m2[2]) };
  return null;
}

// 計算某季的平均值
// upToMonth：只算到這個月（含）為止，避免把「尚未匯入的月份值為 0」納入計算
function quarterAverage(
  monthlyData: { year: number; month: number; value: number | null }[],
  year: number,
  quarterStartMonth: number,  // 1, 4, 7, 10
  upToMonth?: number          // 省略代表整季都算
): number | null {
  const endMonth = Math.min(quarterStartMonth + 2, upToMonth ?? quarterStartMonth + 2);
  const vals: number[] = [];
  for (let m = quarterStartMonth; m <= endMonth; m++) {
    const dp = monthlyData.find(d => d.year === year && d.month === m);
    if (dp && dp.value !== null) vals.push(dp.value);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// 根據最新月份，回傳當季與前季的起始月 / 年資訊
function quarterRange(year: number, month: number): {
  curYear: number; curStart: number;
  prevYear: number; prevStart: number;
} {
  const q = Math.ceil(month / 3);
  const curStart = (q - 1) * 3 + 1;
  const prevQ = q - 1;
  if (prevQ === 0) return { curYear: year, curStart, prevYear: year - 1, prevStart: 10 };
  return { curYear: year, curStart, prevYear: year, prevStart: (prevQ - 1) * 3 + 1 };
}

function getChangeArrow(current: number | null, prev: number | null): '↑' | '↓' | '→' {
  if (current === null || prev === null) return '→';
  if (Math.abs(prev) < 0.0001) return current > 0 ? '↑' : current < 0 ? '↓' : '→';
  const diff = (current - prev) / Math.abs(prev);
  if (Math.abs(diff) < 0.01) return '→';
  return current > prev ? '↑' : '↓';
}

function buildRows(allData: Record<string, IndicatorData[]>): TableRow[] {
  const codeMap = new Map<string, { name: string; category: string; direction: string; campusesWithData: Set<string> }>();

  ALL_CAMPUSES.forEach(campus => {
    (allData[campus] || []).forEach(ind => {
      if (!codeMap.has(ind.meta.code)) {
        codeMap.set(ind.meta.code, {
          name: ind.meta.name,
          category: ind.meta.category,
          direction: ind.meta.direction,
          campusesWithData: new Set(),
        });
      }
      codeMap.get(ind.meta.code)!.campusesWithData.add(campus);
    });
  });

  const rows: TableRow[] = [];

  codeMap.forEach((info, code) => {
    const isSingleCampus = info.campusesWithData.size === 1;
    const cells: Record<string, CampusCellData> = {};
    let hasAnomaly = false;

    ALL_CAMPUSES.forEach(campus => {
      const ind = (allData[campus] || []).find(i => i.meta.code === code);
      if (!ind) {
        cells[campus] = { exists: false, value: null, status: 'neutral', prevValue: null, changeArrow: '→' };
        return;
      }

      const parsed = parseLatestMonth(ind.latestMonth);
      let curValue: number | null = ind.latestValue;
      let prevValue: number | null = null;
      if (parsed) {
        const { curYear, curStart, prevYear, prevStart } = quarterRange(parsed.year, parsed.month);
        // 當季只算到 latestMonth 為止（避免把未匯入月份的 0 值納入）
        curValue  = quarterAverage(ind.monthlyData, curYear,  curStart, parsed.month);
        prevValue = quarterAverage(ind.monthlyData, prevYear, prevStart);
      }

      if (isAnomalous(ind.status)) hasAnomaly = true;

      cells[campus] = {
        exists: true,
        value: curValue,
        status: ind.status,
        prevValue,
        changeArrow: getChangeArrow(curValue, prevValue),
      };
    });

    if (hasAnomaly || isSingleCampus) {
      rows.push({ code, name: info.name, category: info.category, direction: info.direction, isSingleCampus, cells, hasAnomaly });
    }
  });

  rows.sort((a, b) => a.code.localeCompare(b.code));

  return rows;
}

function formatValue(value: number | null): string {
  if (value === null) return '—';
  return value % 1 === 0 ? String(value) : value.toFixed(2);
}

function formatChangePct(current: number | null, prev: number | null): string {
  if (current === null || prev === null) return '';
  if (Math.abs(prev) < 0.0001) {
    // 前季為 0，改顯示絕對變化量
    const delta = current - prev;
    return delta > 0 ? `+${formatValue(delta)}` : formatValue(delta);
  }
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  const absPct = Math.abs(pct);
  const sign = pct > 0 ? '+' : '−';
  if (absPct >= 100) return `${sign}${Math.round(absPct)}%`;
  if (absPct < 0.1) return '<0.1%';
  return `${sign}${absPct.toFixed(1)}%`;
}

interface Props {
  allData: Record<string, IndicatorData[]>;
  quarterLabel: string;
  prevQuarterLabel: string;
}

export function CrossCampusTable({ allData, quarterLabel, prevQuarterLabel }: Props) {
  const router = useRouter();
  const setPeriodMode = useDashboardStore(s => s.setPeriodMode);
  const setCampus = useDashboardStore(s => s.setCampus);
  const rows = buildRows(allData);

  function handleIndicatorClick(code: string, campus?: Campus) {
    if (campus) setCampus(campus);
    setPeriodMode('quarterly');
    router.push(`/indicators/${code}`);
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-sm">目前無異常指標</p>
        <p className="text-xs mt-1">所有院區指標均在正常範圍內</p>
      </div>
    );
  }

  return (
    <div>
      {/* 季度對比標題 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="text-sm text-gray-500">
          <span className="text-gray-400">{prevQuarterLabel}</span>
          <span className="mx-2 text-gray-300">→</span>
          <span className="font-semibold text-gray-700">{quarterLabel}</span>
        </div>
        <span className="ml-auto text-xs text-gray-400">共 {rows.length} 項指標</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">類別</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">指標名稱</th>
              {ALL_CAMPUSES.map(campus => (
                <th key={campus} className="text-center px-3 py-3 font-medium text-gray-600 w-40">{campus}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr key={row.code} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-xs text-gray-500 align-top pt-4">{row.category}</td>
                <td className="px-4 py-3 align-top pt-4">
                  <button
                    onClick={() => handleIndicatorClick(row.code)}
                    className="font-medium text-gray-800 hover:text-blue-600 hover:underline text-left"
                  >
                    {row.name}
                  </button>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-gray-400">{row.code}</span>
                    {row.isSingleCampus && (
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded text-xs">
                        院區特色
                      </span>
                    )}
                  </div>
                </td>
                {ALL_CAMPUSES.map(campus => {
                  const cell = row.cells[campus];
                  if (!cell?.exists) {
                    return (
                      <td key={campus} className="px-3 py-3 text-center align-top pt-4">
                        <span className="text-gray-300 text-xs">—</span>
                      </td>
                    );
                  }

                  const favorable = isFavorableChange(cell.changeArrow, row.direction);
                  const arrowStyle =
                    favorable === true  ? 'bg-green-500 text-white' :
                    favorable === false ? 'bg-red-500 text-white' :
                                          'bg-gray-200 text-gray-500';

                  return (
                    <td key={campus} className="px-3 py-3 align-top">
                      <div className="flex flex-col items-center gap-1.5">
                        {/* 燈號（可點擊） */}
                        <button
                          onClick={() => handleIndicatorClick(row.code, campus)}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 hover:shadow-sm transition-opacity ${STATUS_STYLE[cell.status]}`}
                        >
                          {STATUS_LABEL[cell.status]}
                        </button>
                        {/* 當季值 */}
                        <span className="text-sm font-mono font-medium text-gray-800">
                          {formatValue(cell.value)}
                        </span>
                        {/* 變化箭頭 pill */}
                        {cell.changeArrow !== '→' && cell.prevValue !== null ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${arrowStyle}`}>
                            {cell.changeArrow} {formatChangePct(cell.value, cell.prevValue)}
                          </span>
                        ) : cell.prevValue !== null ? (
                          <span className="text-xs text-gray-400">前季 {formatValue(cell.prevValue)}</span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        綠底 = 有利變化　紅底 = 不利變化　百分比為與前季相比的變化幅度
      </p>
    </div>
  );
}
