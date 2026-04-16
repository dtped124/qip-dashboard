import type {
  MonthlyDataPoint,
  ControlChartParams,
  AnomalyResult,
  IndicatorStatus,
  Direction,
  DataNature,
} from '../types';
import { selectChartType, computeControlChartParams, detectControlChartAnomalies } from './controlChart';
import { detectMonthlyChanges } from './monthlyChange';
import { detectPeerDeviation } from './peerComparison';

export interface AnalysisResult {
  status: IndicatorStatus;
  anomalies: AnomalyResult[];
  controlChart: ControlChartParams | null;
}

/**
 * 三重異常偵測引擎 — 整合管制圖、月增減、同儕比較
 * @param skipControlChart 若為 true，跳過管制圖計算與異常偵測（如經營管理類指標）
 */
export function analyzeIndicator(
  monthlyData: MonthlyDataPoint[],
  peerValue: number | null,
  direction: Direction,
  dataNature: DataNature = 'continuous',
  skipControlChart: boolean = false,
): AnalysisResult {
  const anomalies: AnomalyResult[] = [];

  // 排序數據點（按年月遞增）
  const sorted = [...monthlyData]
    .filter(dp => dp.value !== null)
    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

  if (sorted.length === 0) {
    return { status: 'neutral', anomalies: [], controlChart: null };
  }

  // 機制一：管制圖（用最近 24 個月計算管制限，全部數據做異常偵測）
  let controlChart: ControlChartParams | null = null;
  if (!skipControlChart) {
    const recent24 = sorted.slice(-24);
    const chartType = selectChartType(recent24, dataNature);
    controlChart = computeControlChartParams(recent24, chartType);
    if (controlChart) {
      const ccAnomalies = detectControlChartAnomalies(sorted, controlChart, direction);
      anomalies.push(...ccAnomalies);
    }
  }

  // 機制二：月增減幅度
  const monthlyAnomalies = detectMonthlyChanges(sorted, direction);
  anomalies.push(...monthlyAnomalies);

  // 機制三：同儕值比較（對最新數據點）
  const latest = sorted[sorted.length - 1];
  if (latest.value !== null && peerValue !== null) {
    const peerAnomaly = detectPeerDeviation(
      latest.value,
      peerValue,
      direction,
      latest.year,
      latest.month
    );
    if (peerAnomaly) {
      anomalies.push(peerAnomaly);
    }
  }

  // 綜合判定
  const status = resolveStatus(anomalies, latest);

  return { status, anomalies, controlChart };
}

/**
 * 綜合判定等級
 *
 * 優先級：
 * 🔴 Alert    — 管制圖 Rule 1（3σ 超限）
 * 🟠 Warning  — 管制圖 Rule 2-5，或 月增減不利 + 同儕比較也不利
 * 🟡 Watch    — 僅月增減不利 或 僅同儕比較不利
 * 🟢 Good     — 無任何異常
 * 🔵 Excellent — 改善方向且優於同儕
 */
function resolveStatus(
  anomalies: AnomalyResult[],
  latest: MonthlyDataPoint | undefined
): IndicatorStatus {
  if (!latest || latest.value === null) return 'neutral';

  // 只看最新月份相關的異常
  const allRelevant = anomalies.filter(a =>
    (a.year === undefined && a.month === undefined) ||
    (a.year === latest.year && a.month === latest.month)
  );

  const unfavorable = allRelevant.filter(a => a.direction === 'unfavorable');
  const favorable = allRelevant.filter(a => a.direction === 'favorable');

  // 檢查最嚴重的不利異常
  const hasAlert = unfavorable.some(a => a.severity === 'alert');
  const hasWarning = unfavorable.some(a => a.severity === 'warning');
  const hasWatch = unfavorable.some(a => a.severity === 'watch');

  // 多重不利因素加重
  const unfavorableMechanisms = new Set(unfavorable.map(a => a.mechanism));
  const multipleUnfavorable = unfavorableMechanisms.size >= 2;

  if (hasAlert) return 'alert';
  if (hasWarning) return 'warning';
  if (multipleUnfavorable && hasWatch) return 'warning'; // 兩種以上 watch 升級為 warning
  if (hasWatch) return 'watch';

  // 無不利異常，檢查是否卓越
  const hasExcellent = favorable.some(a => a.severity === 'excellent');
  const favorableMechanisms = new Set(favorable.map(a => a.mechanism));
  if (hasExcellent && favorableMechanisms.size >= 2) return 'excellent';

  return 'good';
}

/**
 * 計算特定月份的狀態（用於狀態矩陣）
 */
