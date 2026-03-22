import * as XLSX from 'xlsx';
import { Campus, IndicatorData, MonthlyDataPoint, YearlySummary, ParseResult, Category } from './types';
import { INDICATOR_META, NAME_TO_CODE } from './constants';
import { cleanValue, cleanValueRaw, normalizeMonthlyValue, normalizeBenchmark } from './data-cleaner';
import { matchIndicatorName } from './matching/matchingEngine';
import { isHsinchuFormat, parseHsinchuExcel } from './hsinchu-parser';

interface SheetInfo {
  year: number;
  campus: Campus | null;
}

interface RawIndicatorRow {
  code: string;
  name: string;
  category: string;
  campus: Campus;
  year: number;
  monthlyValues: MonthlyDataPoint[];
  yearAvg: number | null;
  benchmarkRegional: number | null;
  benchmarkDistrict: number | null;
}

function parseSheetName(name: string): SheetInfo {
  const yearMatch = name.match(/(\d{3})年/);
  const year = yearMatch ? parseInt(yearMatch[1]) : 0;

  if (name.includes('竹北') && name.includes('竹東')) {
    return { year, campus: null }; // 合併表
  }
  if (name.includes('竹北')) return { year, campus: '竹北' };
  if (name.includes('竹東')) return { year, campus: '竹東' };
  return { year, campus: null };
}

function resolveCode(rawCode: string, rawName: string): string {
  if (rawCode && rawCode.match(/^HA\d{2}-\d{2}$/)) {
    return rawCode;
  }

  // 110年無指標代碼，透過名稱比對
  const cleanName = rawName.trim();

  // Layer 1: 直接比對
  if (NAME_TO_CODE[cleanName]) return NAME_TO_CODE[cleanName];

  // Layer 2: 部分比對（名稱可能被截斷）
  for (const [key, code] of Object.entries(NAME_TO_CODE)) {
    if (cleanName.startsWith(key) || key.startsWith(cleanName)) {
      return code;
    }
  }

  // Layer 3: 模糊比對引擎（處理全半形、同義字、相似度）
  const match = matchIndicatorName(cleanName);
  if (match.indicatorCode && match.confidence !== 'unrecognized') {
    return match.indicatorCode;
  }

  return '';
}

function getCategoryFromName(rawCategory: string): Category | null {
  const mapping: Record<string, Category> = {
    '整體照護': '整體照護',
    '加護照護': '加護照護',
    '手術照護': '手術照護',
    '產科照護': '產科照護',
    '急診照護': '急診照護',
    '重點照護': '重點照護',
    '感染管制': '感染管制',
    '用藥安全': '用藥安全',
    '呼吸照護': '呼吸照護',
    '經營管理': '經營管理',
  };
  const cleaned = rawCategory.trim();
  return mapping[cleaned] || null;
}

