import { db } from '../db/schema';
import type { DataPointRecord, YearlySummaryRecord, ImportDiffReport } from '../types';

/**
 * 計算匯入差異
 * 比對新數據與 IndexedDB 中的現有資料
 */
export async function computeImportDiff(
  incomingPoints: DataPointRecord[],
  incomingSummaries: YearlySummaryRecord[]
): Promise<ImportDiffReport> {
  const newPoints: DataPointRecord[] = [];
  const updatedPoints: { existing: DataPointRecord; incoming: DataPointRecord }[] = [];
  let unchangedCount = 0;

  const newSummaries: YearlySummaryRecord[] = [];
  const updatedSummaries: { existing: YearlySummaryRecord; incoming: YearlySummaryRecord }[] = [];

  // 比對數據點
  for (const dp of incomingPoints) {
    if (dp.value === null) continue;

    const existing = await db.dataPoints
      .where('[indicatorCode+campus+year+month]')
      .equals([dp.indicatorCode, dp.campus, dp.year, dp.month])
      .first();

    if (!existing) {
      newPoints.push(dp);
    } else if (
      existing.value !== dp.value ||
      existing.numerator !== dp.numerator ||
      existing.denominator !== dp.denominator
    ) {
      updatedPoints.push({ existing, incoming: dp });
    } else {
      unchangedCount++;
    }
  }

  // 比對年度彙總
  for (const s of incomingSummaries) {
    const existing = await db.yearlySummaries
      .where('[indicatorCode+campus+year]')
      .equals([s.indicatorCode, s.campus, s.year])
      .first();

    if (!existing) {
      newSummaries.push(s);
    } else if (
      existing.average !== s.average ||
      existing.benchmarkRegional !== s.benchmarkRegional ||
      existing.benchmarkDistrict !== s.benchmarkDistrict
    ) {
      updatedSummaries.push({ existing, incoming: s });
    }
  }

  return {
    newPoints,
    updatedPoints,
    unchangedCount,
    newSummaries,
    updatedSummaries,
    anomaliesDetected: 0,
  };
}
