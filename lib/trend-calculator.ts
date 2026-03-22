import { TrendDirection, MonthlyDataPoint, IndicatorData } from './types';

/**
 * 使用最近 N 個有值的月份做線性回歸，判定趨勢方向
 */
export function calculateTrend(monthlyData: MonthlyDataPoint[], n: number = 6): TrendDirection {
  // 取最近 n 個有值的點
  const sorted = [...monthlyData]
    .sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

  const validPoints: { x: number; y: number }[] = [];
  for (const p of sorted) {
    if (p.value !== null) {
      // x = 序號（越大越新）
      validPoints.push({ x: p.year * 12 + p.month, y: p.value });
      if (validPoints.length >= n) break;
    }
  }

  if (validPoints.length < 3) return 'flat';

  // 線性回歸求斜率
  const xs = validPoints.map(p => p.x);
  const ys = validPoints.map(p => p.y);
  const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i++) {
    numerator += (xs[i] - avgX) * (ys[i] - avgY);
    denominator += (xs[i] - avgX) * (xs[i] - avgX);
  }

  if (denominator === 0) return 'flat';

  const slope = numerator / denominator;

  // 閾值：相對於平均值的比例
  const threshold = Math.abs(avgY) * 0.05 || 0.01;

  if (slope > threshold) return 'up';
  if (slope < -threshold) return 'down';
  return 'flat';
}

export function applyTrends(indicators: IndicatorData[]): IndicatorData[] {
  return indicators.map(ind => ({
    ...ind,
    trend: calculateTrend(ind.monthlyData),
  }));
}
