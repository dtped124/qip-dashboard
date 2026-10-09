import type {
  Campus,
  ControlChartParams,
  DataNature,
  Direction,
  IndicatorData,
  IndicatorMeta,
  IndicatorUnit,
  MonthlyDataPoint,
} from '@/lib/types';
import { INDICATOR_META, formatValue } from '@/lib/constants';

// ===== 型別 =====

export interface AnchorMonth {
  /** 民國年（與 monthlyData 的 year 一致） */
  year: number;
  month: number;
}

export type YoyTone = 'good' | 'bad' | 'neutral' | 'na';

/** 灰帶：固定界限（rect）或逐月界限（polygon，長度皆為 SERIES_LEN；null＝該月無界限，polygon 在此斷開） */
export type CardBand =
  | { kind: 'fixed'; cl: number; ucl: number; lcl: number }
  | { kind: 'variable'; cl: number; ucl: (number | null)[]; lcl: (number | null)[] }
  | null;

export interface MonthlyCard {
  /** 實際查詢的指標代碼（已套用院區覆寫，例如竹東的 HA01-03-01） */
  code: string;
  /** 卡片標題（已套用標題覆寫） */
  name: string;
  unit: IndicatorUnit;
  direction: Direction;
  /** 該院區不適用此指標（meta.campuses 不含該院區） */
  notApplicable: boolean;
  /** 院區適用，但找不到 IndicatorData 或 13 個月全為 null */
  noData: boolean;

  value: number | null;
  prevValue: number | null;
  /** 本月 − 去年同月；任一缺值為 null */
  yoyDelta: number | null;
  yoyTone: YoyTone;

  /** 已格式化文字（卡片直接顯示） */
  valueText: string;
  prevText: string;
  yoyText: string;

  /** anchor 往前 13 個月（含 anchor），缺值或 0/0 為 null */
  series: (number | null)[];
  band: CardBand;
  /** 與 series 同長；該月有 control_chart 警示 */
  alertMonths: boolean[];
  /** anchor 月有 control_chart 警示（紅框） */
  isAlert: boolean;
}

export interface MonthlyCardCampusColumn {
  campus: Campus;
  label: string;
  cards: MonthlyCard[];
}

export interface MonthlyCardSlideData {
  pageIndex: number;
  totalPages: number;
  title: string;
  /** 民國年 */
  year: number;
  month: number;
  /** 例如「整體照護 3、加護照護 5、手術照護 4」 */
  categorySummary: string;
  columns: MonthlyCardCampusColumn[];
}

export type LimitsByKey = Record<string, ControlChartParams | null>;

// ===== 常數 =====

export const SERIES_LEN = 13;

const ALL_CAMPUSES: Campus[] = ['竹北', '竹東', '新竹'];

/** 欄順序固定：新竹、竹北、竹東 */
export const MONTHLY_CARD_CAMPUSES: { campus: Campus; label: string }[] = [
  { campus: '新竹', label: '新竹醫院' },
  { campus: '竹北', label: '生醫醫院-竹北' },
  { campus: '竹東', label: '生醫醫院-竹東' },
];

export interface MonthlyCardPageDef {
  title: string;
  /** 依序填入 12 格 */
  codes: string[];
}

export const MONTHLY_CARD_PAGES: MonthlyCardPageDef[] = [
  {
    title: '醫療照護',
    codes: [
      'HA01-01', 'HA01-02', 'HA01-03',
      'HA02-01', 'HA02-02', 'HA02-11', 'HA02-12', 'HA02-13',
      'HA03-01', 'HA03-02', 'HA03-03', 'HA03-04',
    ],
  },
  {
    title: '特定照護',
    codes: [
      'HA05-01', 'HA05-02', 'HA05-03',
      'HA06-01', 'HA06-11', 'HA06-13', 'HA06-32', 'HA06-21', 'HA06-23', 'HA06-24', 'HA06-25', 'HA06-31',
    ],
  },
  {
    title: '經營管理',
    codes: [
      'HA09-01', 'HA09-02', 'HA09-03', 'HA09-04', 'HA09-05',
      'HA10-01', 'HA10-02', 'HA10-03', 'HA10-04', 'HA10-09',
      'HA08-01',
      'HA07-01',
    ],
  },
];

