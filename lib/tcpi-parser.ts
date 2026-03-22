/**
 * TCPI（台灣臨床成效指標）標竿報表解析器
 * 解析醫策會 TCPI 年值報表 Excel，擷取三個層級（醫學中心/區域醫院/地區醫院）的標竿值
 *
 * Excel 結構（2024-2025 年格式）：
 * - Row 0-3: 標題與表頭
 * - Row 4+: 資料列
 * - Col A(0): TCPI 代碼
 * - Col B(1): 指標名稱
 * - Col C(2): 單位（%、‰、一般）
 * - Col D(3): 比較群組（醫學中心/區域醫院/地區醫院/全部醫院）
 * - Col E(4): 第一年家數
 * - Col F(5): 第一年加權平均值
 * - Col G(6): 第二年家數
 * - Col H(7): 第二年加權平均值
 */

import * as XLSX from 'xlsx';
import { TCPI_CODE_TO_QIP, TCPI_NAME_TO_QIP, INDICATOR_META } from './constants';
import type { TCPIBenchmark, TCPIParseResult } from './types';

// 比較群組標準名稱
const GROUP_MEDICAL_CENTER = '醫學中心';
const GROUP_REGIONAL = '區域醫院';
const GROUP_DISTRICT = '地區醫院';

/**
 * 偵測 TCPI 報表年份（從第一行標題或 header 推斷）
 * 例如：「2024-2025年TCPI指標年值報表」→ [2024, 2025]
 */
function detectYears(data: unknown[][]): [number, number] | null {
  for (let i = 0; i < Math.min(4, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    for (const cell of row) {
      if (!cell) continue;
      const str = String(cell);
      // 匹配 "2024-2025" 或 "2024~2025" 等格式
      const match = str.match(/(\d{4})\s*[-~]\s*(\d{4})/);
      if (match) return [parseInt(match[1]), parseInt(match[2])];
    }
  }
  return null;
}

/**
 * 西元年轉民國年
 */
function toRocYear(adYear: number): number {
  return adYear - 1911;
}

/**
 * 解析 TCPI 單一數值（處理特殊值：N/A, NP, NQ, NR）
 */
function parseTcpiValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str || str === 'N/A' || str === 'NP' || str === 'NQ' || str === 'NR' || str === '-') {
    return null;
  }
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * 嘗試從 TCPI 代碼匹配 QIP 指標代碼
 */
function matchByCode(tcpiCode: string): string | null {
  return TCPI_CODE_TO_QIP[tcpiCode] ?? null;
}

/**
 * 嘗試從 TCPI 名稱匹配 QIP 指標代碼（精確 + 模糊）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function matchByName(tcpiName: string, tcpiCode: string): string | null {
  // 精確名稱匹配
  const exactMatch = TCPI_NAME_TO_QIP[tcpiName];
  if (exactMatch) return exactMatch;

  // 處理名稱前後空白和全半形差異
  const normalized = tcpiName.replace(/\s+/g, '').trim();
  for (const [key, code] of Object.entries(TCPI_NAME_TO_QIP)) {
    if (key.replace(/\s+/g, '').trim() === normalized) return code;
  }

  return null;
}

/**
 * 解析 TCPI Excel 檔案
 */
