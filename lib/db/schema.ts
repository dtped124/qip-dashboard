import Dexie, { type Table } from 'dexie';
import type {
  IndicatorMeta,
  DataPointRecord,
  YearlySummaryRecord,
  PeerValueRecord,
  ImportLog,
  AlertRecord,
  MatchingRule,
  TCPIBenchmarkRecord,
} from '../types';

export class QIPDatabase extends Dexie {
  indicators!: Table<IndicatorMeta>;
  dataPoints!: Table<DataPointRecord>;
  yearlySummaries!: Table<YearlySummaryRecord>;
  peerValues!: Table<PeerValueRecord>;
  importLogs!: Table<ImportLog>;
  alerts!: Table<AlertRecord>;
  matchingRules!: Table<MatchingRule>;
  tcpiBenchmarks!: Table<TCPIBenchmarkRecord>;

  constructor() {
    super('qip-dashboard');

    this.version(1).stores({
      indicators: '++id, code, category, source, isActive',
      dataPoints: '++id, [indicatorCode+campus+year+month], indicatorCode, campus, importId',
      yearlySummaries: '++id, [indicatorCode+campus+year], indicatorCode, campus, importId',
      peerValues: '++id, [indicatorCode+campus], indicatorCode',
      importLogs: '++id, timestamp',
      alerts: '++id, [indicatorCode+campus+year+month], indicatorCode, campus, severity, acknowledged',
      matchingRules: '++id, normalizedName, indicatorCode',
    });

    // v2: 新增 numerator/denominator 欄位（非索引欄位，Dexie 自動支援）
    this.version(2).stores({
      indicators: '++id, code, category, source, isActive',
      dataPoints: '++id, [indicatorCode+campus+year+month], indicatorCode, campus, importId',
      yearlySummaries: '++id, [indicatorCode+campus+year], indicatorCode, campus, importId',
      peerValues: '++id, [indicatorCode+campus], indicatorCode',
      importLogs: '++id, timestamp',
      alerts: '++id, [indicatorCode+campus+year+month], indicatorCode, campus, severity, acknowledged',
      matchingRules: '++id, normalizedName, indicatorCode',
    });

    // v3: 新增 TCPI 標竿表
    this.version(3).stores({
      indicators: '++id, code, category, source, isActive',
      dataPoints: '++id, [indicatorCode+campus+year+month], indicatorCode, campus, importId',
      yearlySummaries: '++id, [indicatorCode+campus+year], indicatorCode, campus, importId',
      peerValues: '++id, [indicatorCode+campus], indicatorCode',
      importLogs: '++id, timestamp',
      alerts: '++id, [indicatorCode+campus+year+month], indicatorCode, campus, severity, acknowledged',
      matchingRules: '++id, normalizedName, indicatorCode',
      tcpiBenchmarks: '++id, [indicatorCode+year], indicatorCode, year',
    });
  }
}

export const db = new QIPDatabase();
