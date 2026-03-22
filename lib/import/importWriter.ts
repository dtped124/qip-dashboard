import { db } from '../db/schema';
import type { ImportLog, ImportDiffReport } from '../types';

/**
 * 執行匯入 — 將數據寫入 IndexedDB
 */
export async function executeImport(
  diff: ImportDiffReport,
  fileName: string,
  fileSize: number,
  sheetsProcessed: string[],
  errors: string[]
): Promise<ImportLog> {
  const log: ImportLog = {
    timestamp: new Date(),
    fileName,
    fileSize,
    sheetsProcessed,
    dataPointsNew: diff.newPoints.length,
    dataPointsUpdated: diff.updatedPoints.length,
    dataPointsUnchanged: diff.unchangedCount,
    revisionsDetected: diff.updatedPoints.length,
    errors,
  };

  await db.transaction('rw', [db.dataPoints, db.yearlySummaries, db.importLogs], async () => {
    // 寫入匯入紀錄
    const logId = await db.importLogs.add(log);

    // 新增數據點
    for (const dp of diff.newPoints) {
      await db.dataPoints.add({ ...dp, importId: logId as number });
    }

    // 更新數據點
    for (const { existing, incoming } of diff.updatedPoints) {
      if (existing.id !== undefined) {
        await db.dataPoints.update(existing.id, {
          value: incoming.value,
          numerator: incoming.numerator,
          denominator: incoming.denominator,
          importId: logId as number,
        });
      }
    }

    // 新增年度彙總
    for (const s of diff.newSummaries) {
      await db.yearlySummaries.add({ ...s, importId: logId as number });
    }

    // 更新年度彙總
    for (const { existing, incoming } of diff.updatedSummaries) {
      if (existing.id !== undefined) {
        await db.yearlySummaries.update(existing.id, {
          average: incoming.average,
          benchmarkRegional: incoming.benchmarkRegional,
          benchmarkDistrict: incoming.benchmarkDistrict,
          importId: logId as number,
        });
      }
    }
  });

  return log;
}
