import * as XLSX from 'xlsx';
import { IndicatorData, MonthlyDataPoint, YearlySummary, ParseResult } from './types';
import { INDICATOR_META } from './constants';

/**
 * 新竹醫院持續性監測指標 Excel 解析器
 *
 * 格式特徵：
 * - 單一 sheet，名稱含「新竹醫院」
 * - 橫向時間軸：欄位 = 月份（110年01月 ~ 115年N月），每年含 Q1-Q4 欄
 * - 每個比率指標佔 2 行（分子/分母），無預算比率值
 * - 計數指標可能為 加總+總計 或 單一行（F='-'）
 *
 * 欄位配置：
 * A=面向, B=序號, C=代碼, D=指標名稱, E=報表名稱, F=計算公式, G=子代碼, H=子名稱
 * I 以後 = 數據欄（月份/季度）
 */

// ── 時間欄位映射 ──

interface TimeCol {
  col: number;       // 0-based column index
  year: number;      // 民國年
  month: number;     // 1-12（月份）或 0（季度）
  quarter: number;   // 0（月份）或 1-4（季度）
}

function buildTimeColumns(sheet: XLSX.WorkSheet): TimeCol[] {
  const cols: TimeCol[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

  for (let c = 0; c <= range.e.c; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    const cell = sheet[cellRef];
    if (!cell || !cell.v) continue;

    const header = String(cell.v).trim();

    // 格式1: "110年01月" / "113年1月"
    const monthMatch = header.match(/(\d{3})年(\d{1,2})月/);
    if (monthMatch) {
      cols.push({
        col: c,
        year: parseInt(monthMatch[1]),
        month: parseInt(monthMatch[2]),
        quarter: 0,
      });
      continue;
    }

    // 格式2: "111年Q1" / "113Q2"
    const quarterMatch = header.match(/(\d{3})年?Q(\d)/);
    if (quarterMatch) {
      cols.push({
        col: c,
        year: parseInt(quarterMatch[1]),
        month: 0,
        quarter: parseInt(quarterMatch[2]),
      });
      continue;
    }

    // 格式3: 純 "Q1"（屬於前面最近的年度）
    const pureQ = header.match(/^Q(\d)$/);
    if (pureQ && cols.length > 0) {
      const lastYear = cols[cols.length - 1].year;
      cols.push({
        col: c,
        year: lastYear,
        month: 0,
        quarter: parseInt(pureQ[1]),
      });
    }
  }

  return cols;
}

// ── 指標 block 結構 ──

interface IndicatorBlock {
  code: string;
  name: string;
  startRow: number;          // 0-based
  formulaType: 'ratio' | 'count_total' | 'count_single';
  numeratorRow: number;      // 分子行 (0-based)
  denominatorRow?: number;   // 分母行 (ratio only)
  totalRow?: number;         // 總計行 (count_total only)
  valueRow?: number;         // 直接數值行 (count_single only)
}

function identifyBlocks(rows: unknown[][]): IndicatorBlock[] {
  const blocks: IndicatorBlock[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[2] || '').trim(); // C 欄
    if (!code.match(/^HA\d{2}-\d{2}$/)) continue;

    const name = String(row[3] || '').replace(/\n/g, ' ').trim(); // D 欄
    const formula = String(row[5] || '').trim(); // F 欄

    if (formula === '分子') {
      // 比率指標：下一行應為分母
      let denomRow: number | undefined;
      for (let j = i + 1; j < rows.length; j++) {
        const nextCode = String(rows[j][2] || '').trim();
        if (nextCode.match(/^HA\d{2}-\d{2}$/)) break; // 下一個指標
        const nextF = String(rows[j][5] || '').trim();
        if (nextF === '分母') {
          denomRow = j;
          break;
        }
      }
      blocks.push({
        code, name, startRow: i,
        formulaType: 'ratio',
        numeratorRow: i,
        denominatorRow: denomRow,
      });
    } else if (formula === '加總') {
      // 計數指標（含子項）：往下找「總計」
      let totalRow: number | undefined;
      for (let j = i + 1; j < rows.length; j++) {
        const nextCode = String(rows[j][2] || '').trim();
        if (nextCode.match(/^HA\d{2}-\d{2}$/)) break;
        const nextF = String(rows[j][5] || '').replace(/\s+/g, '').trim();
        if (nextF === '總計') {
          totalRow = j;
          break;
        }
      }
      blocks.push({
        code, name, startRow: i,
        formulaType: 'count_total',
        numeratorRow: i,
        totalRow,
      });
    } else if (formula === '-') {
      // 計數指標（單一值）
      blocks.push({
        code, name, startRow: i,
        formulaType: 'count_single',
        numeratorRow: i,
        valueRow: i,
      });
    }
  }

  return blocks;
}

// ── 數值讀取 ──

