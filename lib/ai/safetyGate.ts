/**
 * 資料安全閘門
 *
 * 每次送出 AI 分析 prompt 前必須執行此模組：
 * 1. 欄位白名單過濾
 * 2. PII 格式偵測
 *
 * 安全檢查失敗時回傳詳細說明，由 UI 告知使用者並取得確認後才繼續。
 */

export interface SafetyResult {
  /** 是否完全安全（可直接送出） */
  safe: boolean;
  /** 被遮蔽的欄位路徑 */
  maskedFields: string[];
  /** 偵測到 PII 的欄位描述 */
  piiWarnings: string[];
  /** 過濾後的安全數據 */
  data: object;
}

// ============================
// PII 偵測模式
// ============================

const PII_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /[A-Z][12]\d{8}/, label: '台灣身分證字號' },
  { pattern: /[\w.+-]+@[\w-]+\.\w+/, label: 'Email 地址' },
  { pattern: /\b09\d{8}\b/, label: '手機號碼' },
  { pattern: /\b\d{4}-\d{4}-\d{4}-\d{4}\b/, label: '信用卡號' },
];

// ============================
// 白名單允許的欄位（用於 prompt 組裝）
// ============================

const ALLOWED_TOP_KEYS = new Set([
  'code',
  'name',
  'category',
  'direction',
  'unit',
  'dataNature',
  'campus',
  'value',
  'latestValue',
  'latestMonth',
  'trend',
  'status',
  'controlChart',
  'anomalies',
  'peerValue',
  'peerYear',
  'benchmarkValue',
  'monthlyData',
  'yearlySummaries',
]);

// ============================
// 核心函式
// ============================

/**
 * 對輸入資料執行所有安全檢查
 * @param rawData 要送出的原始資料物件
 */
export function runSafetyGate(rawData: Record<string, unknown>): SafetyResult {
  // Step 1：白名單過濾
  const filtered = filterToWhitelist(rawData);

  // Step 2：PII 偵測
  const piiWarnings = detectPII(filtered);

  return {
    safe: piiWarnings.length === 0,
    maskedFields: [],
    piiWarnings,
    data: filtered,
  };
}

// ============================
// 白名單過濾
// ============================

function filterToWhitelist(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  ALLOWED_TOP_KEYS.forEach(key => {
    if (key in data) {
      result[key] = data[key];
    }
  });
  return result;
}

// ============================
// 小樣本分子遮蔽
// ============================

function _maskSmallNumerators(
  obj: unknown,
  path: string,
  maskedFields: string[],
): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item, i) => maskSmallNumerators(item, `${path}[${i}]`, maskedFields));
  }

  const record = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(record)) {
    const fieldPath = `${path}.${key}`;
    if (key === 'numerator' && typeof val === 'number' && val < 10 && val > 0) {
      result[key] = '<10';
      maskedFields.push(fieldPath);
    } else {
      result[key] = maskSmallNumerators(val, fieldPath, maskedFields);
    }
  }

  return result;
}

// ============================
// PII 偵測
// ============================

function detectPII(data: unknown): string[] {
  const warnings: string[] = [];
  const dataStr = JSON.stringify(data);

  for (const { pattern, label } of PII_PATTERNS) {
    if (pattern.test(dataStr)) {
      warnings.push(label);
    }
  }

  return warnings;
}