export function parseQIPExcel(workbook: XLSX.WorkBook): ParseResult {
  // 偵測新竹醫院格式 → 使用專用解析器
  if (isHsinchuFormat(workbook)) {
    return parseHsinchuExcel(workbook);
  }

  const dataMap = new Map<string, { rows: RawIndicatorRow[] }>();
  const errors: string[] = [];
  const ndComputedPoints = new Set<string>(); // 追蹤由 n/d 計算的資料點

  for (const sheetName of workbook.SheetNames) {
    const { year, campus } = parseSheetName(sheetName);

    // 跳過合併工作表
    if (!campus) continue;
    if (year === 0) {
      errors.push(`無法解析工作表年度: ${sheetName}`);
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) continue;

    // 判斷欄位結構
    const headerRow = rows[0] as string[];
    const is110 = year === 110;

    // 110年: 類別(0) NO(1) 指標名稱(2) 月份(3-14) 標竿(15-16)
    // 111-115年: 類別(0) NO(1) 指標代碼(2) 指標名稱(3) 月份(4-15) ...後面的欄位
    const codeCol = is110 ? -1 : 2;
    const nameCol = is110 ? 2 : 3;
    const monthStart = is110 ? 3 : 4;
    const monthEnd = monthStart + 12; // exclusive

    let currentCategory = '';

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];

      // 更新面向分類
      const cat = String(row[0] || '').trim();
      if (cat) {
        const resolved = getCategoryFromName(cat);
        if (resolved) currentCategory = resolved;
      }

      // 判斷是否為指標行：Col B (NO) 為正整數
      const no = row[1];
      if (typeof no !== 'number' || no !== Math.floor(no) || no <= 0) continue;

      // 提取指標代碼和名稱
      const rawCode = is110 ? '' : String(row[codeCol] || '').trim();
      const rawName = String(row[nameCol] || '').trim();
      const code = resolveCode(rawCode, rawName);

      if (!code) {
        errors.push(`無法解析指標代碼: year=${year} campus=${campus} NO=${no} name=${rawName}`);
        continue;
      }

      // ── Step A: 預提取相鄰列 n/d（111-115年格式） ──
      // 110年格式為同儲存格 "2.13%\n(26/1223)"，由 cleanValueRaw 提取。
      // 111年以後改為下一行放 "(26/1223)"，需預先讀取。
      const adjacentND: ({ numerator: number; denominator: number } | null)[] = new Array(12).fill(null);
      if (!is110 && i + 1 < rows.length) {
        const nextRow = rows[i + 1] as unknown[];
        const nextNo = nextRow[1];
        const isNdRow = nextNo === '' || nextNo === undefined || nextNo === null ||
          (typeof nextNo === 'string' && nextNo.trim() === '');
        if (isNdRow) {
          for (let m = 0; m < 12; m++) {
            const colIdx = monthStart + m;
            if (colIdx < nextRow.length) {
              const ndStr = String(nextRow[colIdx] || '').trim();
              const fracMatch = ndStr.match(/\(?(\d+)\s*\/\s*(\d+)\)?/);
              if (fracMatch) {
                adjacentND[m] = {
                  numerator: parseInt(fracMatch[1]),
                  denominator: parseInt(fracMatch[2]),
                };
              }
            }
          }
        }
      }

      // ── Step B: 判斷是否為比率類指標（可從 n/d 計算） ──
      const meta = INDICATOR_META[code];
      const isRateIndicator = meta != null && (
        meta.dataNature === 'binomial_rate' || meta.dataNature === 'poisson_rate'
      );

      // ── Step C: 逐月提取值 ──
      const monthlyValues: MonthlyDataPoint[] = [];
      for (let m = 0; m < 12; m++) {
        const colIdx = monthStart + m;
        let raw: unknown = colIdx < row.length ? row[colIdx] : '';

        // 修正 Excel 百分比/千分比格式儲存格：
        // xlsx 對數值型儲存格（cell.t='n'）回傳原始小數（如 0.0327），
        // 但 Excel 顯示為 "3.27%"。改用格式化文字讓 cleanValueRaw 正確偵測 hadSymbol。
        const cellRef = XLSX.utils.encode_cell({ r: i, c: colIdx });
        const cell = sheet[cellRef];
        if (cell && cell.t === 'n' && cell.z && (cell.z.includes('%') || cell.z.includes('‰'))) {
          raw = cell.w || raw;
        }

        const { value: rawVal, hadSymbol, numerator: inCellNum, denominator: inCellDen } = cleanValueRaw(raw);

        // 合併 n/d 來源：110年同儲存格 or 111+年相鄰列
        let numerator: number | undefined = inCellNum;
        let denominator: number | undefined = inCellDen;
        if (adjacentND[m]) {
          numerator = adjacentND[m]!.numerator;
          denominator = adjacentND[m]!.denominator;
        }

        // ── 計算值 ──
        let value: number | null = null;
        let computedFromND = false;

        if (isRateIndicator && numerator !== undefined && denominator !== undefined && denominator > 0) {
          // 主路徑：從 n/d 計算比率（與 hsinchu-parser 一致）
          const rawRatio = numerator / denominator;
          if (meta.unit === 'percent') {
            value = rawRatio * 100;
          } else if (meta.unit === 'permille') {
            value = rawRatio * 1000;
          } else {
            value = rawRatio;
          }
          computedFromND = true;
        } else if (isRateIndicator && numerator !== undefined && numerator === 0 &&
                   (denominator === undefined || denominator === 0)) {
          // 分子為 0，分母缺失或為 0 → 比率為 0
          value = 0;
          computedFromND = true;
        } else {
          // 退回路徑：使用儲存格值 + normalizeMonthlyValue
          value = normalizeMonthlyValue(rawVal, code, year, campus, hadSymbol);
        }

        if (computedFromND) {
          ndComputedPoints.add(`${code}_${campus}_${year}_${m + 1}`);
        }

        const dp: MonthlyDataPoint = {
          year,
          month: m + 1,
          value,
        };
        if (numerator !== undefined && denominator !== undefined) {
          dp.numerator = numerator;
          dp.denominator = denominator;
        }
        monthlyValues.push(dp);
      }

      // 年平均值和標竿值 — 因年度和欄位結構不同需分別處理
      let yearAvg: number | null = null;
      let benchmarkRegional: number | null = null;
      let benchmarkDistrict: number | null = null;

      if (is110) {
        // 110年: Col 15=區域醫院平均值, Col 16=地區醫院平均值
        benchmarkRegional = cleanValue(row[15]);
        benchmarkDistrict = cleanValue(row[16]);
      } else {
        // 111-115年: 月份後面的欄位
        const afterMonths = monthEnd; // 第16個欄位
        // 欄位配置因年度而不同，但通常:
        // Col 16 = 本年度平均值/成果
        yearAvg = cleanValue(row[afterMonths]);

        // 剩餘欄位依據表頭解析
        // 竹北: 上年平均, 前年平均, 區域醫院, 地區醫院
        // 竹東: 上年成果, 區域醫院, 地區醫院, ...

        // 尋找標竿值 — 從表頭中找「區域醫院」和「地區醫院」
        for (let c = afterMonths + 1; c < headerRow.length; c++) {
          const h = String(headerRow[c] || '').replace(/\n/g, '');
          if (h.includes('區域醫院') && benchmarkRegional === null) {
            benchmarkRegional = cleanValue(row[c]);
          } else if (h.includes('地區醫院') && benchmarkDistrict === null) {
            benchmarkDistrict = cleanValue(row[c]);
          }
        }

        // 如果在表頭中沒找到，嘗試根據固定位置
        if (benchmarkRegional === null && headerRow.length > afterMonths + 3) {
          // 通常倒數第2和倒數第1欄為標竿
          const lastCol = headerRow.length - 1;
          const secondLast = lastCol - 1;
          const hLast = String(headerRow[lastCol] || '').replace(/\n/g, '');
          const hSecondLast = String(headerRow[secondLast] || '').replace(/\n/g, '');

          if (hSecondLast.includes('區域') || hSecondLast.includes('標竿')) {
            benchmarkRegional = cleanValue(row[secondLast]);
          }
          if (hLast.includes('地區') || hLast.includes('標竿')) {
            benchmarkDistrict = cleanValue(row[lastCol]);
          }
        }
      }

      const key = `${code}_${campus}`;
      if (!dataMap.has(key)) {
        dataMap.set(key, { rows: [] });
      }

      dataMap.get(key)!.rows.push({
        code,
        name: rawName,
        category: currentCategory,
        campus,
        year,
        monthlyValues,
        yearAvg,
        benchmarkRegional,
        benchmarkDistrict,
      });
    }
  }

  // 合併所有年度的數據
  const indicators: IndicatorData[] = [];

  const entries = Array.from(dataMap.values());
  for (let ei = 0; ei < entries.length; ei++) {
    const { rows } = entries[ei];
    if (rows.length === 0) continue;

    const code = rows[0].code;
    const campus = rows[0].campus;
    const meta = INDICATOR_META[code];

    if (!meta) {
      errors.push(`找不到指標元資料: ${code}`);
      continue;
    }

    // 合併月份數據
    const allMonthly: MonthlyDataPoint[] = [];
    const yearlySummaries: YearlySummary[] = [];

    // 按年度排序
    const sortedRows = rows.sort((a, b) => a.year - b.year);

    for (const row of sortedRows) {
      allMonthly.push(...row.monthlyValues);

      yearlySummaries.push({
        year: row.year,
        average: null, // 從月資料重新計算（見下方 recalculate 邏輯）
        benchmarkRegional: normalizeBenchmark(row.benchmarkRegional, code, row.year, row.campus),
        benchmarkDistrict: normalizeBenchmark(row.benchmarkDistrict, code, row.year, row.campus),
      });
    }

    // 找最新有值的月份
    let latestValue: number | null = null;
    let latestMonth: string | null = null;
    const sortedMonthly = allMonthly.slice().sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    for (const mp of sortedMonthly) {
      if (mp.value !== null) {
        latestValue = mp.value;
        latestMonth = `${mp.year}.${String(mp.month).padStart(2, '0')}`;
        break;
      }
    }

    // 找最新的標竿值（竹北→區域醫院、竹東→地區醫院、新竹→暫無，待後續匯入）
    let benchmarkValue: number | null = null;
    const latestSummary = yearlySummaries[yearlySummaries.length - 1];
    if (latestSummary && campus !== '新竹') {
      if (campus === '竹北') {
        benchmarkValue = latestSummary.benchmarkRegional;
      } else {
        benchmarkValue = latestSummary.benchmarkDistrict ?? latestSummary.benchmarkRegional;
      }
    }
    // 如果最新年度沒有標竿，往回找
    if (benchmarkValue === null && campus !== '新竹') {
      for (let i = yearlySummaries.length - 1; i >= 0; i--) {
        const s = yearlySummaries[i];
        const bv = campus === '竹北'
          ? (s.benchmarkRegional ?? s.benchmarkDistrict)
          : (s.benchmarkDistrict ?? s.benchmarkRegional);
        if (bv !== null) {
          benchmarkValue = bv;
          break;
        }
      }
    }

    indicators.push({
      meta: { code, ...meta },
      campus,
      monthlyData: allMonthly,
      yearlySummaries,
      latestValue,
      latestMonth,
      status: 'neutral',
      trend: 'flat',
      benchmarkValue,
      peerValue: benchmarkValue,
      peerYear: null,
      anomalies: [],
      controlChart: null,
    });
  }

  // 異常值驗證：偵測可能的單位轉換錯誤（n/d 計算的資料點只報告不修正）
  validateOutliers(indicators, errors, ndComputedPoints);

  // 用修正後的月資料重新計算每年平均值（必須在 validateOutliers 之後，確保值已修正）
  for (const ind of indicators) {
    for (const summary of ind.yearlySummaries) {
      const yearPoints = ind.monthlyData.filter(
        dp => dp.year === summary.year && dp.value !== null
      );
      if (yearPoints.length > 0) {
        summary.average = yearPoints.reduce((sum, dp) => sum + dp.value!, 0) / yearPoints.length;
      } else {
        // 該年無任何有效月資料 → 不顯示平均值（不信任 Excel 的 yearAvg）
        summary.average = null;
      }
    }

    // 同步更新 latestValue（可能也被 validateOutliers 修正過）
    const sorted = ind.monthlyData
      .slice()
      .sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month);
    for (const mp of sorted) {
      if (mp.value !== null) {
        ind.latestValue = mp.value;
        ind.latestMonth = `${mp.year}.${String(mp.month).padStart(2, '0')}`;
        break;
      }
    }
  }

  return { indicators, errors };
}

