/**
 * 名稱標準化模組
 * 處理 Excel 匯入時指標名稱的全形/半形轉換、贅詞移除等
 */

// 全形 → 半形
function fullToHalf(str: string): string {
  return str.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).replace(/\u3000/g, ' ');
}

// 移除括號與內容（全半形括號）
function removeBrackets(str: string): string {
  return str
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[【\[][^】\]]*[】\]]/g, '');
}

// 移除贅詞（常見但不影響辨識的前後綴）
const STOPWORDS = [
  '之', '的', '全', '總', '院', '區', '全院',
  '病人', '病患', '個案', '案件', '比率', '比例', '率',
  '百分比', '千分比', '件數', '人數', '數量',
];

function removeStopwords(str: string): string {
  let result = str;
  for (const word of STOPWORDS) {
    // 只移除末尾的停用詞
    if (result.endsWith(word) && result.length > word.length) {
      result = result.slice(0, -word.length);
    }
  }
  return result;
}

// 移除空白與特殊字元
function removeWhitespace(str: string): string {
  return str.replace(/[\s\-_/\\·.。，,、；;：:！!？?]+/g, '');
}

// 統一常見同義字
const SYNONYMS: [RegExp, string][] = [
  [/靜脈血栓溶解劑/g, 'IV-tPA'],
  [/經皮冠狀動脈介入術/g, 'PCI'],
  [/PCI治療/g, 'PCI'],
  [/tPA治療/g, 'tPA'],
  [/(含)病危自動出院/g, '含病危自動出院'],
];

function applySynonyms(str: string): string {
  let result = str;
  for (const [pattern, replacement] of SYNONYMS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * 完整標準化流程
 * 將 Excel 中的指標名稱標準化為可比對的字串
 */
export function normalize(raw: string): string {
  let s = raw.trim();
  s = fullToHalf(s);
  s = applySynonyms(s);
  s = removeBrackets(s);
  s = removeWhitespace(s);
  s = removeStopwords(s);
  s = s.toLowerCase();
  return s;
}

/**
 * 輕度標準化（僅做全半形轉換與空白清理）
 * 用於顯示或寬鬆比對
 */
export function normalizeLight(raw: string): string {
  let s = raw.trim();
  s = fullToHalf(s);
  s = s.replace(/\s+/g, ' ');
  return s;
}