/** 院區專屬代碼覆寫：竹東的 HA01-03 改用「不含PAC」數列 */
export const MONTHLY_CARD_CAMPUS_OVERRIDES: Partial<Record<Campus, Record<string, string>>> = {
  '竹東': { 'HA01-03': 'HA01-03-01' },
};

/** 卡片標題覆寫（以「實際查詢代碼」為 key；不動 INDICATOR_META） */
export const MONTHLY_CARD_TITLE_OVERRIDES: Record<string, string> = {
  'HA01-03': '急性病床住院案件住院日數超過30日比率',
};

// ===== 月份工具 =====

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * 三院區內最近一個「有實質測量資料」的月份。
 * 與 app/cross-campus/page.tsx 共用（避開公式輸出 0 的幽靈月）：
 * 真實測量月至少 numerator>0 或 denominator>0。
 */
export function resolveAnchorMonth(allData: Record<string, IndicatorData[]>): AnchorMonth | null {
  let latestYear = 0;
  let latestMonth = 0;
  ALL_CAMPUSES.forEach(campus => {
    (allData[campus] || []).forEach(ind => {
      ind.monthlyData?.forEach(dp => {
        const n = dp.numerator;
        const d = dp.denominator;
        if ((n != null && n > 0) || (d != null && d > 0)) {
          if (dp.year > latestYear || (dp.year === latestYear && dp.month > latestMonth)) {
            latestYear = dp.year;
            latestMonth = dp.month;
          }
        }
      });
    });
  });
  return latestYear > 0 ? { year: latestYear, month: latestMonth } : null;
}

// ===== 數值處理 =====

/**
 * 單月數值；0/0 視為 NA（規則同 components/detail/DataTable.tsx 的 isNA）：
 * - value 為 null → NA
 * - 比率型（binomial/poisson）denominator 明確為 0 → NA
 * - 比率型 value 為 0 且沒有可驗證的 num/den → NA
 * - 計數／連續型（count、ratio）只看 value；它們的 denominator 常是占位的 0，不代表缺測
 */
function monthValue(dp: MonthlyDataPoint | undefined, dataNature: DataNature): number | null {
  if (!dp || dp.value === null || dp.value === undefined || !Number.isFinite(dp.value)) return null;
  const isRate = dataNature === 'binomial_rate' || dataNature === 'poisson_rate';
  if (!isRate) return dp.value;
  const den = dp.denominator;
  if (den != null && den === 0) return null;
  const hasND = dp.numerator != null && den != null && den > 0;
  if (dp.value === 0 && !hasND) return null;
  return dp.value;
}

function unitSuffix(unit: IndicatorUnit): string {
  return unit === 'percent' ? '%' : unit === 'permille' ? '‰' : '';
}

function yoyDecimals(unit: IndicatorUnit): number {
  return unit === 'count' ? 0 : unit === 'ratio' ? 2 : 1;
}

function computeYoy(
  value: number | null,
  lastYear: number | null,
  unit: IndicatorUnit,
  direction: Direction,
): { delta: number | null; tone: YoyTone; text: string } {
  if (value === null || lastYear === null) return { delta: null, tone: 'na', text: '— 去年' };
  const delta = value - lastYear;
  const dec = yoyDecimals(unit);
  const rounded = Number(delta.toFixed(dec));
  const suffix = unitSuffix(unit);
  if (rounded === 0) {
    return { delta, tone: 'neutral', text: `＝ ${(0).toFixed(dec)}${suffix} 去年` };
  }
  const up = rounded > 0;
  const sign = up ? '+' : '−';
  const arrow = up ? '▲' : '▼';
  let tone: YoyTone = 'neutral';
  if (direction === 'lower') tone = up ? 'bad' : 'good';
  else if (direction === 'higher') tone = up ? 'good' : 'bad';
  return { delta, tone, text: `${arrow} ${sign}${Math.abs(rounded).toFixed(dec)}${suffix} 去年` };
}