function readNumericValue(row: unknown[], colIdx: number): number | null {
  if (colIdx >= row.length) return null;
  const raw = row[colIdx];
  if (raw === '' || raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  const str = String(raw).trim();
  if (['NR', 'NP', 'N/A', '-', ''].includes(str)) return null;
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

// ── 主解析函式 ──

export function parseHsinchuExcel(workbook: XLSX.WorkBook): ParseResult {
  const errors: string[] = [];
  const indicators: IndicatorData[] = [];

  // 找到新竹 sheet
  const sheetName = workbook.SheetNames.find(n => n.includes('新竹'));
  if (!sheetName) {
    errors.push('找不到新竹醫院的工作表');
    return { indicators, errors };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) {
    errors.push('工作表無資料列');
    return { indicators, errors };
  }

  // 建立時間欄位映射
  const timeCols = buildTimeColumns(sheet);
  if (timeCols.length === 0) {
    errors.push('無法解析時間欄位（表頭）');
    return { indicators, errors };
  }

  // 只取月份欄（排除季度欄）
  const monthlyCols = timeCols.filter(tc => tc.month > 0);
  const quarterlyCols = timeCols.filter(tc => tc.quarter > 0);

  // 取得涵蓋的所有年度
  const allYears = Array.from(new Set(monthlyCols.map(tc => tc.year))).sort();

  // 識別指標 block
  const blocks = identifyBlocks(rows);

  for (const block of blocks) {
    const meta = INDICATOR_META[block.code];
    if (!meta) {
      errors.push(`找不到指標元資料: ${block.code} (${block.name})`);
      continue;
    }

    // 收集所有月份資料點
    const allMonthly: MonthlyDataPoint[] = [];

    if (block.formulaType === 'ratio' && block.denominatorRow !== undefined) {
      // ── 比率指標：從分子/分母計算比率 ──
      const numRow = rows[block.numeratorRow];
      const denRow = rows[block.denominatorRow];

      // 判斷使用月份欄或季度欄
      const isQuarterly = meta.isQuarterly;
      const targetCols = isQuarterly ? quarterlyCols : monthlyCols;

      for (const tc of targetCols) {
        const numerator = readNumericValue(numRow, tc.col);
        const denominator = readNumericValue(denRow, tc.col);

        let value: number | null = null;
        if (numerator !== null && denominator !== null && denominator > 0) {
          const rawRatio = numerator / denominator;
          if (meta.unit === 'percent') {
            value = rawRatio * 100;
          } else if (meta.unit === 'permille') {
            value = rawRatio * 1000;
          } else {
            value = rawRatio;
          }
        } else if (numerator !== null && (denominator === null || denominator === 0)) {
          // 分母為 0 或空：分子也為 0 時比率為 0，否則為 null
          if (numerator === 0) value = 0;
        }

        const month = isQuarterly
          ? [0, 1, 4, 7, 10][tc.quarter] || tc.quarter
          : tc.month;

        const dp: MonthlyDataPoint = {
          year: tc.year,
          month,
          value,
        };
        if (numerator !== null) dp.numerator = numerator;
        if (denominator !== null) dp.denominator = denominator;

        allMonthly.push(dp);
      }
    } else if (block.formulaType === 'count_total' && block.totalRow !== undefined) {
      // ── 計數指標（總計行） ──
      const totalRow = rows[block.totalRow];

      for (const tc of monthlyCols) {
        const value = readNumericValue(totalRow, tc.col);
        allMonthly.push({ year: tc.year, month: tc.month, value });
      }
    } else if (block.formulaType === 'count_single' && block.valueRow !== undefined) {
      // ── 計數指標（單一值行） ──
      const valRow = rows[block.valueRow];

      for (const tc of monthlyCols) {
        const value = readNumericValue(valRow, tc.col);
        allMonthly.push({ year: tc.year, month: tc.month, value });
      }
    } else {
      // 找不到配對行
      if (block.formulaType === 'ratio') {
        errors.push(`${block.code}: 找不到分母行`);
      } else {
        errors.push(`${block.code}: 找不到總計行`);
      }
      continue;
    }

    // 建立年度摘要（benchmark 為 null，等候後續匯入）
    const yearlySummaries: YearlySummary[] = allYears.map(year => {
      const yearPoints = allMonthly.filter(
        dp => dp.year === year && dp.value !== null
      );
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

    // 找最新有值的月份
    let latestValue: number | null = null;
    let latestMonth: string | null = null;
    const sorted = allMonthly
      .filter(dp => dp.value !== null)
      .sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month);
    if (sorted.length > 0) {
      latestValue = sorted[0].value;
      latestMonth = `${sorted[0].year}.${String(sorted[0].month).padStart(2, '0')}`;
    }

    indicators.push({
      meta: { code: block.code, ...meta },
      campus: '新竹',
      monthlyData: allMonthly,
      yearlySummaries,
      latestValue,
      latestMonth,
      status: 'neutral',
      trend: 'flat',
      benchmarkValue: null,
      peerValue: null,
      peerYear: null,
      anomalies: [],
      controlChart: null,
    });
  }

  return { indicators, errors };
}

/**
 * 偵測 workbook 是否為新竹醫院格式
 */
export function isHsinchuFormat(workbook: XLSX.WorkBook): boolean {
  return workbook.SheetNames.some(name => name.includes('新竹'));
}
