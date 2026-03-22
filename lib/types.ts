// === 基礎列舉 ===

export type Category =
  | '整體照護' | '加護照護' | '手術照護' | '產科照護'
  | '急診照護' | '重點照護' | '感染管制' | '用藥安全'
  | '呼吸照護' | '經營管理';

export type Campus = '竹北' | '竹東' | '新竹';

export type IndicatorStatus = 'excellent' | 'good' | 'watch' | 'warning' | 'alert' | 'neutral';

export type TrendDirection = 'up' | 'down' | 'flat';

export type IndicatorUnit = 'percent' | 'permille' | 'count' | 'ratio';

export type Direction = 'lower' | 'higher' | 'monitor';

export type ChartType = 'I-MR' | 'P' | 'U';

export type DataNature = 'continuous' | 'binomial_rate' | 'poisson_rate';

// === 資料點型別 ===

export interface MonthlyDataPoint {
  year: number;
  month: number;
  value: number | null;
  numerator?: number;    // 分子（事件數）
  denominator?: number;  // 分母（母群數/暴露量）
}

export interface YearlySummary {
  year: number;
  average: number | null;
  benchmarkRegional: number | null;
  benchmarkDistrict: number | null;
}

// === 指標元資料 ===

export interface IndicatorMeta {
  code: string;
  name: string;
  category: Category;
  unit: IndicatorUnit;
  isQuarterly: boolean;
  direction: Direction;
  campuses: Campus[];
  source: 'preset' | 'custom';
  aliases: string[];
  formula?: string;
  description?: string;
  isActive: boolean;
  dataNature: DataNature;
  /** @deprecated Use direction instead. Kept for backward compat. */
  isReverse: boolean;
}

// === Dexie 資料庫表型別 ===

export interface DataPointRecord {
  id?: number;
  indicatorCode: string;
  campus: Campus;
  year: number;
  month: number;
  value: number | null;
  numerator?: number;    // 分子（事件數）
  denominator?: number;  // 分母（母群數/暴露量）
  importId?: number;
}

export interface YearlySummaryRecord {
  id?: number;
  indicatorCode: string;
  campus: Campus;
  year: number;
  average: number | null;
  benchmarkRegional: number | null;
  benchmarkDistrict: number | null;
  importId?: number;
}

export interface PeerValueRecord {
  id?: number;
  indicatorCode: string;
  campus: Campus;
  value: number;
  year?: number;
}

export interface ImportLog {
  id?: number;
  timestamp: Date;
  fileName: string;
  fileSize: number;
  sheetsProcessed: string[];
  dataPointsNew: number;
  dataPointsUpdated: number;
  dataPointsUnchanged: number;
  revisionsDetected: number;
  errors: string[];
}

export interface AlertRecord {
  id?: number;
  indicatorCode: string;
  campus: Campus;
  year: number;
  month: number;
  mechanism: 'control_chart' | 'monthly_change' | 'peer_comparison';
  rule?: string;
  severity: IndicatorStatus;
  message: string;
  createdAt: Date;
  acknowledged: boolean;
}

export interface MatchingRule {
  id?: number;
  excelName: string;
  normalizedName: string;
  indicatorCode: string;
  confirmedAt: Date;
}

// === TCPI 標竿 ===

export interface TCPIBenchmark {
  indicatorCode: string;        // QIP 指標代碼（如 HA01-01）
  tcpiName: string;             // TCPI 指標名稱
  year: number;                 // TCPI 年度（如 113）
  medicalCenter: number | null; // 醫學中心同儕值（新竹用）
  regionalHospital: number | null; // 區域醫院同儕值（竹北用）
  districtHospital: number | null; // 地區醫院同儕值（竹東用）
}

export interface TCPIBenchmarkRecord {
  id?: number;
  indicatorCode: string;
  tcpiName: string;
  year: number;
  medicalCenter: number | null;
  regionalHospital: number | null;
  districtHospital: number | null;
  importedAt: Date;
}

export interface TCPIParseResult {
  benchmarks: TCPIBenchmark[];
  matchedCount: number;
  unmatchedTcpiNames: string[];
  errors: string[];
}

// === 管制圖與異常偵測 ===

export interface VariableLimit {
  year: number;
  month: number;
  ucl: number;
  lcl: number;
  ucl2: number;
  lcl2: number;
  sampleSize: number;
}

export interface ControlChartParams {
  chartType: ChartType;
  cl: number;
  ucl: number;       // I-MR: fixed UCL. P/U: average UCL (for display)
  lcl: number;
  sigma: number;     // I-MR: MR-based sigma. P/U: 0
  ucl2: number;      // 2σ 上限
  lcl2: number;      // 2σ 下限
  n: number;         // 數據點數量
  variableLimits?: VariableLimit[];  // P/U charts: per-point limits
}

export interface AnomalyResult {
  mechanism: 'control_chart' | 'monthly_change' | 'peer_comparison';
  rule?: string;
  severity: IndicatorStatus;
  direction: 'unfavorable' | 'favorable';
  message: string;
  value: number;
  referenceValue?: number;
  year?: number;
  month?: number;
}

// === 組合型別（UI 顯示用） ===

export interface IndicatorData {
  meta: IndicatorMeta;
  campus: Campus;
  monthlyData: MonthlyDataPoint[];
  yearlySummaries: YearlySummary[];
  latestValue: number | null;
  latestMonth: string | null;
  status: IndicatorStatus;
  trend: TrendDirection;
  benchmarkValue: number | null;
  peerValue: number | null;
  peerYear: number | null;       // TCPI 標竿年度（民國年）
  anomalies: AnomalyResult[];
  controlChart: ControlChartParams | null;
}

// === UI 狀態 ===

export type ViewMode = 'card' | 'table' | 'heatmap';

export interface DashboardState {
  campus: Campus;
  indicators: IndicatorData[];
  loading: boolean;
  error: string | null;
  viewMode: ViewMode;
  searchQuery: string;
  selectedCategory: Category | 'all';
  selectedYear: number;
}

// === 匯入相關 ===

export interface ParseResult {
  indicators: IndicatorData[];
  errors: string[];
}

export interface ColumnMap {
  codeCol: number;
  nameCol: number;
  months: number[];
  yearAvg: number;
  benchmarkCols: number[];
  year: number;
  campus: Campus;
}

export interface ImportDiffReport {
  newPoints: DataPointRecord[];
  updatedPoints: { existing: DataPointRecord; incoming: DataPointRecord }[];
  unchangedCount: number;
  newSummaries: YearlySummaryRecord[];
  updatedSummaries: { existing: YearlySummaryRecord; incoming: YearlySummaryRecord }[];
  anomaliesDetected: number;
}

// === 模糊比對 ===

export type MatchConfidence = 'exact' | 'alias' | 'contains' | 'similar' | 'unrecognized';

export interface MatchResult {
  excelName: string;
  indicatorCode: string | null;
  indicatorName: string | null;
  confidence: MatchConfidence;
  score: number;
}
