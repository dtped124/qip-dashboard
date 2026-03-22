/**
 * 字串相似度演算法
 * - Levenshtein 距離（編輯距離）
 * - Dice 係數（bigram 相似度）
 */

/**
 * 計算兩個字串的 Levenshtein 編輯距離
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // 使用單行 DP 節省空間
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // 刪除
        curr[j - 1] + 1,  // 插入
        prev[j - 1] + cost // 替換
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * 基於 Levenshtein 的正規化相似度 (0~1)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * 提取字串的 bigram 集合
 */
function bigrams(str: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    result.add(str.substring(i, i + 2));
  }
  return result;
}

/**
 * Dice 係數 (Sørensen–Dice coefficient)
 * 基於 bigram 重疊度的相似度 (0~1)
 */
export function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);

  let intersection = 0;
  bigramsA.forEach(bg => {
    if (bigramsB.has(bg)) intersection++;
  });

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * 綜合相似度（取 Levenshtein 和 Dice 的加權平均）
 */
export function combinedSimilarity(a: string, b: string): number {
  const lev = levenshteinSimilarity(a, b);
  const dice = diceSimilarity(a, b);
  // Dice 對中文 bigram 更穩定，權重較高
  return lev * 0.4 + dice * 0.6;
}
