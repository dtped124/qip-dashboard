/**
 * 月資料 → 季資料彙總工具
 *
 * 將月度資料點彙總為季度資料點（Q1-Q4）。
 * - binomial_rate / poisson_rate：加總分子分母後重算比率
 * - continuous：取非 null 值的平均
 *
 * ⚠️ 「完整季原則」：只有當 latest month 已抵達某季末月（3/6/9/12）時，
 *    該季才會被輸出。例如最新月份是 4 月，Q2 只有 1 個月資料 →
 *    aggregateToQuarterly 不會輸出 Q2，當期最新季為去年 Q4 之後到 Q1。
 */
import type { MonthlyDataPoint, DataNature, IndicatorUnit } from './types';

/** 季度起始月份 [1, 4, 7, 10] 對應 Q1-Q4 */
const QUARTER_START_MONTH = [1, 4, 7, 10] as const;

/**
 * 找出最近一個「資料齊備」的季 — 該季末月（3/6/9/12）必須 ≤ 給定的 (year, month)。
 *
 * 範例：
 *   lastCompleteQuarter(2025, 4) → Q1 2025（4 月只是 Q2 第一個月，不算齊）
 *   lastCompleteQuarter(2025, 3) → Q1 2025（3 月為 Q1 末月，剛好齊）
 *   lastCompleteQuarter(2025, 2) → Q4 2024
 *   lastCompleteQuarter(2025, 1) → Q4 2024
 */
export function lastCompleteQuarter(year: number, month: number): {
  year: number; quarter: number; startMonth: number; endMonth: number;
} {
  const q = Math.floor(month / 3); // 0 if month∈{1,2}; 1 if month∈{3,4,5}; 2 if month∈{6,7,8}; ...
  if (q === 0) {
    return { year: year - 1, quarter: 4, startMonth: 10, endMonth: 12 };
  }
  return { year, quarter: q, startMonth: (q - 1) * 3 + 1, endMonth: q * 3 };
}

/**
 * 給定當季起始資訊，回傳「上一季」的起始資訊（用於季比較）。
 */
export function previousQuarter(year: number, quarter: number): {
  year: number; quarter: number; startMonth: number; endMonth: number;
} {
  if (quarter === 1) return { year: year - 1, quarter: 4, startMonth: 10, endMonth: 12 };
  return { year, quarter: quarter - 1, startMonth: (quarter - 2) * 3 + 1, endMonth: (quarter - 1) * 3 };
}

/**
 * 取得「最近完整季」的代表值與標籤 — 給卡片/表格在季模式下顯示。
 * 邏輯：用 aggregateToQuarterly 聚合後取最後一筆（已過濾掉不完整季）。
 */
export function latestQuarterlyValue(
  monthlyData: MonthlyDataPoint[],
  dataNature: DataNature,
  unit: IndicatorUnit = 'percent',
): { value: number | null; year: number; quarter: number; label: string } | null {
  const quarterly = aggregateToQuarterly(monthlyData, dataNature, unit);
  if (quarterly.length === 0) return null;
  const last = quarterly[quarterly.length - 1];
  const quarter = Math.ceil(last.month / 3);
  return {
    value: last.value,
    year: last.year,
    quarter,
    label: `${last.year}.Q${quarter}`,
  };
}

/**
 * 將月度資料彙總為季度資料。
 * 輸出的 month 使用 1/4/7/10，與現有 isQuarterly 顯示邏輯一致。
 */
export function aggregateToQuarterly(
  monthlyData: MonthlyDataPoint[],
  dataNature: DataNature,
  unit: IndicatorUnit = 'percent',
): MonthlyDataPoint[] {
  // 找出整批資料中「最新月份」 — 用此計算「最近完整季」末月，之後的季捨棄
  let latestYear = -1;
  let latestMonth = 0;
  for (const dp of monthlyData) {
    if (dp.year > latestYear || (dp.year === latestYear && dp.month > latestMonth)) {
      latestYear = dp.year;
      latestMonth = dp.month;
    }
  }
  // 用 year*100 + month 作為比較 key（month 1-12 不會跨 100 borrow）
  const completeEndKey = latestYear > 0
    ? (() => {
        const lcq = lastCompleteQuarter(latestYear, latestMonth);
        return lcq.year * 100 + lcq.endMonth;
      })()
    : Infinity;

  // Group by (year, quarter)
  const groups = new Map<string, MonthlyDataPoint[]>();

  for (const dp of monthlyData) {
    if (dp.value === null && dp.numerator == null) continue;
    const quarter = Math.ceil(dp.month / 3); // 1-4
    const quarterEndKey = dp.year * 100 + quarter * 3;
    if (quarterEndKey > completeEndKey) continue; // ❌ 該季不完整，捨棄
    const key = `${dp.year}_${quarter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(dp);
  }

  const result: MonthlyDataPoint[] = [];

  for (const [key, points] of Array.from(groups.entries())) {
    const [yearStr, quarterStr] = key.split('_');
    const year = parseInt(yearStr);
    const quarter = parseInt(quarterStr);
    const month = QUARTER_START_MONTH[quarter - 1];

    if (dataNature === 'binomial_rate' || dataNature === 'poisson_rate') {
      // Check if we have numerator/denominator data
      const withND = points.filter(
        p => p.numerator != null && p.denominator != null && p.denominator > 0,
      );

      if (withND.length > 0) {
        const totalNum = withND.reduce((s, p) => s + (p.numerator ?? 0), 0);
        const totalDen = withND.reduce((s, p) => s + (p.denominator ?? 0), 0);

        // Compute value based on unit (percent → ×100, permille → ×1000)
        const multiplier = unit === 'permille' ? 1000 : 100;
        const value = totalDen > 0 ? (totalNum / totalDen) * multiplier : null;

        result.push({ year, month, value, numerator: totalNum, denominator: totalDen });
      } else {
        // Fallback: average the values
        const validValues = points.filter(p => p.value !== null).map(p => p.value!);
        const value = validValues.length > 0
          ? validValues.reduce((s, v) => s + v, 0) / validValues.length
          : null;
        result.push({ year, month, value });
      }
    } else {
      // continuous:
      // - count 單位（事件數）→ 加總三個月
      // - 其他（ratio、平均數）→ 取月平均
      const validValues = points.filter(p => p.value !== null).map(p => p.value!);
      const value = validValues.length > 0
        ? unit === 'count'
          ? validValues.reduce((s, v) => s + v, 0)
          : validValues.reduce((s, v) => s + v, 0) / validValues.length
        : null;
      result.push({ year, month, value });
    }
  }

  // Sort by year, then month
  result.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  return result;
}
