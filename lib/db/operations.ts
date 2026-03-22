import { db } from './schema';
import type {
  IndicatorMeta,
  DataPointRecord,
  YearlySummaryRecord,
  PeerValueRecord,
  ImportLog,
  AlertRecord,
  MatchingRule,
  Campus,
} from '../types';

// === 指標 CRUD ===

export async function getAllIndicators(): Promise<IndicatorMeta[]> {
  return db.indicators.toArray();
}

export async function getIndicatorByCode(code: string): Promise<IndicatorMeta | undefined> {
  return db.indicators.where('code').equals(code).first();
}

export async function upsertIndicator(indicator: IndicatorMeta): Promise<void> {
  const existing = await db.indicators.where('code').equals(indicator.code).first();
  if (existing) {
    const id = (existing as IndicatorMeta & { id: number }).id;
    await db.indicators.update(id, { ...indicator });
  } else {
    await db.indicators.add(indicator);
  }
}

export async function deleteCustomIndicator(code: string): Promise<void> {
  const indicator = await getIndicatorByCode(code);
  if (indicator && indicator.source === 'custom') {
    await db.indicators.where('code').equals(code).delete();
    await db.dataPoints.where('indicatorCode').equals(code).delete();
    await db.yearlySummaries.where('indicatorCode').equals(code).delete();
    await db.alerts.where('indicatorCode').equals(code).delete();
  }
}

// === 資料點 ===

export async function getDataPoints(
  indicatorCode: string,
  campus: Campus
): Promise<DataPointRecord[]> {
  return db.dataPoints
    .where('[indicatorCode+campus+year+month]')
    .between(
      [indicatorCode, campus, Dexie.minKey, Dexie.minKey],
      [indicatorCode, campus, Dexie.maxKey, Dexie.maxKey]
    )
    .toArray();
}

export async function upsertDataPoint(dp: DataPointRecord): Promise<void> {
  const existing = await db.dataPoints
    .where('[indicatorCode+campus+year+month]')
    .equals([dp.indicatorCode, dp.campus, dp.year, dp.month])
    .first();

  if (existing) {
    await db.dataPoints.update(existing.id!, dp);
  } else {
    await db.dataPoints.add(dp);
  }
}

export async function bulkUpsertDataPoints(points: DataPointRecord[]): Promise<{
  inserted: number;
  updated: number;
  unchanged: number;
}> {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  await db.transaction('rw', db.dataPoints, async () => {
    for (const dp of points) {
      const existing = await db.dataPoints
        .where('[indicatorCode+campus+year+month]')
        .equals([dp.indicatorCode, dp.campus, dp.year, dp.month])
        .first();

      if (!existing) {
        await db.dataPoints.add(dp);
        inserted++;
      } else if (
        existing.value !== dp.value ||
        existing.numerator !== dp.numerator ||
        existing.denominator !== dp.denominator
      ) {
        await db.dataPoints.update(existing.id!, { ...dp, id: existing.id });
        updated++;
      } else {
        unchanged++;
      }
    }
  });

  return { inserted, updated, unchanged };
}

// === 年度彙總 ===

export async function getYearlySummaries(
  indicatorCode: string,
  campus: Campus
): Promise<YearlySummaryRecord[]> {
  return db.yearlySummaries
    .where('[indicatorCode+campus+year]')
    .between(
      [indicatorCode, campus, Dexie.minKey],
      [indicatorCode, campus, Dexie.maxKey]
    )
    .toArray();
}

export async function upsertYearlySummary(summary: YearlySummaryRecord): Promise<void> {
  const existing = await db.yearlySummaries
    .where('[indicatorCode+campus+year]')
    .equals([summary.indicatorCode, summary.campus, summary.year])
    .first();

  if (existing) {
    await db.yearlySummaries.update(existing.id!, summary);
  } else {
    await db.yearlySummaries.add(summary);
  }
}

// === 同儕值 ===

export async function getPeerValue(
  indicatorCode: string,
  campus: Campus
): Promise<PeerValueRecord | undefined> {
  return db.peerValues
    .where('[indicatorCode+campus]')
    .equals([indicatorCode, campus])
    .first();
}

export async function upsertPeerValue(pv: PeerValueRecord): Promise<void> {
  const existing = await db.peerValues
    .where('[indicatorCode+campus]')
    .equals([pv.indicatorCode, pv.campus])
    .first();

  if (existing) {
    await db.peerValues.update(existing.id!, pv);
  } else {
    await db.peerValues.add(pv);
  }
}

// === 匯入紀錄 ===

export async function createImportLog(log: Omit<ImportLog, 'id'>): Promise<number> {
  return await db.importLogs.add(log) as number;
}

export async function getImportLogs(): Promise<ImportLog[]> {
  return db.importLogs.orderBy('timestamp').reverse().toArray();
}

// === 異常紀錄 ===

export async function getAlerts(
  indicatorCode: string,
  campus: Campus
): Promise<AlertRecord[]> {
  return db.alerts
    .where('[indicatorCode+campus+year+month]')
    .between(
      [indicatorCode, campus, Dexie.minKey, Dexie.minKey],
      [indicatorCode, campus, Dexie.maxKey, Dexie.maxKey]
    )
    .toArray();
}

export async function clearAndSetAlerts(
  indicatorCode: string,
  campus: Campus,
  alerts: Omit<AlertRecord, 'id'>[]
): Promise<void> {
  await db.transaction('rw', db.alerts, async () => {
    await db.alerts
      .where('indicatorCode').equals(indicatorCode)
      .and(a => a.campus === campus)
      .delete();
    if (alerts.length > 0) {
      await db.alerts.bulkAdd(alerts);
    }
  });
}

// === 比對記憶 ===

export async function getMatchingRules(): Promise<MatchingRule[]> {
  return db.matchingRules.toArray();
}

export async function addMatchingRule(rule: Omit<MatchingRule, 'id'>): Promise<void> {
  const existing = await db.matchingRules
    .where('normalizedName')
    .equals(rule.normalizedName)
    .first();

  if (existing) {
    await db.matchingRules.update(existing.id!, rule);
  } else {
    await db.matchingRules.add(rule);
  }
}

// === 資料庫重置 ===

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [
    db.dataPoints,
    db.yearlySummaries,
    db.peerValues,
    db.importLogs,
    db.alerts,
    db.matchingRules,
    db.tcpiBenchmarks,
  ], async () => {
    await db.dataPoints.clear();
    await db.yearlySummaries.clear();
    await db.peerValues.clear();
    await db.importLogs.clear();
    await db.alerts.clear();
    await db.matchingRules.clear();
    await db.tcpiBenchmarks.clear();
  });
}

// re-export Dexie for use in imports
import Dexie from 'dexie';
export { Dexie };
