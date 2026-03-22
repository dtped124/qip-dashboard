import type { MonthlyDataPoint, AnomalyResult, Direction } from '../types';

/** 月增減幅度變化率門檻 */
const CHANGE_THRESHOLD = 0.10; // 10%

/**
 * 偵測月增減幅度異常
 * 計算最新兩個有效數據點的變化率，判斷是否 ≥ 10%
 */
export function detectMonthlyChanges(
  dataPoints: MonthlyDataPoint[],
  direction: Direction
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];

  // 需要找到相鄰的有效數據點對
  const validPoints = dataPoints.filter(dp => dp.value !== null && dp.value !== undefined);

  if (validPoints.length < 2) return anomalies;

  // 檢查最後幾對相鄰數據點
  for (let i = 1; i < validPoints.length; i++) {
    const prev = validPoints[i - 1];
    const curr = validPoints[i];
    const prevValue = prev.value as number;
    const currValue = curr.value as number;

    // 上月值為 0 時不計算變化率
    if (prevValue === 0) continue;

    const changeRate = (currValue - prevValue) / Math.abs(prevValue);
    const absChange = Math.abs(changeRate);

    if (absChange < CHANGE_THRESHOLD) continue;

    const isIncrease = changeRate > 0;
    const changePercent = (changeRate * 100).toFixed(1);

    if (direction === 'lower') {
      // 越低越好：增加為不利，減少為改善
      anomalies.push({
        mechanism: 'monthly_change',
        severity: isIncrease ? 'watch' : 'excellent',
        direction: isIncrease ? 'unfavorable' : 'favorable',
        message: isIncrease
          ? `較上月增加 ${changePercent}%（不利方向）`
          : `較上月減少 ${Math.abs(parseFloat(changePercent))}%（改善趨勢）`,
        value: currValue,
        referenceValue: prevValue,
        year: curr.year,
        month: curr.month,
      });
    } else if (direction === 'higher') {
      // 越高越好：增加為改善，減少為不利
      anomalies.push({
        mechanism: 'monthly_change',
        severity: isIncrease ? 'excellent' : 'watch',
        direction: isIncrease ? 'favorable' : 'unfavorable',
        message: isIncrease
          ? `較上月增加 ${changePercent}%（改善趨勢）`
          : `較上月減少 ${Math.abs(parseFloat(changePercent))}%（不利方向）`,
        value: currValue,
        referenceValue: prevValue,
        year: curr.year,
        month: curr.month,
      });
    } else {
      // monitor：大幅波動均為關注
      anomalies.push({
        mechanism: 'monthly_change',
        severity: 'watch',
        direction: 'unfavorable',
        message: `較上月${isIncrease ? '增加' : '減少'} ${Math.abs(parseFloat(changePercent))}%（大幅波動）`,
        value: currValue,
        referenceValue: prevValue,
        year: curr.year,
        month: curr.month,
      });
    }
  }

  return anomalies;
}

/**
 * 僅偵測最新一個月的變化（用於狀態矩陣中單月查詢）
 */
export function detectSingleMonthChange(
  currentValue: number,
  previousValue: number | null,
  direction: Direction
): AnomalyResult | null {
  if (previousValue === null || previousValue === 0) return null;

  const changeRate = (currentValue - previousValue) / Math.abs(previousValue);
  const absChange = Math.abs(changeRate);

  if (absChange < CHANGE_THRESHOLD) return null;

  const isIncrease = changeRate > 0;
  const changePercent = (changeRate * 100).toFixed(1);

  if (direction === 'lower') {
    return {
      mechanism: 'monthly_change',
      severity: isIncrease ? 'watch' : 'excellent',
      direction: isIncrease ? 'unfavorable' : 'favorable',
      message: isIncrease
        ? `月增 ${changePercent}%`
        : `月減 ${Math.abs(parseFloat(changePercent))}%`,
      value: currentValue,
      referenceValue: previousValue,
    };
  } else if (direction === 'higher') {
    return {
      mechanism: 'monthly_change',
      severity: isIncrease ? 'excellent' : 'watch',
      direction: isIncrease ? 'favorable' : 'unfavorable',
      message: isIncrease
        ? `月增 ${changePercent}%`
        : `月減 ${Math.abs(parseFloat(changePercent))}%`,
      value: currentValue,
      referenceValue: previousValue,
    };
  } else {
    return {
      mechanism: 'monthly_change',
      severity: 'watch',
      direction: 'unfavorable',
      message: `月${isIncrease ? '增' : '減'} ${Math.abs(parseFloat(changePercent))}%`,
      value: currentValue,
      referenceValue: previousValue,
    };
  }
}