function buildBand(
  cc: ControlChartParams | null | undefined,
  months: { year: number; month: number }[],
): CardBand {
  if (!cc) return null;
  const vls = cc.variableLimits;
  if (!vls || vls.length === 0) {
    return { kind: 'fixed', cl: cc.cl, ucl: cc.ucl, lcl: cc.lcl };
  }
  // 逐月界限；缺月沿用前一個有值月份的界限，開頭就缺則該點為 null（polygon 在 null 處斷開）
  const ucl: (number | null)[] = [];
  const lcl: (number | null)[] = [];
  let prevU: number | null = null;
  let prevL: number | null = null;
  for (const m of months) {
    const vl = vls.find(v => v.year === m.year && v.month === m.month);
    if (vl) {
      prevU = vl.ucl;
      prevL = vl.lcl;
    }
    ucl.push(prevU);
    lcl.push(prevL);
  }
  if (ucl.every(v => v === null)) return null;
  const same = (arr: (number | null)[]) => arr.every(v => v !== null && Math.abs(v - (arr[0] as number)) < 1e-9);
  if (same(ucl) && same(lcl)) {
    return { kind: 'fixed', cl: cc.cl, ucl: ucl[0] as number, lcl: lcl[0] as number };
  }
  return { kind: 'variable', cl: cc.cl, ucl, lcl };
}

// ===== 對外輔助 =====

export function resolveCardCode(campus: Campus, code: string): string {
  return MONTHLY_CARD_CAMPUS_OVERRIDES[campus]?.[code] ?? code;
}

function findIndicator(
  allData: Record<string, IndicatorData[]>,
  campus: Campus,
  code: string,
): IndicatorData | undefined {
  return (allData[campus] || []).find(ind => ind.meta.code === code);
}

function metaOf(ind: IndicatorData | undefined, code: string): IndicatorMeta | null {
  if (ind) return ind.meta;
  const m = INDICATOR_META[code];
  return m ? { code, ...m } : null;
}

