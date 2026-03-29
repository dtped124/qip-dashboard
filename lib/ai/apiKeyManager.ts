/**
 * API Key 加密管理模組
 *
 * 使用 AES-GCM + PBKDF2 加密 Claude API Key。
 * 加密金鑰衍生自瀏覽器指紋（User-Agent + 螢幕解析度 + 時區），
 * 確保 localStorage 中不存放明文 Key。
 *
 * 解密後的 Key 僅存在記憶體中（module-level cache），不寫入任何持久儲存。
 */

const STORAGE_KEY = 'qip_ai_key_v1';

// 記憶體快取（頁面重載後清除）
let _cachedKey: string | null = null;

/** 取得瀏覽器指紋作為加密 passphrase */
function getFingerprint(): string {
  if (typeof window === 'undefined') return 'ssr-placeholder';
  return [
    navigator.userAgent,
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');
}

/** 將 base64 字串轉回 Uint8Array */
function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** 將 Uint8Array 轉為 base64 字串 */
function bytesToB64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}

/** 衍生 AES-GCM 金鑰（PBKDF2，100,000 次迭代） */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 儲存 API Key（加密後存入 localStorage） */
export async function saveApiKey(apiKey: string): Promise<void> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await deriveKey(getFingerprint(), salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    enc.encode(apiKey),
  );

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    encrypted: bytesToB64(new Uint8Array(encrypted)),
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
  }));

  // 更新記憶體快取
  _cachedKey = apiKey;
}

/** 讀取 API Key（從記憶體快取或解密 localStorage） */
export async function loadApiKey(): Promise<string | null> {
  if (_cachedKey) return _cachedKey;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  try {
    const { encrypted, salt, iv } = JSON.parse(stored);
    const saltBytes = b64ToBytes(salt);
    const ivBytes = b64ToBytes(iv);
    const encBytes = b64ToBytes(encrypted);
    const cryptoKey = await deriveKey(getFingerprint(), saltBytes);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
      cryptoKey,
      encBytes.buffer as ArrayBuffer,
    );
    _cachedKey = new TextDecoder().decode(decrypted);
    return _cachedKey;
  } catch {
    // 解密失敗（可能換了裝置或瀏覽器指紋改變）
    return null;
  }
}

/** 驗證 API Key 格式（sk-ant- 開頭） */
export function validateApiKeyFormat(key: string): boolean {
  return /^sk-ant-[a-zA-Z0-9_-]{20,}$/.test(key.trim());
}

/** 清除 API Key */
export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
  _cachedKey = null;
}

/** 是否已設定 API Key */
export function hasApiKey(): boolean {
  if (_cachedKey) return true;
  return !!localStorage.getItem(STORAGE_KEY);
}

/** 讀取目前模型設定（預設 claude-sonnet-4-6） */
export function getModelSetting(): string {
  return localStorage.getItem('qip_ai_model') || 'claude-sonnet-4-6';
}

/** 儲存模型設定 */
export function setModelSetting(model: string): void {
  localStorage.setItem('qip_ai_model', model);
}

/** AI 分析功能是否啟用 */
export function isAIEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('qip_ai_enabled') === '1';
}

/** 設定 AI 分析功能啟用狀態 */
export function setAIEnabled(enabled: boolean): void {
  localStorage.setItem('qip_ai_enabled', enabled ? '1' : '0');
}
