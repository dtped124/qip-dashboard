/**
 * 五層比對策略引擎
 * Layer 1: 指標代碼完全匹配 (exact)
 * Layer 2: 別名匹配 (alias)
 * Layer 3: 包含匹配 (contains)
 * Layer 4: 模糊相似度匹配 (similar)
 * Layer 5: 無法識別 (unrecognized)
 */

import { INDICATOR_META, NAME_TO_CODE } from '@/lib/constants';
import type { IndicatorMeta, MatchResult, MatchingRule } from '@/lib/types';
import { normalize } from './normalizer';
import { combinedSimilarity } from './similarity';

const SIMILARITY_THRESHOLD = 0.6;

interface MatchCandidate {
  code: string;
  meta: Omit<IndicatorMeta, 'code'>;
  normalizedName: string;
  normalizedAliases: string[];
}

// 預計算標準化後的指標名稱和別名
let cachedCandidates: MatchCandidate[] | null = null;

function getCandidates(): MatchCandidate[] {
  if (cachedCandidates) return cachedCandidates;

  cachedCandidates = Object.entries(INDICATOR_META).map(([code, meta]) => ({
    code,
    meta,
    normalizedName: normalize(meta.name),
    normalizedAliases: meta.aliases.map(a => normalize(a)),
  }));

  return cachedCandidates;
}

/**
 * 對單個 Excel 名稱執行五層比對
 */
export function matchIndicatorName(
  excelName: string,
  memoryRules: MatchingRule[] = [],
  customIndicators: IndicatorMeta[] = [],
): MatchResult {
  const normalizedInput = normalize(excelName);
  const candidates = getCandidates();

  // 額外加入自定義指標
  const allCandidates = [
    ...candidates,
    ...customIndicators.map(ind => ({
      code: ind.code,
      meta: ind,
      normalizedName: normalize(ind.name),
      normalizedAliases: ind.aliases.map(a => normalize(a)),
    })),
  ];

  // Layer 0: 記憶規則優先
  const memoryMatch = memoryRules.find(r => r.normalizedName === normalizedInput);
  if (memoryMatch) {
    const meta = INDICATOR_META[memoryMatch.indicatorCode];
    return {
      excelName,
      indicatorCode: memoryMatch.indicatorCode,
      indicatorName: meta?.name ?? memoryMatch.indicatorCode,
      confidence: 'exact',
      score: 1,
    };
  }

  // Layer 1: NAME_TO_CODE 完全匹配
  const directCode = NAME_TO_CODE[excelName];
  if (directCode && INDICATOR_META[directCode]) {
    return {
      excelName,
      indicatorCode: directCode,
      indicatorName: INDICATOR_META[directCode].name,
      confidence: 'exact',
      score: 1,
    };
  }

  // 也做標準化後完全匹配
  for (const c of allCandidates) {
    if (normalizedInput === c.normalizedName) {
      return {
        excelName,
        indicatorCode: c.code,
        indicatorName: c.meta.name,
        confidence: 'exact',
        score: 1,
      };
    }
  }

  // Layer 2: 別名匹配
  for (const c of allCandidates) {
    for (const alias of c.normalizedAliases) {
      if (normalizedInput === alias) {
        return {
          excelName,
          indicatorCode: c.code,
          indicatorName: c.meta.name,
          confidence: 'alias',
          score: 0.95,
        };
      }
    }
  }

  // Layer 3: 包含匹配（輸入包含候選，或候選包含輸入）
  const containsMatches: { code: string; name: string; score: number }[] = [];
  for (const c of allCandidates) {
    if (normalizedInput.includes(c.normalizedName) || c.normalizedName.includes(normalizedInput)) {
      const ratio = Math.min(normalizedInput.length, c.normalizedName.length) /
                    Math.max(normalizedInput.length, c.normalizedName.length);
      if (ratio > 0.5) {
        containsMatches.push({ code: c.code, name: c.meta.name, score: ratio * 0.85 });
      }
    }
  }
  if (containsMatches.length > 0) {
    containsMatches.sort((a, b) => b.score - a.score);
    const best = containsMatches[0];
    return {
      excelName,
      indicatorCode: best.code,
      indicatorName: best.name,
      confidence: 'contains',
      score: best.score,
    };
  }

  // Layer 4: 模糊相似度匹配
  let bestSimilarity = 0;
  let bestCandidate: MatchCandidate | null = null;

  for (const c of allCandidates) {
    const sim = combinedSimilarity(normalizedInput, c.normalizedName);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestCandidate = c;
    }
    // 也檢查別名
    for (const alias of c.normalizedAliases) {
      const aliasSim = combinedSimilarity(normalizedInput, alias);
      if (aliasSim > bestSimilarity) {
        bestSimilarity = aliasSim;
        bestCandidate = c;
      }
    }
  }

  if (bestCandidate && bestSimilarity >= SIMILARITY_THRESHOLD) {
    return {
      excelName,
      indicatorCode: bestCandidate.code,
      indicatorName: bestCandidate.meta.name,
      confidence: 'similar',
      score: bestSimilarity,
    };
  }

  // Layer 5: 無法識別
  return {
    excelName,
    indicatorCode: null,
    indicatorName: null,
    confidence: 'unrecognized',
    score: bestSimilarity,
  };
}

/**
 * 批次比對多個 Excel 名稱
 */
export function matchIndicatorNames(
  excelNames: string[],
  memoryRules: MatchingRule[] = [],
  customIndicators: IndicatorMeta[] = [],
): MatchResult[] {
  return excelNames.map(name => matchIndicatorName(name, memoryRules, customIndicators));
}

/**
 * 清除快取（當指標定義更新時需要呼叫）
 */
export function clearMatchingCache(): void {
  cachedCandidates = null;
}
