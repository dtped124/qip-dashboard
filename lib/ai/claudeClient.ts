/**
 * Claude API 直呼模組（瀏覽器端）
 *
 * 整合所有 AI 子模組：
 * 1. 讀取 API Key（apiKeyManager）
 * 2. 執行安全閘門（safetyGate）
 * 3. 組裝 Prompt（promptBuilder）
 * 4. 查詢快取（cache）
 * 5. 呼叫 Claude API（fetch，含超時與重試）
 * 6. 記錄用量（usageTracker）
 * 7. 寫入快取（cache）
 * 8. 解析回應（promptBuilder）
 */

import { loadApiKey, getModelSetting } from './apiKeyManager';
import { runSafetyGate } from './safetyGate';
import { buildUserPrompt, SYSTEM_PROMPT, parseAIResponse, type PromptInput, type ParsedAnalysis } from './promptBuilder';
import { getCached, setCached, computeDataHash } from './cache';
import { recordUsage, isOverSoftLimit, getSoftLimitUSD } from './usageTracker';

const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 60_000; // 60 秒
const MAX_TOKENS = 4096;

export interface AIAnalysisResult {
  parsed: ParsedAnalysis | null;
  rawText: string;
  model: string;
  cachedAt?: number;
  isCached: boolean;
}

export interface AIAnalysisOptions {
  /** 強制重新分析，忽略快取 */
  forceRefresh?: boolean;
  /** 跳過費用上限警告（使用者已確認） */
  skipLimitCheck?: boolean;
}

export type AIErrorCode =
  | 'NO_API_KEY'
  | 'SAFETY_BLOCKED'
  | 'OVER_LIMIT'
  | 'API_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR';

export class AIAnalysisError extends Error {
  constructor(
    public code: AIErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AIAnalysisError';
  }
}

// ============================
// 主入口
// ============================

/**
 * 執行 AI 深度分析
 * @param input 指標資料（由 page.tsx 組裝）
 * @param cacheKey 快取識別鍵（如 `HA01-01_竹北_115.02`）
 * @param options 選項
 */
export async function analyzeIndicator(
  input: PromptInput,
  cacheKey: string,
  options: AIAnalysisOptions = {},
): Promise<AIAnalysisResult> {
  // 1. 讀取 API Key
  const apiKey = await loadApiKey();
  if (!apiKey) {
    throw new AIAnalysisError('NO_API_KEY', '尚未設定 Claude API Key，請至「設定 → AI 分析」頁面輸入。');
  }

  // 2. 費用上限檢查
  if (!options.skipLimitCheck && isOverSoftLimit()) {
    throw new AIAnalysisError(
      'OVER_LIMIT',
      `本月 AI 分析費用已超過軟上限 $${getSoftLimitUSD()} USD。可至設定頁面查看用量，或點擊「仍要繼續」忽略此限制。`,
    );
  }

  // 3. 安全閘門
  const safetyPayload = buildSafetyPayload(input);
  const safetyResult = runSafetyGate(safetyPayload);

  if (safetyResult.piiWarnings.length > 0) {
    throw new AIAnalysisError(
      'SAFETY_BLOCKED',
      `偵測到可能的個資欄位：${safetyResult.piiWarnings.join('、')}。請確認資料後再繼續。`,
      safetyResult,
    );
  }

  // 4. 計算資料 hash
  const model = getModelSetting();
  const dataHash = computeDataHash(safetyResult.data);

  // 5. 查詢快取
  if (!options.forceRefresh) {
    const cached = getCached(cacheKey, dataHash, model);
    if (cached) {
      // 若快取中 parsed 為 null（舊版解析失敗），用新版 parser 重新嘗試
      if (cached.parsed === null && cached.rawText) {
        return { ...cached, parsed: parseAIResponse(cached.rawText) };
      }
      return cached;
    }
  }

  // 6. 組裝並呼叫 API
  const userPrompt = buildUserPrompt(input);
  const rawText = await callClaudeAPI(apiKey, model, userPrompt);

  // 7. 記錄用量（估算 token 數）
  const estimatedInputTokens = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);
  const estimatedOutputTokens = Math.ceil(rawText.length / 4);
  recordUsage(estimatedInputTokens, estimatedOutputTokens, model);

  // 8. 解析回應
  const parsed = parseAIResponse(rawText);

  const result: AIAnalysisResult = {
    parsed,
    rawText,
    model,
    isCached: false,
  };

  // 9. 寫入快取
  setCached(cacheKey, result, dataHash, model);

  return result;
}

// ============================
// API 呼叫
// ============================

async function callClaudeAPI(
  apiKey: string,
  model: string,
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
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const apiMsg = (errorBody as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`;

      if (response.status === 401) {
        throw new AIAnalysisError('API_ERROR', `API Key 無效或已過期：${apiMsg}`);
      }
      if (response.status === 429) {
        throw new AIAnalysisError('API_ERROR', `請求頻率過高，請稍後再試：${apiMsg}`);
      }
      throw new AIAnalysisError('API_ERROR', `Claude API 回傳錯誤：${apiMsg}`, errorBody);
    }

    const data = await response.json() as {
      content: { type: string; text: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };

    const textContent = data.content?.find(c => c.type === 'text');
    if (!textContent?.text) {
      throw new AIAnalysisError('PARSE_ERROR', 'Claude API 回傳空白回應。');
    }

    return textContent.text;
  } catch (err) {
    if (err instanceof AIAnalysisError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AIAnalysisError('TIMEOUT', `AI 分析逾時（超過 ${TIMEOUT_MS / 1000} 秒），請稍後再試。`);
    }
    throw new AIAnalysisError('NETWORK_ERROR', `網路錯誤，請確認網路連線後再試。`, err);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================
// 工具函式
// ============================

/** 從 PromptInput 取出要送安全閘門的數據子集 */
function buildSafetyPayload(input: PromptInput): Record<string, unknown> {
  return {
    code: input.meta.code,
    name: input.meta.name,
    category: input.meta.category,
    direction: input.meta.direction,
    unit: input.meta.unit,
    campus: input.campus,
    latestValue: input.latestValue,
    latestMonth: input.latestMonth,
    status: input.status,
    trend: input.trend,
    peerValue: input.peerValue,
    benchmarkValue: input.benchmarkValue,
    controlChart: input.controlChart,
    anomalies: input.anomalies,
    monthlyData: input.monthlyData,
    yearlySummaries: input.yearlySummaries,
  };
}