/** 需要載入管制界限的 (campus, code) 清單（已去重；不適用者不列入） */
export function listApplicableLimitKeys(
  allData: Record<string, IndicatorData[]>,
): { campus: Campus; code: string; key: string }[] {
  const seen = new Set<string>();
  const out: { campus: Campus; code: string; key: string }[] = [];
  for (const page of MONTHLY_CARD_PAGES) {
    for (const { campus } of MONTHLY_CARD_CAMPUSES) {
      for (const baseCode of page.codes) {
        const code = resolveCardCode(campus, baseCode);
        const ind = findIndicator(allData, campus, code);
        const meta = metaOf(ind, code);
        if (!ind || !meta || !meta.campuses.includes(campus)) continue;
        const key = `${campus}|${code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ campus, code, key });
      }
    }
  }
  return out;
}

// ===== 主函式 =====

function buildCard(
  allData: Record<string, IndicatorData[]>,
  limitsByKey: LimitsByKey,
  campus: Campus,
  baseCode: string,
  anchor: AnchorMonth,
): MonthlyCard {
  const code = resolveCardCode(campus, baseCode);
  const ind = findIndicator(allData, campus, code);
  const meta = metaOf(ind, code);
  const name = MONTHLY_CARD_TITLE_OVERRIDES[code] ?? meta?.name ?? code;

  const emptyCard = (notApplicable: boolean): MonthlyCard => ({
    code,
    name,
    unit: meta?.unit ?? 'count',
    direction: meta?.direction ?? 'monitor',
    notApplicable,
    noData: !notApplicable,
    value: null,
    prevValue: null,
    yoyDelta: null,
    yoyTone: 'na',
    valueText: '—',
    prevText: '上月 —',
    yoyText: '— 去年',
    series: Array(SERIES_LEN).fill(null),
    band: null,
    alertMonths: Array(SERIES_LEN).fill(false),
    isAlert: false,
  });

  // 只有 meta.campuses 不含該院區才是「不適用」
  if (meta && !meta.campuses.includes(campus)) return emptyCard(true);
  // 院區適用但找不到資料（或未載入）→「無資料」
  if (!ind || !meta) return emptyCard(false);

  const byKey = new Map<string, MonthlyDataPoint>();
  for (const dp of ind.monthlyData) byKey.set(`${dp.year}-${dp.month}`, dp);
  const valueAt = (y: number, m: number) => monthValue(byKey.get(`${y}-${m}`), meta.dataNature);

  const months = Array.from({ length: SERIES_LEN }, (_, i) =>
    shiftMonth(anchor.year, anchor.month, i - (SERIES_LEN - 1)),
  );
  const series = months.map(m => valueAt(m.year, m.month));
  if (series.every(v => v === null)) return emptyCard(false);

  const value = valueAt(anchor.year, anchor.month);
  const prevM = shiftMonth(anchor.year, anchor.month, -1);
  const prevValue = valueAt(prevM.year, prevM.month);
  const lastYearValue = valueAt(anchor.year - 1, anchor.month);

  const yoy = computeYoy(value, lastYearValue, meta.unit, meta.direction);

  const isCcAlert = (a: { mechanism: string; severity: string }) =>
    a.mechanism === 'control_chart' && (a.severity === 'alert' || a.severity === 'warning');
  const alertSet = new Set<string>();
  for (const a of ind.monthlyAlerts ?? []) {
    if (isCcAlert(a)) alertSet.add(`${a.year}-${a.month}`);
  }
  const alertMonths = months.map(m => alertSet.has(`${m.year}-${m.month}`));

  return {
    code,
    name,
    unit: meta.unit,
    direction: meta.direction,
    notApplicable: false,
    noData: false,
    value,
    prevValue,
    yoyDelta: yoy.delta,
    yoyTone: yoy.tone,
    valueText: value === null ? '—' : formatValue(value, meta.unit),
    prevText: prevValue === null ? '上月 —' : `上月 ${formatValue(prevValue, meta.unit)}`,
    yoyText: yoy.text,
    series,
    band: buildBand(limitsByKey[`${campus}|${code}`], months),
    alertMonths,
    // anchor 月為 NA（0/0 或缺值）時不亮紅框：後端對 0/0 月仍可能產生 control_chart 警示，
    // 卡片會顯示「—」卻有紅框，月報上是誤導
    isAlert: alertMonths[SERIES_LEN - 1] && value !== null,
  };
}

function summarizeCategories(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const c of codes) {
    const cat = INDICATOR_META[c]?.category ?? '其他';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([k, v]) => `${k} ${v}`).join('、');
}

export function buildMonthlyCardSlides(
  allData: Record<string, IndicatorData[]>,
  limitsByKey: LimitsByKey,
  anchor: AnchorMonth,
): MonthlyCardSlideData[] {
  return MONTHLY_CARD_PAGES.map((page, pageIndex) => ({
    pageIndex,
    totalPages: MONTHLY_CARD_PAGES.length,
    title: page.title,
    year: anchor.year,
    month: anchor.month,
    categorySummary: summarizeCategories(page.codes),
    columns: MONTHLY_CARD_CAMPUSES.map(({ campus, label }) => ({
      campus,
      label,
      cards: page.codes.map(code => buildCard(allData, limitsByKey, campus, code, anchor)),
    })),
  }));
}
