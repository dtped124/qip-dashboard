import { IndicatorStatus, IndicatorData } from './types';
import { analyzeIndicator } from './engine/anomalyDetector';

/**
 * 向下相容的狀態計算函數
 * 當有完整月資料時使用三重偵測引擎；否則退回簡單標竿比較
 */
export function calculateStatus(
  value: number | null,
  benchmark: number | null,
  isReverse: boolean
): IndicatorStatus {
  if (value === null || benchmark === null) return 'neutral';
  if (benchmark === 0) return value === 0 ? 'good' : 'alert';

  if (!isReverse) {
    if (value <= benchmark * 0.7) return 'good';
    if (value <= benchmark) return 'good';
    if (value <= benchmark * 1.3) return 'warning';
    return 'alert';
  }

  if (value >= benchmark * 1.3) return 'good';
  if (value >= benchmark) return 'good';
  if (value >= benchmark * 0.7) return 'warning';
  return 'alert';
}

/**
 * 使用三重異常偵測引擎套用狀態到所有指標
 */
export function applyStatus(indicators: IndicatorData[]): IndicatorData[] {
  return indicators.map(ind => {
    const peerValue = ind.peerValue ?? ind.benchmarkValue;
    const direction = ind.meta.direction;
    const dataNature = ind.meta.dataNature ?? 'continuous';
    const skipControlChart = false;

    const result = analyzeIndicator(
      ind.monthlyData,
      peerValue,
      direction,
      dataNature,
      skipControlChart,
    );

    return {
      ...ind,
      status: result.status,
      anomalies: result.anomalies,
      controlChart: result.controlChart,
    };
  });
}
