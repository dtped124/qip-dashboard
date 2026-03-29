/**
 * 月資料 → 季資料彙總工具
 *
 * 將月度資料點彙總為季度資料點（Q1-Q4）。
 * - binomial_rate / poisson_rate：加總分子分母後重算比率
 * - continuous：取非 null 值的平均
 */
import type { MonthlyDataPoint, DataNature, IndicatorUnit } from './types';

/** 季度起始月份 [1, 4, 7, 10] 對應 Q1-Q4 */
const QUARTER_START_MONTH = [1, 4, 7, 10] as const;

/**
 * 將月度資料彙總為季度資料。
 * 輸出的 month 使用 1/4/7/10，與現有 isQuarterly 顯示邏輯一致。
 */
export function aggregateToQuarterly(
  monthlyData: MonthlyDataPoint[],
  dataNature: DataNature,
  unit: IndicatorUnit = 'percent',
): MonthlyDataPoint[] {
  // Group by (year, quarter)
  const groups = new Map<string, MonthlyDataPoint[]>();

  for (const dp of monthlyData) {
    if (dp.value === null && dp.numerator == null) continue;
    const quarter = Math.ceil(dp.month / 3); // 1-4
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
      // continuous: average non-null values
      const validValues = points.filter(p => p.value !== null).map(p => p.value!);
      const value = validValues.length > 0
        ? validValues.reduce((s, v) => s + v, 0) / validValues.length
        : null;
      result.push({ year, month, value });
    }
  }

  // Sort by year, then month
  result.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  return result;
}
