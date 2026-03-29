/**
 * AI 用量追蹤模組
 *
 * 追蹤月度 token 使用量與預估費用。
 * 資料存於 localStorage，每月重置。
 *
 * 費用基準（claude-sonnet-4-6，USD）：
 *   Input:  $3.00 / 1M tokens
 *   Output: $15.00 / 1M tokens
 */

const STORAGE_KEY = 'qip_ai_usage';
const SOFT_LIMIT_USD = 5.0; // 軟上限：顯示警告但允許繼續

// 費率（USD per token）
const PRICE = {
  'claude-sonnet-4-6': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-opus-4-6':   { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
  'claude-haiku-4-5-20251001':  { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
} as const;

export interface MonthlyUsage {
  /** YYYY-MM 格式 */
  month: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  estimatedUSD: number;
}

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function load(): MonthlyUsage {
  const stored = localStorage.getItem(STORAGE_KEY);
  const currentMonth = getCurrentMonth();
  if (!stored) return emptyUsage(currentMonth);

  try {
    const parsed: MonthlyUsage = JSON.parse(stored);
    // 月份不符：重置
    if (parsed.month !== currentMonth) return emptyUsage(currentMonth);
    return parsed;
  } catch {
    return emptyUsage(currentMonth);
  }
}

function emptyUsage(month: string): MonthlyUsage {
  return { month, inputTokens: 0, outputTokens: 0, requestCount: 0, estimatedUSD: 0 };
}

function calcCost(inputTokens: number, outputTokens: number, model: string): number {
  const rate = PRICE[model as keyof typeof PRICE] ?? PRICE['claude-sonnet-4-6'];
  return inputTokens * rate.input + outputTokens * rate.output;
}

/** 記錄一次 API 呼叫的 token 用量 */
export function recordUsage(inputTokens: number, outputTokens: number, model: string): MonthlyUsage {
  const usage = load();
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  usage.requestCount += 1;
  usage.estimatedUSD += calcCost(inputTokens, outputTokens, model);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  return usage;
}

/** 取得本月用量 */
export function getMonthlyUsage(): MonthlyUsage {
  return load();
}

/** 是否已超過軟上限 */
export function isOverSoftLimit(): boolean {
  return load().estimatedUSD >= SOFT_LIMIT_USD;
}

/** 取得軟上限金額（USD） */
export function getSoftLimitUSD(): number {
  return SOFT_LIMIT_USD;
}

/** 格式化費用為台幣（匯率約 32） */
export function formatCostTWD(usd: number): string {
  const twd = usd * 32;
  return twd < 1 ? `${(twd * 100).toFixed(1)} 分` : `NT$ ${twd.toFixed(1)}`;
}

/** 格式化 token 數量（千為單位） */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 重置本月用量（通常不需要，月份自動重置） */
export function resetUsage(): void {
  localStorage.removeItem(STORAGE_KEY);
}