/**
 * 偵測並自動修正異常值
 *
 * n/d 計算的資料點：只報告警告，不自動修正（數學計算正確，若有異常是原始資料問題）
 * fallback 路徑的資料點：保留自動修正邏輯
 *
 * 值過大（> 中位數 20 倍）：
 *   若非 n/d 計算且 ÷100 後落在中位數的 1/5 ~ 5 倍範圍 → 自動修正（疑似誤 ×100）
 *   否則僅回報警告
 *
 * 值過小（< 中位數 1/20）：
 *   僅回報警告，不自動修正（可能是真實低值）
 *
 * 修正後同步更新 latestValue
 */
function validateOutliers(indicators: IndicatorData[], errors: string[], ndComputedPoints: Set<string>): void {
  const OUTLIER_THRESHOLD = 20;
  const CORRECTION_TOLERANCE = 5; // 修正後值須在中位數 1/5 ~ 5 倍之間

  const correctedIndicators = new Set<IndicatorData>();

  for (const ind of indicators) {
    if (ind.meta.unit !== 'percent' && ind.meta.unit !== 'permille') continue;

    const values = ind.monthlyData
      .filter(dp => dp.value !== null && dp.value > 0)
      .map(dp => dp.value as number);

    if (values.length < 3) continue;

    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (median === 0) continue;

    for (const dp of ind.monthlyData) {
      if (dp.value === null || dp.value === 0) continue;

      const ndKey = `${ind.meta.code}_${ind.campus}_${dp.year}_${dp.month}`;
      const wasComputedFromND = ndComputedPoints.has(ndKey);

      const ratio = dp.value / median;

      if (ratio > OUTLIER_THRESHOLD) {
        if (wasComputedFromND) {
          // n/d 計算的值：只報告警告，不自動修正
          errors.push(
            `⚠ 異常值（n/d 計算）: ${ind.meta.code} ${ind.campus} ${dp.year}年${dp.month}月 ` +
            `值=${dp.value} (中位數=${median.toFixed(4)}，為中位數的${ratio.toFixed(1)}倍，` +
            `n=${dp.numerator ?? '?'} d=${dp.denominator ?? '?'}，請確認原始數據)`
          );
        } else {
          // fallback 路徑的值：保留自動修正邏輯
          const corrected = dp.value / 100;
          const correctedRatio = corrected / median;

          if (correctedRatio >= 1 / CORRECTION_TOLERANCE && correctedRatio <= CORRECTION_TOLERANCE) {
            const original = dp.value;
            dp.value = corrected;
            correctedIndicators.add(ind);
            errors.push(
              `✅ 自動修正: ${ind.meta.code} ${ind.campus} ${dp.year}年${dp.month}月 ` +
              `${original} → ${corrected} (÷100，原值為中位數的${ratio.toFixed(1)}倍)`
            );
          } else {
            errors.push(
              `⚠ 異常值: ${ind.meta.code} ${ind.campus} ${dp.year}年${dp.month}月 ` +
              `值=${dp.value} (中位數=${median.toFixed(4)}，為中位數的${ratio.toFixed(1)}倍，疑似單位轉換問題)`
            );
          }
        }
      } else if (ratio < 1 / OUTLIER_THRESHOLD) {
        const source = wasComputedFromND ? '（n/d 計算）' : '';
        errors.push(
          `⚠ 異常值${source}: ${ind.meta.code} ${ind.campus} ${dp.year}年${dp.month}月 ` +
          `值=${dp.value} (中位數=${median.toFixed(4)}，僅為中位數的${(ratio * 100).toFixed(2)}%，疑似單位轉換問題)`
        );
      }
    }
  }

  // 重新計算被修正指標的 latestValue
  const correctedArray = Array.from(correctedIndicators);
  for (let ci = 0; ci < correctedArray.length; ci++) {
    const ind = correctedArray[ci];
    const sortedMonthly = [...ind.monthlyData]
      .filter(dp => dp.value !== null)
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });
    if (sortedMonthly.length > 0) {
      ind.latestValue = sortedMonthly[0].value;
    }
  }
}
