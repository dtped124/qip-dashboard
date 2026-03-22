import type { AnomalyResult, Direction } from '../types';

/** 同儕比較偏差門檻 */
const DEVIATION_THRESHOLD = 0.10;  // 10%
const MONITOR_THRESHOLD = 0.20;    // 20%（monitor 型指標）

/**
 * 偵測與同儕值的偏差
 * 差異率 = (本院值 - 同儕值) / 同儕值 × 100%
 */
export function detectPeerDeviation(
  value: number,
  peerValue: number | null,
  direction: Direction,
  year?: number,
  month?: number
): AnomalyResult | null {
  if (peerValue === null || peerValue === undefined || peerValue === 0) return null;

  const deviationRate = (value - peerValue) / peerValue;
  const absDeviation = Math.abs(deviationRate);
  const deviationPercent = (deviationRate * 100).toFixed(1);

  if (direction === 'lower') {
    // 越低越好
    if (value > peerValue * (1 + DEVIATION_THRESHOLD)) {
      // 高於同儕 — 不利
      return {
        mechanism: 'peer_comparison',
        severity: 'watch',
        direction: 'unfavorable',
        message: `高於同儕值 ${deviationPercent}%（同儕值: ${peerValue.toFixed(2)}）`,
        value,
        referenceValue: peerValue,
        year,
        month,
      };
    }
    if (value <= peerValue * (1 - DEVIATION_THRESHOLD)) {
      // 低於同儕 — 優良
      return {
        mechanism: 'peer_comparison',
        severity: 'excellent',
        direction: 'favorable',
        message: `低於同儕值 ${Math.abs(parseFloat(deviationPercent))}%（同儕值: ${peerValue.toFixed(2)}）`,
        value,
        referenceValue: peerValue,
        year,
        month,
      };
    }
  } else if (direction === 'higher') {
    // 越高越好
    if (value < peerValue * (1 - DEVIATION_THRESHOLD)) {
      // 低於同儕 — 不利
      return {
        mechanism: 'peer_comparison',
        severity: 'watch',
        direction: 'unfavorable',
        message: `低於同儕值 ${Math.abs(parseFloat(deviationPercent))}%（同儕值: ${peerValue.toFixed(2)}）`,
        value,
        referenceValue: peerValue,
        year,
        month,
      };
    }
    if (value >= peerValue * (1 + DEVIATION_THRESHOLD)) {
      // 高於同儕 — 優良
      return {
        mechanism: 'peer_comparison',
        severity: 'excellent',
        direction: 'favorable',
        message: `高於同儕值 ${deviationPercent}%（同儕值: ${peerValue.toFixed(2)}）`,
        value,
        referenceValue: peerValue,
        year,
        month,
      };
    }
  } else {
    // monitor：差異率絕對值 > 20% 為異常
    if (absDeviation > MONITOR_THRESHOLD) {
      return {
        mechanism: 'peer_comparison',
        severity: 'watch',
        direction: 'unfavorable',
        message: `與同儕值差異 ${deviationPercent}%（同儕值: ${peerValue.toFixed(2)}）`,
        value,
        referenceValue: peerValue,
        year,
        month,
      };
    }
  }

  return null;
}
