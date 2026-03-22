import { INDICATOR_META } from './constants';
import { Campus } from './types';

interface CleanResult {
  value: number | null;
  hadSymbol: boolean; // 原始值是否帶有 % 或 ‰ 符號
  numerator?: number;    // 從 (n/d) 格式提取的分子
  denominator?: number;  // 從 (n/d) 格式提取的分母
}

/**
 * 清洗原始 Excel 儲存格值，回傳統一的數值
 * 所有比率類指標統一以「百分比數值」儲存（如 2.13 表示 2.13%）
 * 千分比指標以「千分比數值」儲存（如 0.73 表示 0.73‰）
 * 絕對數指標直接儲存原始值
 */
export function cleanValueRaw(raw: unknown): CleanResult {
  if (raw === '' || raw === null || raw === undefined) return { value: null, hadSymbol: false };

  let str = String(raw).trim();
  let numerator: number | undefined;
  let denominator: number | undefined;

  // 處理 110 年合併格式：「3.27%\n(9/275)」→ 取第一行，並提取分子/分母
  if (str.includes('\n')) {
    const parts = str.split('\n');
    for (let p = 1; p < parts.length; p++) {
      const fracMatch = parts[p].trim().match(/\(?(\d+)\s*\/\s*(\d+)\)?/);
      if (fracMatch) {
        numerator = parseInt(fracMatch[1]);
        denominator = parseInt(fracMatch[2]);
        break;
      }
    }
    str = parts[0].trim();
  }

  // 無資料標記
  if (['NR', 'NP', 'N/A', '-', ''].includes(str)) return { value: null, hadSymbol: false };

  // 分子/分母格式（跳過）
  if (/^\(?\d+\/\d+\)?$/.test(str)) return { value: null, hadSymbol: false };

  // 移除 ‰ 和 % 符號，記錄原始單位
  const hasPermille = str.includes('‰');
  const hasPercent = str.includes('%');
  const hadSymbol = hasPermille || hasPercent;
  const cleaned = str.replace(/‰/g, '').replace(/%/g, '').trim();

  const num = parseFloat(cleaned);
  if (isNaN(num)) return { value: null, hadSymbol: false };

  return { value: num, hadSymbol, numerator, denominator };
}

/** 簡化版：只回傳數值 */
export function cleanValue(raw: unknown): number | null {
  return cleanValueRaw(raw).value;
}

/**
 * 正規化月份值
 * 根據年度、院區、是否帶符號判斷是否需要轉換
 *
 * 資料格式差異（經 Excel 實測 + 異常值驗證，第三版修正）：
 *
 * 【竹北】
 * - 110年：百分比帶 % 符號，千分比帶 ‰ → hadSymbol 處理
 * - 111-113年：百分比/千分比均為比率格式（無 %/‰ 符號）
 *   → 需 ×100（百分比和千分比統一以「百分比尺度」儲存）
 *   部分儲存格有 cell.z % 格式 → parser 已用 cell.w → hadSymbol 處理（不受影響）
 * - 114-115年：已為顯示值（2.12%、3.31‰），不帶符號 → 直接使用
 *
 * 【竹東】
 * - 110年：百分比帶 % 符號，千分比帶 ‰ → hadSymbol 處理
 * - 111年以後（含111-115）：百分比/千分比均為比率格式，
 *   竹東從未切換為顯示格式 → 需 ×100
 *   部分千分比帶 ‰ 符號 → hadSymbol 處理（不受影響）
 *
 * 關鍵：isRawRatio 範圍內的百分比和千分比指標都是「百分比尺度」比率，
 * 統一 ×100 即可得到正確的顯示值。
 * 例：竹東 HA02-13（千分比）0.2273 × 100 = 22.73‰
 */
export function normalizeMonthlyValue(
  value: number | null,
  indicatorCode: string,
  year: number,
  campus: Campus,
  hadSymbol: boolean,
): number | null {
  if (value === null || value === 0) return value;

  const meta = INDICATOR_META[indicatorCode];
  if (!meta) return value;

  if (meta.unit === 'count' || meta.unit === 'ratio') return value;

  // 如果原始值帶有 % 或 ‰ 符號，已是顯示格式
  if (hadSymbol) return value;

  // 新竹院區：由 hsinchu-parser 直接從分子/分母計算比率，不經此函式
  // 若未來有新竹數據走此路徑，值已為顯示格式，不需轉換
  if (campus === '新竹') return value;

  // ── 已知「比率格式」年度/院區：統一 ×100（百分比和千分比皆適用）──
  // 竹東：111年以後全部為比率格式（從未切換為顯示格式）
  // 竹北：111-113年為比率格式（部分有 cell.z % 已由 hadSymbol 處理）
  //       114年以後為顯示格式
  const isRawRatio =
    (campus === '竹東' && year >= 111) ||
    (campus === '竹北' && year >= 111 && year <= 113);

  if (isRawRatio && value <= 1) {
    return value * 100;
  }

  // ── 非比率格式範圍的千分比回退邏輯 ──
  // 主要處理 110年 或其他年度缺少 ‰ 符號的罕見情況
  // 原始比率特徵：值極小（< 0.1），如 0.0048 = 4.8‰
  if (meta.unit === 'permille' && value > 0 && value < 0.1) {
    return value * 1000;
  }

  return value;
}

/**
 * 判定年平均值的單位並統一為顯示值
 * 年平均值通常為小數比率（如 0.0198），需轉換為百分比（1.98）
 *
 * @deprecated 年平均值現在從月資料重新計算，不再需要此函式。
 *             保留供未來可能的回退使用。
 */
export function normalizeYearAverage(value: number | null, indicatorCode: string): number | null {
  if (value === null) return null;

  const meta = INDICATOR_META[indicatorCode];
  if (!meta) return value;

  if (meta.unit === 'count' || meta.unit === 'ratio') {
    return value;
  }

  if (meta.unit === 'permille') {
    // 年均值若為小數（如 0.0169），轉換為千分比
    if (value > 0 && value < 1) {
      return value * 1000;
    }
    return value;
  }

  // percent 指標
  if (value > 0 && value < 1) {
    return value * 100;
  }

  return value;
}

/**
 * 標竿值的單位統一
 *
 * 邏輯與 normalizeMonthlyValue 一致：
 *
 * 【竹北】
 * - 110-113年：百分比/千分比標竿為比率格式 → value < 1 時 ×100
 * - 114年以後：已為顯示格式 → 直接使用
 *
 * 【竹東】
 * - 所有年度：百分比/千分比標竿為比率格式 → value < 1 時 ×100
 *   竹東從未切換為顯示格式
 *
 * 使用 value < 1 啟發式判斷：比率格式值（如 0.0312）一定 < 1，
 * 已轉換的顯示值（如 3.12）通常 >= 1
 */
export function normalizeBenchmark(value: number | null, indicatorCode: string, year: number, campus: Campus): number | null {
  if (value === null) return null;

  const meta = INDICATOR_META[indicatorCode];
  if (!meta) return value;

  if (meta.unit === 'count' || meta.unit === 'ratio') {
    return value;
  }

  // 新竹：benchmark 由獨立報表匯入，值已為顯示格式
  if (campus === '新竹') return value;

  // 竹北 114+ 已為顯示格式（百分比和千分比都不需轉換）
  if (campus === '竹北' && year >= 114) {
    return value;
  }

  // 竹東所有年度 + 竹北 110-113：比率格式 → value < 1 時 ×100
  // 百分比和千分比統一以「百分比尺度」儲存
  if (value > 0 && value < 1) {
    return value * 100;
  }

  return value;
}
