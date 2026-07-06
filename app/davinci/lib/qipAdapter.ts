/**
 * 達文西 → QIP 展示元件 資料轉接層
 *
 * QIP 詳情頁元件（ControlChart / YearOverlayChart / YearCompareBar /
 * DataTable / ExportSlideButton / AIAnalysisPanel）皆為純 props 展示元件，
 * 透過本轉接層把達文西 series 轉成 QIP 型別後「直接 import 複用、零修改」——
 * 視覺與 QIP 完全一致，且 PPTX 匯出 / AI 分析能力直接繼承（隔離原則 0.3）。
 *
 * 期別對應：達文西西元 yyyymm → QIP 民國 year/month；
 * 季模式沿用 QIP 季指標慣例（月份 1/4/7/10 = Q1–Q4）。
 */

import type {
  AnomalyResult,
  Campus,
  ControlChartParams,
  IndicatorMeta,
  IndicatorStatus,
  MonthlyDataPoint,
  YearlySummary,
} from '@/lib/types';
import type { DavinciSeries, DavinciSeriesPoint } from './types';

const QUARTER_TO_MONTH = [1, 4, 7, 10];

/** 期別 key → 民國 (year, month)。季 '2026Q2' → (115, 4)（QIP 季指標月份慣例） */
function periodToRoc(period: number | string): { year: number; month: number } {
  const s = String(period);
  if (s.includes('Q')) {
    const [y, q] = s.split('Q');
    return { year: parseInt(y) - 1911, month: QUARTER_TO_MONTH[parseInt(q) - 1] };
  }
  const n = parseInt(s);
  return { year: Math.floor(n / 100) - 1911, month: n % 100 };
}

export function toMonthlyDataPoints(points: DavinciSeriesPoint[]): MonthlyDataPoint[] {
  return points.map(p => {
    const { year, month } = periodToRoc(p.period);
    return {
      year,
      month,
      value: p.value,
      numerator: p.numerator ?? undefined,
      denominator: p.denominator ?? undefined,
    };
  });
}

export function toControlChartParams(series: DavinciSeries): ControlChartParams | null {
  const { spc } = series;
  if (!spc.has_chart || spc.cl === null) return null;
  const variableLimits = spc.p_limits.map(pl => {
    const { year, month } = periodToRoc(pl.period);
    return {
      year, month,
      ucl: pl.ucl, lcl: pl.lcl, ucl2: pl.ucl2, lcl2: pl.lcl2,
      sampleSize: pl.n,
    };
  });
  // 雙層策略：P 變動限存在時以 P Chart 呈現（p̄ 為 CL），否則 I-MR 固定限
  const useP = series.kind === 'rate' && variableLimits.length > 0 && spc.p_cl !== null;
  return {
    chartType: useP ? 'P' : 'I-MR',
    cl: useP ? spc.p_cl! : spc.cl,
    ucl: spc.ucl ?? 0,
    lcl: spc.lcl ?? 0,
    sigma: spc.sigma ?? 0,
    ucl2: spc.ucl2 ?? 0,
    lcl2: spc.lcl2 ?? 0,
    n: spc.baseline_n,
    variableLimits: variableLimits.length > 0 ? variableLimits : undefined,
  };
}

export function toAnomalies(series: DavinciSeries): AnomalyResult[] {
  return series.spc.signals.map(s => {
    const { year, month } = periodToRoc(s.period);
    return {
      mechanism: 'control_chart' as const,
      rule: s.rule,
      severity: s.severity as IndicatorStatus,
      direction: s.side === 'high' ? 'unfavorable' as const : 'favorable' as const,
      message: s.message,
      value: s.value ?? 0,
      year,
      month,
    };
  });
}

/** 年度平均（分母加權，與 QIP 年均值原則一致；達文西無標竿 → null） */
export function toYearlySummaries(points: DavinciSeriesPoint[]): YearlySummary[] {
  const byYear = new Map<number, { num: number; den: number; wsum: number; wden: number }>();
  for (const p of points) {
    if (p.value === null) continue;
    const { year } = periodToRoc(p.period);
    const acc = byYear.get(year) ?? { num: 0, den: 0, wsum: 0, wden: 0 };
    if (p.numerator !== null && p.denominator) {
      acc.num += p.numerator;
      acc.den += p.denominator;
    } else if (p.denominator) {
      acc.wsum += p.value * p.denominator;
      acc.wden += p.denominator;
    } else {
      acc.wsum += p.value;
      acc.wden += 1;
    }
    byYear.set(year, acc);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, acc]) => ({
      year,
      average: acc.den > 0
        ? Math.round((acc.num / acc.den) * 10000) / 100
        : acc.wden > 0 ? Math.round((acc.wsum / acc.wden) * 100) / 100 : null,
      benchmarkRegional: null,
      benchmarkDistrict: null,
    }));
}

/** 達文西 meta → QIP IndicatorMeta（供 ExportSlideButton / AIAnalysisPanel） */
export function toQipMeta(series: DavinciSeries): IndicatorMeta {
  return {
    code: series.code,
    name: series.name,
    // 達文西面向不在 QIP Category union 內；僅作顯示/prompt 字串用
    category: '達文西手術品質' as IndicatorMeta['category'],
    // DV02/DV03（分/ml）以 ratio 呈現數值（兩位小數），單位標籤由頁面自持
    unit: series.kind === 'rate' ? 'percent' : 'ratio',
    isQuarterly: false,
    direction: 'lower',
    campuses: ['竹北', '新竹'] as Campus[],
    source: 'custom',
    aliases: [],
    formula: series.kind === 'rate'
      ? '事件人次 ÷ 機械手臂手術總人次 × 100%'
      : '該期各台手術之平均值',
    isActive: true,
    dataNature: series.kind === 'rate' ? 'binomial_rate' : 'continuous',
    isReverse: true,
  };
}