export function computeMonthStatus(
  allData: MonthlyDataPoint[],
  targetYear: number,
  targetMonth: number,
  peerValue: number | null,
  direction: Direction,
  controlChart: ControlChartParams | null
): IndicatorStatus {
  const sorted = [...allData]
    .filter(dp => dp.value !== null)
    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

  const targetPoint = sorted.find(dp => dp.year === targetYear && dp.month === targetMonth);
  if (!targetPoint || targetPoint.value === null) return 'neutral';

  const anomalies: AnomalyResult[] = [];

  // 管制圖規則（對這個特定點）
  if (controlChart) {
    const hasSigma = controlChart.sigma > 0;
    const hasVarLimits = controlChart.variableLimits && controlChart.variableLimits.length > 0;

    if (hasSigma || hasVarLimits) {
      const value = targetPoint.value;

      // 取此點的管制限
      const vl = controlChart.variableLimits?.find(
        l => l.year === targetYear && l.month === targetMonth
      );
      const ucl = vl?.ucl ?? controlChart.ucl;
      const lcl = vl?.lcl ?? controlChart.lcl;
      const ucl2 = vl?.ucl2 ?? controlChart.ucl2;
      const lcl2 = vl?.lcl2 ?? controlChart.lcl2;

      // Rule 1
      if (value > ucl && (direction === 'lower' || direction === 'monitor')) {
        anomalies.push({ mechanism: 'control_chart', rule: 'rule1', severity: 'alert', direction: 'unfavorable', message: '超出 3σ 管制上限 (失控)', value, referenceValue: ucl, year: targetYear, month: targetMonth });
      }
      if (value < lcl && lcl > 0 && (direction === 'higher' || direction === 'monitor')) {
        anomalies.push({ mechanism: 'control_chart', rule: 'rule1', severity: 'alert', direction: 'unfavorable', message: '低於 3σ 管制下限 (失控)', value, referenceValue: lcl, year: targetYear, month: targetMonth });
      }

      // Rule 2
      if (value > ucl2 && value <= ucl && (direction === 'lower' || direction === 'monitor')) {
        anomalies.push({ mechanism: 'control_chart', rule: 'rule2', severity: 'warning', direction: 'unfavorable', message: '超出 2σ 警戒線', value, referenceValue: ucl2, year: targetYear, month: targetMonth });
      }
      if (value < lcl2 && value >= lcl && lcl2 > 0 && (direction === 'higher' || direction === 'monitor')) {
        anomalies.push({ mechanism: 'control_chart', rule: 'rule2', severity: 'warning', direction: 'unfavorable', message: '低於 2σ 警戒線', value, referenceValue: lcl2, year: targetYear, month: targetMonth });
      }

      // Favorable checks
      if (value > ucl && direction === 'higher') {
        anomalies.push({ mechanism: 'control_chart', severity: 'excellent', direction: 'favorable', message: '顯著高於 3σ 管制上限', value, referenceValue: ucl, year: targetYear, month: targetMonth });
      }
      if (value < lcl && lcl > 0 && direction === 'lower') {
        anomalies.push({ mechanism: 'control_chart', severity: 'excellent', direction: 'favorable', message: '顯著低於 3σ 管制下限', value, referenceValue: lcl, year: targetYear, month: targetMonth });
      }
    }
  }

  // 月增減
  const targetIdx = sorted.findIndex(dp => dp.year === targetYear && dp.month === targetMonth);
  if (targetIdx > 0) {
    const prev = sorted[targetIdx - 1];
    if (prev.value !== null && prev.value !== 0) {
      const changeRate = (targetPoint.value - prev.value) / Math.abs(prev.value);
      if (Math.abs(changeRate) >= 0.10) {
        const isIncrease = changeRate > 0;
        let dir: 'unfavorable' | 'favorable' = 'unfavorable';
        if (direction === 'lower') dir = isIncrease ? 'unfavorable' : 'favorable';
        else if (direction === 'higher') dir = isIncrease ? 'favorable' : 'unfavorable';

        anomalies.push({
          mechanism: 'monthly_change',
          severity: dir === 'unfavorable' ? 'watch' : 'excellent',
          direction: dir,
          message: `月增減 ${(changeRate * 100).toFixed(1)}%`,
          value: targetPoint.value,
          referenceValue: prev.value,
          year: targetYear,
          month: targetMonth,
        });
      }
    }
  }

  // 同儕比較
  if (peerValue !== null) {
    const peerAnomaly = detectPeerDeviation(
      targetPoint.value,
      peerValue,
      direction,
      targetYear,
      targetMonth
    );
    if (peerAnomaly) anomalies.push(peerAnomaly);
  }

  // 判定
  const unfavorable = anomalies.filter(a => a.direction === 'unfavorable');
  const favorable = anomalies.filter(a => a.direction === 'favorable');

  if (unfavorable.some(a => a.severity === 'alert')) return 'alert';
  if (unfavorable.some(a => a.severity === 'warning')) return 'warning';
  const mechCount = new Set(unfavorable.map(a => a.mechanism)).size;
  if (mechCount >= 2) return 'warning';
  if (unfavorable.some(a => a.severity === 'watch')) return 'watch';
  if (favorable.length >= 2) return 'excellent';
  return 'good';
}
