/**
 * AI 分析快取模組
 *
 * 快取機制：
 * - 存放於 localStorage（key = `qip_ai_cache_${cacheKey}`）
 * - 快取有效期：30 天
 * - 失效條件：
 *     1. 超過 30 天
 *     2. 數據 hash 改變（新數據匯入）
 *     3. 使用者手動重新分析
 *     4. 切換模型
 * - cacheKey = `${indicatorCode}_${campus}_${month}`（月度）
 */

import type { AIAnalysisResult } from './claudeClient';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const KEY_PREFIX = 'qip_ai_cache_';

interface CacheEntry {
  result: AIAnalysisResult;
  dataHash: string;
  model: string;
  cachedAt: number; // timestamp ms
  expiresAt: number;
}

/** 計算資料 hash（不含 timestamp，只含影響分析的欄位） */
export function computeDataHash(data: object): string {
  const str = JSON.stringify(data, Object.keys(data).sort());
  // 簡易 hash：轉換為整數串
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/** 讀取快取（若失效回傳 null） */
export function getCached(
  cacheKey: string,
  dataHash: string,
  model: string,
): AIAnalysisResult | null {
  const raw = localStorage.getItem(KEY_PREFIX + cacheKey);
  if (!raw) return null;

  try {
    const entry: CacheEntry = JSON.parse(raw);
    const now = Date.now();

    if (
      entry.expiresAt > now &&       // 未過期
      entry.dataHash === dataHash &&  // 數據未變
      entry.model === model           // 模型相同
    ) {
      return entry.result;
    }

    // 失效：清除
    localStorage.removeItem(KEY_PREFIX + cacheKey);
    return null;
  } catch {
    localStorage.removeItem(KEY_PREFIX + cacheKey);
    return null;
  }
}

/** 寫入快取 */
export function setCached(
  cacheKey: string,
  result: AIAnalysisResult,
  dataHash: string,
  model: string,
): void {
  const now = Date.now();
  const entry: CacheEntry = {
    result,
    dataHash,
    model,
    cachedAt: now,
    expiresAt: now + CACHE_TTL_MS,
  };
  try {
    localStorage.setItem(KEY_PREFIX + cacheKey, JSON.stringify(entry));
  } catch {
    // localStorage 可能已滿，清除最舊的快取
    pruneOldCache();
    try {
      localStorage.setItem(KEY_PREFIX + cacheKey, JSON.stringify(entry));
    } catch {
      // 仍失敗則跳過（不影響功能）
    }
  }
}

/** 清除指定指標的所有快取 */
export function clearCacheForIndicator(indicatorCode: string): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX + indicatorCode)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

/** 清除所有 AI 快取 */
export function clearAllAICache(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

/** 清除已過期的快取（避免 localStorage 填滿） */
function pruneOldCache(): void {
  const now = Date.now();
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(KEY_PREFIX)) continue;
    try {
      const entry: CacheEntry = JSON.parse(localStorage.getItem(key) || '{}');
      if (entry.expiresAt < now) keysToRemove.push(key);
    } catch {
      keysToRemove.push(key!);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

/** 取得快取統計 */
export function getCacheStats(): { count: number; oldestDate: Date | null } {
  let count = 0;
  let oldest = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(KEY_PREFIX)) continue;
    try {
      const entry: CacheEntry = JSON.parse(localStorage.getItem(key) || '{}');
      count++;
      if (entry.cachedAt < oldest) oldest = entry.cachedAt;
    } catch { /* ignore */ }
  }
  return { count, oldestDate: oldest < Infinity ? new Date(oldest) : null };
}
