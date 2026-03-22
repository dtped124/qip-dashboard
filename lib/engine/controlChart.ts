import type { MonthlyDataPoint, ControlChartParams, AnomalyResult, Direction, VariableLimit, ChartType, DataNature } from '../types';

/** 最低數據點需求 */
const MIN_DATA_POINTS = 6;

/** d2 constant for subgroup size n=2 (Moving Range) */
const D2 = 1.128;

// ============================================================
//  Chart Type Selection
// ============================================================

/**
 * 根據資料性質和分子分母可用性，智慧選擇管制圖類型
 * 含稀有事件檢查（§4.11.4）：
 *   - 二項比率：p̄ × n̄ < 5 → P Chart 失效 → 退回 I-MR
 *   - Poisson 密度：月平均事件數 < 1 → U Chart 不穩定 → 退回 I-MR
 */
export function selectChartType(
  dataPoints: MonthlyDataPoint[],
  dataNature: DataNature,
): ChartType {
  if (dataNature === 'continuous') return 'I-MR';

  const validPoints = dataPoints.filter(dp => dp.value !== null);

  // 檢查有多少數據點包含分子/分母
  const withND = dataPoints.filter(
    dp => dp.value !== null && dp.numerator !== undefined && dp.denominator !== undefined && dp.denominator > 0
  );

  if (withND.length < MIN_DATA_POINTS) return 'I-MR'; // 不夠 → 退回 I-MR

  // n/d 覆蓋率需 ≥ 50%，否則 P/U chart 不具代表性，退回 I-MR
  const coverage = validPoints.length > 0 ? withND.length / validPoints.length : 0;
  if (coverage < 0.5) return 'I-MR';

  // 二項比率型 → 稀有事件檢查
  if (dataNature === 'binomial_rate') {
    const totalNum = withND.reduce((s, dp) => s + dp.numerator!, 0);
    const totalDen = withND.reduce((s, dp) => s + dp.denominator!, 0);
    const pBar = totalNum / totalDen;
    const avgN = totalDen / withND.length;
    // p̄ × n̄ < 5 → 二項近似常態分布失效，P Chart 不適用
    if (pBar * avgN < 5) return 'I-MR';
    return 'P';
  }

  // Poisson 密度型 → 稀有事件檢查
  if (dataNature === 'poisson_rate') {
    const avgEvents = withND.reduce((s, dp) => s + dp.numerator!, 0) / withND.length;
    // 月平均事件數 < 1 → U Chart 不穩定
    if (avgEvents < 1) return 'I-MR';
    return 'U';
  }

  return 'I-MR';
}

// ============================================================
//  I-MR Chart (Individual-Moving Range)
// ============================================================

/**
 * 計算 I-MR 管制圖參數
 * 使用 Moving Range 公式：UCL = X̄ + 2.66 × MR̄
 */
export function computeIMRChartParams(
  dataPoints: MonthlyDataPoint[]
): ControlChartParams | null {
  const values = dataPoints
    .filter(dp => dp.value !== null)
    .map(dp => dp.value as number);

  if (values.length < MIN_DATA_POINTS) return null;

  const n = values.length;
  const cl = values.reduce((a, b) => a + b, 0) / n;

  // 計算 Moving Range
  const mrs: number[] = [];
  for (let i = 1; i < values.length; i++) {
    mrs.push(Math.abs(values[i] - values[i - 1]));
  }
  const mrBar = mrs.reduce((a, b) => a + b, 0) / mrs.length;

  // σ̂ = MR̄ / d₂
  const sigma = mrBar / D2;

  // 避免 sigma 為 0（所有值相同時）
  if (sigma === 0) {
    return { chartType: 'I-MR', cl, ucl: cl, lcl: cl, sigma: 0, ucl2: cl, lcl2: cl, n };
  }

  const ucl = cl + 3 * sigma;
  const lcl = Math.max(0, cl - 3 * sigma);
  const ucl2 = cl + 2 * sigma;
  const lcl2 = Math.max(0, cl - 2 * sigma);

  return { chartType: 'I-MR', cl, ucl, lcl, sigma, ucl2, lcl2, n };
}

// ============================================================
//  P Chart (Proportion Chart for binomial data)
// ============================================================

/**
 * 計算 P Chart 管制圖參數
 * p̄ = Σd_i / Σn_i
 * UCL_i = p̄ + 3 × √(p̄(1-p̄)/n_i)  — 變動管制限
 *
 * 注意：value 是以百分比形式儲存（如 3.27 表示 3.27%），
 * 但 numerator/denominator 是原始計數，p̄ 用原始比率計算後轉為百分比
 */
