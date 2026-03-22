/**
 * 比對記憶管理
 * 儲存使用者確認過的 Excel 名稱 → 指標代碼 對應關係
 */

import { addMatchingRule, getMatchingRules } from '@/lib/db/operations';
import { normalize } from './normalizer';
import type { MatchingRule } from '@/lib/types';

/**
 * 載入所有比對記憶規則
 */
export async function loadMatchingMemory(): Promise<MatchingRule[]> {
  return getMatchingRules();
}

/**
 * 儲存一筆使用者確認的比對結果
 */
export async function saveMatchingRule(
  excelName: string,
  indicatorCode: string,
): Promise<void> {
  await addMatchingRule({
    excelName,
    normalizedName: normalize(excelName),
    indicatorCode,
    confirmedAt: new Date(),
  });
}

/**
 * 批次儲存比對結果
 */
export async function saveMatchingRules(
  pairs: { excelName: string; indicatorCode: string }[],
): Promise<void> {
  for (const { excelName, indicatorCode } of pairs) {
    await saveMatchingRule(excelName, indicatorCode);
  }
}
