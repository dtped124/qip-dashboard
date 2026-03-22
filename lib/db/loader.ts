/**
 * 從 IndexedDB 重建 IndicatorData[]
 * 用於頁面重新整理後還原儀表板資料
 */

import { db } from './schema';
import { INDICATOR_META, HSINCHU_TCPI_EXCLUDE, HSINCHU_ONLY_TCPI } from '../constants';
import { applyStatus } from '../status-engine';
import { applyTrends } from '../trend-calculator';
import type {
  IndicatorData,
  MonthlyDataPoint,
  YearlySummary,
  Campus,
} from '../types';

export async function loadIndicatorsFromDB(): Promise<IndicatorData[]> {
  const allDataPoints = await db.dataPoints.toArray();
  if (allDataPoints.length === 0) return [];

  // 依 indicatorCode + campus 分組
  const grouped = new Map<string, typeof allDataPoints>();
  for (const dp of allDataPoints) {
    const key = `${dp.indicatorCode}:${dp.campus}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(dp);
  }

  const indicators: IndicatorData[] = [];

  const groupedEntries = Array.from(grouped.entries());
  for (const [key, points] of groupedEntries) {
    const separatorIdx = key.indexOf(':');
    const code = key.substring(0, separatorIdx);
    const campus = key.substring(separatorIdx + 1) as Campus;

    const meta = INDICATOR_META[code];
    if (!meta) continue;

    // 建立月份資料（含分子/分母供 P/U Chart 使用）
    const monthlyData: MonthlyDataPoint[] = points
      .map(dp => {
        const mdp: MonthlyDataPoint = {
          year: dp.year,
          month: dp.month,
          value: dp.value,
        };
        if (dp.numerator !== undefined) mdp.numerator = dp.numerator;
        if (dp.denominator !== undefined) mdp.denominator = dp.denominator;
        return mdp;
      })
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    // 建立年度摘要
    const years = Array.from(new Set(points.map(dp => dp.year))).sort();
    const yearlySummaries: YearlySummary[] = years.map(year => {
      const yearPoints = points.filter(dp => dp.year === year && dp.value !== null);
      const average = yearPoints.length > 0
        ? yearPoints.reduce((sum, dp) => sum + dp.value!, 0) / yearPoints.length
        : null;
      return {
        year,
        average,
        benchmarkRegional: null,
        benchmarkDistrict: null,
      };
    });

    // 從 DB 讀取已存的年度摘要（含 benchmark）
    try {
      const dbSummaries = await db.yearlySummaries
        .where('[indicatorCode+campus+year]')
        .between(
          [code, campus, -Infinity],
          [code, campus, Infinity]
        )
        .toArray();
      for (const dbs of dbSummaries) {
        const match = yearlySummaries.find(ys => ys.year === dbs.year);
        if (match) {
          if (dbs.benchmarkRegional !== null) match.benchmarkRegional = dbs.benchmarkRegional;
          if (dbs.benchmarkDistrict !== null) match.benchmarkDistrict = dbs.benchmarkDistrict;
        }
      }
    } catch {
      // ignore — yearly summaries might not exist yet
    }

    // 找最新有值的月份
    let latestValue: number | null = null;
    let latestMonth: string | null = null;
    const sorted = points
      .filter(dp => dp.value !== null)
      .sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month);
    if (sorted.length > 0) {
      latestValue = sorted[0].value;
      latestMonth = `${sorted[0].year}.${String(sorted[0].month).padStart(2, '0')}`;
    }

    // 讀取同儕值（優先使用 TCPI 標竿，否則使用 QIP Excel 的同儕值）
    let peerValue: number | null = null;
    let peerYear: number | null = null;

    // 1. 嘗試從 TCPI 標竿取得（根據院區層級選擇對應欄位）
    //    優先取去年度資料，若無則取前年度資料
    //    排除規則：
    //    - 新竹：排除 HSINCHU_TCPI_EXCLUDE 中的指標（定義不一致）
    //    - 竹北/竹東：排除 HSINCHU_ONLY_TCPI 中的指標（僅醫學中心適用）
    const tcpiExcluded =
      (campus === '新竹' && HSINCHU_TCPI_EXCLUDE.has(code)) ||
      (campus !== '新竹' && HSINCHU_ONLY_TCPI.has(code));
    try {
      const tcpiBenchmarks = await db.tcpiBenchmarks
        .where('indicatorCode')
        .equals(code)
        .toArray();
      if (tcpiBenchmarks.length > 0 && !tcpiExcluded) {
        const currentRocYear = new Date().getFullYear() - 1911; // 今年民國年
        const lastYear = currentRocYear - 1;     // 去年度
        const yearBefore = currentRocYear - 2;   // 前年度

        // 從 TCPI 標竿取出該院區的值
        const extractValue = (rec: typeof tcpiBenchmarks[0]): number | null => {
          if (campus === '新竹') return rec.medicalCenter;
          if (campus === '竹北') return rec.regionalHospital;
          if (campus === '竹東') return rec.districtHospital;
          return null;
        };

        // 優先去年度 → 前年度 → 其他最新年度
        const tryYear = (yr: number): boolean => {
          const rec = tcpiBenchmarks.find(b => b.year === yr);
          if (rec) {
            const val = extractValue(rec);
            if (val !== null) {
              peerValue = val;
              peerYear = yr;
              return true;
            }
          }
          return false;
        };

        if (!tryYear(lastYear) && !tryYear(yearBefore)) {
          // 都找不到時，退回取最新有值的年度
          const sorted = tcpiBenchmarks.sort((a, b) => b.year - a.year);
          for (const rec of sorted) {
            const val = extractValue(rec);
            if (val !== null) {
              peerValue = val;
              peerYear = rec.year;
              break;
            }
          }
        }
      }
    } catch {
      // tcpiBenchmarks table might not exist yet
    }

    // 2. 如果 TCPI 沒有值，退回使用 QIP Excel 的同儕值
    if (peerValue === null) {
      try {
        const pv = await db.peerValues
          .where('[indicatorCode+campus]')
          .equals([code, campus])
          .first();
        if (pv) peerValue = pv.value;
      } catch {
        // ignore
      }
    }

    indicators.push({
      meta: { code, ...meta },
      campus,
      monthlyData,
      yearlySummaries,
      latestValue,
      latestMonth,
      status: 'neutral',
      trend: 'flat',
      benchmarkValue: null,
      peerValue,
      peerYear,
      anomalies: [],
      controlChart: null,
    });
  }

  // 套用狀態與趨勢分析
  let processed = applyStatus(indicators);
  processed = applyTrends(processed);
  return processed;
}