export function computePChartParams(
  dataPoints: MonthlyDataPoint[]
): ControlChartParams | null {
  const withND = dataPoints.filter(
    dp => dp.value !== null && dp.numerator !== undefined && dp.denominator !== undefined && dp.denominator > 0
  );

  if (withND.length < MIN_DATA_POINTS) return null;

  // p̄ = 全體加權平均（原始比率）
  const totalNumerator = withND.reduce((s, dp) => s + dp.numerator!, 0);
  const totalDenominator = withND.reduce((s, dp) => s + dp.denominator!, 0);
  const pBar = totalNumerator / totalDenominator; // 原始比率（如 0.0327）

  // CL 以百分比顯示
  const cl = pBar * 100;

  // 計算每點的變動管制限
  const variableLimits: VariableLimit[] = withND.map(dp => {
    const ni = dp.denominator!;
    const sigma3 = 3 * Math.sqrt(pBar * (1 - pBar) / ni) * 100; // 轉百分比
    const sigma2 = 2 * Math.sqrt(pBar * (1 - pBar) / ni) * 100;

    return {
      year: dp.year,
      month: dp.month,
      ucl: cl + sigma3,
      lcl: Math.max(0, cl - sigma3),
      ucl2: cl + sigma2,
      lcl2: Math.max(0, cl - sigma2),
      sampleSize: ni,
    };
  });

  // 用平均 sample size 計算代表性的 UCL/LCL（用於 Y 軸範圍等）
  const avgN = totalDenominator / withND.length;
  const avgSigma3 = 3 * Math.sqrt(pBar * (1 - pBar) / avgN) * 100;
  const avgSigma2 = 2 * Math.sqrt(pBar * (1 - pBar) / avgN) * 100;

  return {
    chartType: 'P',
    cl,
    ucl: cl + avgSigma3,
    lcl: Math.max(0, cl - avgSigma3),
    sigma: 0,
    ucl2: cl + avgSigma2,
    lcl2: Math.max(0, cl - avgSigma2),
    n: withND.length,
    variableLimits,
  };
}

// ============================================================
//  U Chart (Rate Chart for Poisson data)
// ============================================================

/**
 * 計算 U Chart 管制圖參數
 * ū = Σc_i / Σn_i
 * UCL_i = ū + 3 × √(ū/n_i)  — 變動管制限
 *
 * 注意：value 是以千分比形式儲存（如 0.73 表示 0.73‰），
 * numerator 是事件數，denominator 是暴露量（如裝置使用日數）
 * ū 用原始率計算後轉為千分比
 */
export function computeUChartParams(
  dataPoints: MonthlyDataPoint[]
): ControlChartParams | null {
  const withND = dataPoints.filter(
    dp => dp.value !== null && dp.numerator !== undefined && dp.denominator !== undefined && dp.denominator > 0
  );

  if (withND.length < MIN_DATA_POINTS) return null;

  // ū = 全體加權平均（原始率）
  const totalNumerator = withND.reduce((s, dp) => s + dp.numerator!, 0);
  const totalDenominator = withND.reduce((s, dp) => s + dp.denominator!, 0);
  const uBar = totalNumerator / totalDenominator; // 原始率

  // CL 以千分比顯示
  const cl = uBar * 1000;

  // 計算每點的變動管制限
  const variableLimits: VariableLimit[] = withND.map(dp => {
    const ni = dp.denominator!;
    const sigma3 = 3 * Math.sqrt(uBar / ni) * 1000; // 轉千分比
    const sigma2 = 2 * Math.sqrt(uBar / ni) * 1000;

    return {
      year: dp.year,
      month: dp.month,
      ucl: cl + sigma3,
      lcl: Math.max(0, cl - sigma3),
      ucl2: cl + sigma2,
      lcl2: Math.max(0, cl - sigma2),
      sampleSize: ni,
    };
  });

  // 用平均暴露量計算代表性的 UCL/LCL
  const avgN = totalDenominator / withND.length;
  const avgSigma3 = 3 * Math.sqrt(uBar / avgN) * 1000;
  const avgSigma2 = 2 * Math.sqrt(uBar / avgN) * 1000;

  return {
    chartType: 'U',
    cl,
    ucl: cl + avgSigma3,
    lcl: Math.max(0, cl - avgSigma3),
    sigma: 0,
    ucl2: cl + avgSigma2,
    lcl2: Math.max(0, cl - avgSigma2),
    n: withND.length,
    variableLimits,
  };
}

// ============================================================
//  Unified computation entry point
// ============================================================

/**
 * 根據圖表類型計算管制圖參數
 */
export function computeControlChartParams(
  dataPoints: MonthlyDataPoint[],
  chartType: ChartType = 'I-MR'
): ControlChartParams | null {
  switch (chartType) {
    case 'P': return computePChartParams(dataPoints);
    case 'U': return computeUChartParams(dataPoints);
    case 'I-MR':
    default: return computeIMRChartParams(dataPoints);
  }
}

