/**
 * Parser for the "[警告] … n/d 計算值 … 與儲存格顯示值 … 差異 …" lines the
 * backend writes into an import log when a rate indicator's n/d-computed value
 * and the value shown in the cell disagree by more than 3×
 * (backend/apps/imports/services/excel_parser.py, "Sanity check").
 *
 * The import page shows three correction buttons for every line this function
 * recognises, so the pattern has to accept exactly what the backend emits.
 * `n` and `d` are Python floats there (`(n=1.0, d=133.0)`), which is why they
 * are matched as decimals and read with parseFloat.
 */
export interface WarningInfo {
  indicatorCode: string;
  campus: string;
  year: number;
  month: number;
  computedValue: number;
  cellValue: number;
  /** Numerator as written in the line; absent if the line carries no (n=…, d=…). */
  numerator?: number;
  /** Denominator as written in the line; absent if the line carries no (n=…, d=…). */
  denominator?: number;
}

// Everything the buttons need; the text after 差異 only explains the ratio.
const CORE_RE =
  /^\[警告\] (\S+) (\S+) (\d+)年(\d+)月: n\/d 計算值 (\d+(?:\.\d+)?) 與儲存格顯示值 (\d+(?:\.\d+)?) 差異/;
// Informational; integers or decimals, as the backend writes them.
const ND_RE = /\(n=(\d+(?:\.\d+)?), d=(\d+(?:\.\d+)?)\)/;

export function parseWarning(errorText: string): WarningInfo | null {
  const m = errorText.match(CORE_RE);
  if (!m) return null;
  const info: WarningInfo = {
    indicatorCode: m[1],
    campus: m[2],
    year: parseInt(m[3], 10),
    month: parseInt(m[4], 10),
    computedValue: parseFloat(m[5]),
    cellValue: parseFloat(m[6]),
  };
  const nd = errorText.match(ND_RE);
  if (nd) {
    info.numerator = parseFloat(nd[1]);
    info.denominator = parseFloat(nd[2]);
  }
  return info;
}