export function parseTcpiExcel(workbook: XLSX.WorkBook): TCPIParseResult {
  const errors: string[] = [];
  const benchmarks: TCPIBenchmark[] = [];
  const matchedQipCodes = new Set<string>();
  const unmatchedTcpiNames: string[] = [];

  // 取第一個工作表
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { benchmarks: [], matchedCount: 0, unmatchedTcpiNames: [], errors: ['無工作表'] };
  }

  const ws = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

  if (data.length < 5) {
    return { benchmarks: [], matchedCount: 0, unmatchedTcpiNames: [], errors: ['資料列不足'] };
  }

  // 偵測年份
  const years = detectYears(data);
  if (!years) {
    errors.push('無法偵測 TCPI 報表年份，將使用預設年份 113/114');
  }
  const [year1AD, year2AD] = years ?? [2024, 2025];
  const year1 = toRocYear(year1AD); // 113
  const year2 = toRocYear(year2AD); // 114

  // 收集每個 TCPI 指標的三個層級數據
  // key = tcpiCode, value = { medCenter, regional, district } for each year
  interface GroupedData {
    tcpiCode: string;
    tcpiName: string;
    qipCode: string;
    year1: { medicalCenter: number | null; regionalHospital: number | null; districtHospital: number | null };
    year2: { medicalCenter: number | null; regionalHospital: number | null; districtHospital: number | null };
  }

  const grouped = new Map<string, GroupedData>();

  for (let i = 4; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 6) continue;

    const tcpiCode = row[0] ? String(row[0]).trim() : '';
    const tcpiName = row[1] ? String(row[1]).trim() : '';
    const group = row[3] ? String(row[3]).trim() : '';

    if (!tcpiCode || !tcpiName) continue;
    if (group === '全部醫院') continue; // 跳過全部醫院

    // 嘗試匹配 QIP 指標
    const qipCode = matchByCode(tcpiCode) ?? matchByName(tcpiName, tcpiCode);
    if (!qipCode) continue; // 非 QIP 相關指標，跳過

    // 取得或建立分組資料
    if (!grouped.has(tcpiCode)) {
      grouped.set(tcpiCode, {
        tcpiCode,
        tcpiName,
        qipCode,
        year1: { medicalCenter: null, regionalHospital: null, districtHospital: null },
        year2: { medicalCenter: null, regionalHospital: null, districtHospital: null },
      });
    }

    const entry = grouped.get(tcpiCode)!;
    const val1 = parseTcpiValue(row[5]); // 第一年加權平均值
    const val2 = parseTcpiValue(row[7]); // 第二年加權平均值

    if (group === GROUP_MEDICAL_CENTER) {
      entry.year1.medicalCenter = val1;
      entry.year2.medicalCenter = val2;
    } else if (group === GROUP_REGIONAL) {
      entry.year1.regionalHospital = val1;
      entry.year2.regionalHospital = val2;
    } else if (group === GROUP_DISTRICT) {
      entry.year1.districtHospital = val1;
      entry.year2.districtHospital = val2;
    }
  }

  // 轉換為 TCPIBenchmark 陣列
  const groupedEntries = Array.from(grouped.values());
  for (const entry of groupedEntries) {
    matchedQipCodes.add(entry.qipCode);

    // 第一年
    if (entry.year1.medicalCenter !== null || entry.year1.regionalHospital !== null || entry.year1.districtHospital !== null) {
      benchmarks.push({
        indicatorCode: entry.qipCode,
        tcpiName: entry.tcpiName,
        year: year1,
        medicalCenter: entry.year1.medicalCenter,
        regionalHospital: entry.year1.regionalHospital,
        districtHospital: entry.year1.districtHospital,
      });
    }

    // 第二年
    if (entry.year2.medicalCenter !== null || entry.year2.regionalHospital !== null || entry.year2.districtHospital !== null) {
      benchmarks.push({
        indicatorCode: entry.qipCode,
        tcpiName: entry.tcpiName,
        year: year2,
        medicalCenter: entry.year2.medicalCenter,
        regionalHospital: entry.year2.regionalHospital,
        districtHospital: entry.year2.districtHospital,
      });
    }
  }

  // 檢查哪些可匹配的 QIP 指標沒有找到
  const expectedQipCodes = new Set(Object.values(TCPI_CODE_TO_QIP));
  const expectedCodesArr = Array.from(expectedQipCodes);
  for (const code of expectedCodesArr) {
    if (!matchedQipCodes.has(code)) {
      const meta = INDICATOR_META[code];
      unmatchedTcpiNames.push(`${code} ${meta?.name ?? '(未知)'}`);
    }
  }

  return {
    benchmarks,
    matchedCount: matchedQipCodes.size,
    unmatchedTcpiNames,
    errors,
  };
}

/**
 * 驗證是否為 TCPI 報表格式
 * 檢查第一行是否包含 "TCPI" 字樣
 */
export function isTcpiFormat(workbook: XLSX.WorkBook): boolean {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return false;

  const ws = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 }) as unknown[][];

  // 前 4 行包含 "TCPI" 或 "指標年值報表" 或含有 "比較群組" 欄位
  for (let i = 0; i < Math.min(4, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    for (const cell of row) {
      if (!cell) continue;
      const str = String(cell);
      if (str.includes('TCPI') || str.includes('指標年值報表')) return true;
    }
  }

  // 也檢查是否有「比較群組」欄位
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    for (const cell of row) {
      if (cell && String(cell).includes('比較群組')) return true;
    }
  }

  return false;
}