// ============================================================
//  Anomaly Detection (Western Electric Rules)
// ============================================================

/**
 * Western Electric Rules 異常偵測
 * 支援固定限（I-MR）和變動限（P/U Chart）
 */
export function detectControlChartAnomalies(
  dataPoints: MonthlyDataPoint[],
  params: ControlChartParams,
  direction: Direction
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];
  const validPoints = dataPoints.filter(dp => dp.value !== null);

  if (params.sigma === 0 && (!params.variableLimits || params.variableLimits.length === 0)) {
    return anomalies;
  }

  // 建立變動限查詢表
  const limitsMap = new Map<string, VariableLimit>();
  if (params.variableLimits) {
    for (const vl of params.variableLimits) {
      limitsMap.set(`${vl.year}_${vl.month}`, vl);
    }
  }

  for (let i = 0; i < validPoints.length; i++) {
    const dp = validPoints[i];
    const value = dp.value as number;

    // 取得此點的管制限（變動限優先，否則用固定限）
    const vl = limitsMap.get(`${dp.year}_${dp.month}`);
    const ucl = vl?.ucl ?? params.ucl;
    const lcl = vl?.lcl ?? params.lcl;
    const ucl2 = vl?.ucl2 ?? params.ucl2;
    const lcl2 = vl?.lcl2 ?? params.lcl2;

    // Rule 1: 單點超出 ±3σ (Critical)
    if (value > ucl) {
      if (direction === 'lower' || direction === 'monitor') {
        anomalies.push({
          mechanism: 'control_chart',
          rule: 'rule1_above_ucl',
          severity: 'alert',
          direction: 'unfavorable',
          message: `超出管制上限 (UCL=${ucl.toFixed(2)})`,
          value,
          referenceValue: ucl,
          year: dp.year,
          month: dp.month,
        });
      } else if (direction === 'higher') {
        anomalies.push({
          mechanism: 'control_chart',
          rule: 'rule1_above_ucl_favorable',
          severity: 'excellent',
          direction: 'favorable',
          message: `顯著高於管制上限，表現優異`,
          value,
          referenceValue: ucl,
          year: dp.year,
          month: dp.month,
        });
      }
    }

    if (value < lcl && lcl > 0) {
      if (direction === 'higher' || direction === 'monitor') {
        anomalies.push({
          mechanism: 'control_chart',
          rule: 'rule1_below_lcl',
          severity: 'alert',
          direction: 'unfavorable',
          message: `低於管制下限 (LCL=${lcl.toFixed(2)})`,
          value,
          referenceValue: lcl,
          year: dp.year,
          month: dp.month,
        });
      } else if (direction === 'lower') {
        anomalies.push({
          mechanism: 'control_chart',
          rule: 'rule1_below_lcl_favorable',
          severity: 'excellent',
          direction: 'favorable',
          message: `顯著低於管制下限，表現優異`,
          value,
          referenceValue: lcl,
          year: dp.year,
          month: dp.month,
        });
      }
    }

    // Rule 2: 單點超出 ±2σ (Warning)
    if (value > ucl2 && value <= ucl) {
      if (direction === 'lower' || direction === 'monitor') {
        anomalies.push({
          mechanism: 'control_chart',
          rule: 'rule2_above_2sigma',
          severity: 'warning',
          direction: 'unfavorable',
          message: `超出 2σ 警戒線`,
          value,
          referenceValue: ucl2,
          year: dp.year,
          month: dp.month,
        });
      }
    }

    if (value < lcl2 && value >= lcl && lcl2 > 0) {
      if (direction === 'higher' || direction === 'monitor') {
        anomalies.push({
          mechanism: 'control_chart',
          rule: 'rule2_below_2sigma',
          severity: 'warning',
          direction: 'unfavorable',
          message: `低於 2σ 警戒線`,
          value,
          referenceValue: lcl2,
          year: dp.year,
          month: dp.month,
        });
      }
    }
  }

  // Rule 3: 連續 7 點在 CL 同側
  detectConsecutiveSameSide(validPoints, params, direction, anomalies);

  // Rule 4: 連續 7 點遞增或遞減
  detectConsecutiveTrend(validPoints, direction, anomalies);

  // Rule 5: 連續 3 點中有 2 點在 ±2σ 外
  detectTwoOfThree(validPoints, params, direction, anomalies, limitsMap);

  return anomalies;
}

