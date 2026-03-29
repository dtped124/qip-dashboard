/**
 * 跨院區季度 AI 分析客戶端
 *
 * 管理 4 次 API 呼叫：3 個院區（並行）+ 1 個共通問題（依序）。
 * 快取格式與 claudeClient 相容，使用相同的 qip_ai_cache_ 前綴。
 */

import { loadApiKey, getModelSetting } from './apiKeyManager';
import { isOverSoftLimit, recordUsage, getSoftLimitUSD } from './usageTracker';
import { computeDataHash } from './cache';
import { AIAnalysisError } from './claudeClient';
import {
  CAMPUS_ANALYSIS_SYSTEM_PROMPT,
  COMMON_ISSUES_SYSTEM_PROMPT,
  buildCampusAnalysisPrompt,
  buildCommonIssuesPrompt,
  parseCampusAnalysis,
  parseCommonIssues,
  type CampusAnalysisInput,
  type CommonIssuesInput,
  type ParsedCampusAnalysis,
  type ParsedCommonIssues,
} from './promptBuilder';

const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 4096;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'qip_ai_cache_';

// ============================
// Result Types
// ============================

export interface CampusAnalysisResult {
  parsed: ParsedCampusAnalysis | null;
  rawText: string;
  model: string;
  isCached: boolean;
}

export interface CommonIssuesResult {
  parsed: ParsedCommonIssues | null;
  rawText: string;
  model: string;
  isCached: boolean;
}

export interface CrossCampusOptions {
  forceRefresh?: boolean;
  skipLimitCheck?: boolean;
}

// ============================
// 院區分析
// ============================

export async function analyzeCampus(
  input: CampusAnalysisInput,
  cacheKey: string,
  options: CrossCampusOptions = {},
): Promise<CampusAnalysisResult> {
  const apiKey = await loadApiKey();
  if (!apiKey) throw new AIAnalysisError('NO_API_KEY', '尚未設定 Claude API Key，請至「設定 → AI 分析」頁面輸入。');

  if (!options.skipLimitCheck && isOverSoftLimit()) {
    throw new AIAnalysisError('OVER_LIMIT', `本月 AI 分析費用已超過軟上限 $${getSoftLimitUSD()} USD。`);
  }

  const model = getModelSetting();
  const dataHash = computeDataHash(input);

  if (!options.forceRefresh) {
    const cached = getCachedResult(cacheKey, dataHash, model) as CampusAnalysisResult | null;
    if (cached) {
      const reparsed = cached.parsed === null && cached.rawText ? parseCampusAnalysis(cached.rawText) : cached.parsed;
      return { ...cached, parsed: reparsed, isCached: true };
    }
  }

  const userPrompt = buildCampusAnalysisPrompt(input);
  const rawText = await callClaudeAPI(apiKey, model, CAMPUS_ANALYSIS_SYSTEM_PROMPT, userPrompt);

  const estimatedInput = Math.ceil((CAMPUS_ANALYSIS_SYSTEM_PROMPT.length + userPrompt.length) / 4);
  const estimatedOutput = Math.ceil(rawText.length / 4);
  recordUsage(estimatedInput, estimatedOutput, model);

  const parsed = parseCampusAnalysis(rawText);
  const result: CampusAnalysisResult = { parsed, rawText, model, isCached: false };

  setCachedResult(cacheKey, result, dataHash, model);
  return result;
}

// ============================
// 共通問題分析
// ============================

export async function analyzeCommonIssues(
  input: CommonIssuesInput,
  cacheKey: string,
  options: CrossCampusOptions = {},
): Promise<CommonIssuesResult> {
  const apiKey = await loadApiKey();
  if (!apiKey) throw new AIAnalysisError('NO_API_KEY', '尚未設定 Claude API Key。');

  if (!options.skipLimitCheck && isOverSoftLimit()) {
    throw new AIAnalysisError('OVER_LIMIT', `本月 AI 分析費用已超過軟上限 $${getSoftLimitUSD()} USD。`);
  }

  const model = getModelSetting();
  const dataHash = computeDataHash(input);

  if (!options.forceRefresh) {
    const cached = getCachedResult(cacheKey, dataHash, model) as CommonIssuesResult | null;
    if (cached) {
      const reparsed = cached.parsed === null && cached.rawText ? parseCommonIssues(cached.rawText) : cached.parsed;
      return { ...cached, parsed: reparsed, isCached: true };
    }
  }

  const userPrompt = buildCommonIssuesPrompt(input);
  const rawText = await callClaudeAPI(apiKey, model, COMMON_ISSUES_SYSTEM_PROMPT, userPrompt);

  const estimatedInput = Math.ceil((COMMON_ISSUES_SYSTEM_PROMPT.length + userPrompt.length) / 4);
  const estimatedOutput = Math.ceil(rawText.length / 4);
  recordUsage(estimatedInput, estimatedOutput, model);

  const parsed = parseCommonIssues(rawText);
  const result: CommonIssuesResult = { parsed, rawText, model, isCached: false };

  setCachedResult(cacheKey, result, dataHash, model);
  return result;
}

// ============================
// 共用 API 呼叫
// ============================

async function callClaudeAPI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const apiMsg = (errorBody as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`;
      if (response.status === 401) throw new AIAnalysisError('API_ERROR', `API Key 無效或已過期：${apiMsg}`);
      if (response.status === 429) throw new AIAnalysisError('API_ERROR', `請求頻率過高，請稍後再試：${apiMsg}`);
      throw new AIAnalysisError('API_ERROR', `Claude API 回傳錯誤：${apiMsg}`);
    }

    const data = await response.json() as {
      content: { type: string; text: string }[];
    };
    const textContent = data.content?.find(c => c.type === 'text');
    if (!textContent?.text) throw new AIAnalysisError('PARSE_ERROR', 'Claude API 回傳空白回應。');
    return textContent.text;
  } catch (err) {
    if (err instanceof AIAnalysisError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AIAnalysisError('TIMEOUT', `AI 分析逾時（超過 ${TIMEOUT_MS / 1000} 秒），請稍後再試。`);
    }
    throw new AIAnalysisError('NETWORK_ERROR', '網路錯誤，請確認網路連線後再試。', err);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================
// 快取工具（跨院區專用）
// ============================

interface CrossCampusCacheEntry {
  result: CampusAnalysisResult | CommonIssuesResult;
  dataHash: string;
  model: string;
  cachedAt: number;
  expiresAt: number;
}

function getCachedResult(
  cacheKey: string,
  dataHash: string,
  model: string,
): CampusAnalysisResult | CommonIssuesResult | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY_PREFIX + cacheKey);
  if (!raw) return null;
  try {
    const entry: CrossCampusCacheEntry = JSON.parse(raw);
    const now = Date.now();
    if (entry.expiresAt > now && entry.dataHash === dataHash && entry.model === model) {
      return entry.result;
    }
    localStorage.removeItem(KEY_PREFIX + cacheKey);
    return null;
  } catch {
    localStorage.removeItem(KEY_PREFIX + cacheKey);
    return null;
  }
}

function setCachedResult(
  cacheKey: string,
  result: CampusAnalysisResult | CommonIssuesResult,
  dataHash: string,
  model: string,
): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const entry: CrossCampusCacheEntry = {
    result,
    dataHash,
    model,
    cachedAt: now,
    expiresAt: now + CACHE_TTL_MS,
  };
  try {
    localStorage.setItem(KEY_PREFIX + cacheKey, JSON.stringify(entry));
  } catch {
    // localStorage 已滿，跳過快取
  }
}