/** Rule 3: 連續 7 點在 CL 同側 */
function detectConsecutiveSameSide(
  points: MonthlyDataPoint[],
  params: ControlChartParams,
  direction: Direction,
  anomalies: AnomalyResult[]
): void {
  if (points.length < 7) return;

  for (let i = 6; i < points.length; i++) {
    const window = points.slice(i - 6, i + 1);
    const values = window.map(p => p.value as number);

    const allAbove = values.every(v => v > params.cl);
    const allBelow = values.every(v => v < params.cl);

    if (allAbove) {
      const isUnfavorable = direction === 'lower' || direction === 'monitor';
      anomalies.push({
        mechanism: 'control_chart',
        rule: 'rule3_7above',
        severity: 'warning',
        direction: isUnfavorable ? 'unfavorable' : 'favorable',
        message: `連續 7 點高於中心線，可能存在趨勢偏移`,
        value: values[6],
        referenceValue: params.cl,
        year: window[6].year,
        month: window[6].month,
      });
    }

    if (allBelow) {
      const isUnfavorable = direction === 'higher' || direction === 'monitor';
      anomalies.push({
        mechanism: 'control_chart',
        rule: 'rule3_7below',
        severity: 'warning',
        direction: isUnfavorable ? 'unfavorable' : 'favorable',
        message: `連續 7 點低於中心線，可能存在趨勢偏移`,
        value: values[6],
        referenceValue: params.cl,
        year: window[6].year,
        month: window[6].month,
      });
    }
  }
}

/** Rule 4: 連續 7 點遞增或遞減 */
function detectConsecutiveTrend(
  points: MonthlyDataPoint[],
  direction: Direction,
  anomalies: AnomalyResult[]
): void {
  if (points.length < 7) return;

  for (let i = 6; i < points.length; i++) {
    const window = points.slice(i - 6, i + 1);
    const values = window.map(p => p.value as number);

    let increasing = true;
    let decreasing = true;
    for (let j = 1; j < values.length; j++) {
      if (values[j] <= values[j - 1]) increasing = false;
      if (values[j] >= values[j - 1]) decreasing = false;
    }

    if (increasing) {
      const isUnfavorable = direction === 'lower' || direction === 'monitor';
      anomalies.push({
        mechanism: 'control_chart',
        rule: 'rule4_trending_up',
        severity: 'warning',
        direction: isUnfavorable ? 'unfavorable' : 'favorable',
        message: `連續 7 點遞增趨勢`,
        value: values[6],
        year: window[6].year,
        month: window[6].month,
      });
    }

    if (decreasing) {
      const isUnfavorable = direction === 'higher' || direction === 'monitor';
      anomalies.push({
        mechanism: 'control_chart',
        rule: 'rule4_trending_down',
        severity: 'warning',
        direction: isUnfavorable ? 'unfavorable' : 'favorable',
        message: `連續 7 點遞減趨勢`,
        value: values[6],
        year: window[6].year,
        month: window[6].month,
      });
    }
  }
}

/** Rule 5: 連續 3 點中有 2 點在 ±2σ 外 */
function detectTwoOfThree(
  points: MonthlyDataPoint[],
  params: ControlChartParams,
  direction: Direction,
  anomalies: AnomalyResult[],
  limitsMap: Map<string, VariableLimit>
): void {
  if (points.length < 3) return;

  for (let i = 2; i < points.length; i++) {
    const window = points.slice(i - 2, i + 1);
    const values = window.map(p => p.value as number);

    // 2 of 3 above +2σ（使用各點自己的限）
    const aboveCount = window.filter((p, idx) => {
      const vl = limitsMap.get(`${p.year}_${p.month}`);
      const u2 = vl?.ucl2 ?? params.ucl2;
      return values[idx] > u2;
    }).length;

    if (aboveCount >= 2 && (direction === 'lower' || direction === 'monitor')) {
      const vl = limitsMap.get(`${window[2].year}_${window[2].month}`);
      anomalies.push({
        mechanism: 'control_chart',
        rule: 'rule5_2of3_above',
        severity: 'warning',
        direction: 'unfavorable',
        message: `3 點中 ${aboveCount} 點超出 2σ 上方`,
        value: values[2],
        referenceValue: vl?.ucl2 ?? params.ucl2,
        year: window[2].year,
        month: window[2].month,
      });
    }

    // 2 of 3 below -2σ
    const belowCount = window.filter((p, idx) => {
      const vl = limitsMap.get(`${p.year}_${p.month}`);
      const l2 = vl?.lcl2 ?? params.lcl2;
      return values[idx] < l2 && l2 > 0;
    }).length;

    if (belowCount >= 2 && (direction === 'higher' || direction === 'monitor')) {
      const vl = limitsMap.get(`${window[2].year}_${window[2].month}`);
      anomalies.push({
        mechanism: 'control_chart',
        rule: 'rule5_2of3_below',
        severity: 'warning',
        direction: 'unfavorable',
        message: `3 點中 ${belowCount} 點低於 2σ 下方`,
        value: values[2],
        referenceValue: vl?.lcl2 ?? params.lcl2,
        year: window[2].year,
        month: window[2].month,
      });
    }
  }
}
