# 第 8.6 章：AI 深度分析整合規格（Claude API）

> **本章定位**：定義改善優先清單中「AI 深度分析」功能的完整技術規格。  
> **核心決策變更**：原規劃為 Phase 2 功能，現改為與 dashboard 同步開發（Phase 1）。  
> **依賴**：第 8.5 章（季度變化分析頁）的改善優先清單區塊。

---

## 8.6.1 架構概覽

```
使用者點擊 [🤖 AI 深度分析]
        │
        ▼
  檢查快取 → 有有效快取 → 直接顯示
        │
       無快取
        │
        ▼
  檢查 API Key → 未設定 → 彈出設定面板
        │
      已設定
        │
        ▼
  組裝 Prompt（僅聚合數據）
        │
        ▼
  資料安全檢查閘門
  （驗證 prompt 不含個案資料）
        │
        ▼
  呼叫 Anthropic Claude API
  （瀏覽器端直接 fetch）
        │
        ▼
  解析回應 → 渲染 AI 分析面板
        │
        ▼
  儲存快取至 Dexie
```

### 為什麼可以從瀏覽器直接呼叫？

正常情況下，前端直呼 LLM API 不建議（key 暴露風險）。但你的場景有三個特殊條件讓這個做法合理：

1. **使用者是院內品管人員**，不是公開網站的匿名訪客
2. **Portable 部署**，只在特定電腦上跑，不會被不特定人存取
3. **Anthropic Console 可設月度用量上限**，即使 key 外洩，損失可控

如果未來 dashboard 要開放給更多人用，可以加一層簡易的 Cloudflare Worker 做 proxy，但現階段不需要。

---

## 8.6.2 API Key 管理

### 儲存機制：首次輸入 + 本地加密儲存

```typescript
// ====== API Key 加密儲存模組 ======

const CRYPTO_ALGORITHM = 'AES-GCM';
const KEY_STORAGE_ID = 'anthropic-api-key';

// 產生裝置綁定的加密金鑰（基於固定 salt + 裝置資訊）
async function getDerivedKey(): Promise<CryptoKey> {
  // 用固定但不容易猜到的 salt
  // 這不是軍事級加密，目的是避免純文字儲存
  const salt = new TextEncoder().encode('qip-dashboard-key-protection-v1');
  const baseKey = await crypto.subtle.importKey(
    'raw',
    salt,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: CRYPTO_ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 加密 API Key
async function encryptApiKey(apiKey: string): Promise<{ iv: string; data: string }> {
  const key = await getDerivedKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: CRYPTO_ALGORITHM, iv },
    key,
    new TextEncoder().encode(apiKey)
  );
  return {
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
  };
}

// 解密 API Key
async function decryptApiKey(stored: { iv: string; data: string }): Promise<string> {
  const key = await getDerivedKey();
  const iv = Uint8Array.from(atob(stored.iv), c => c.charCodeAt(0));
  const data = Uint8Array.from(atob(stored.data), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: CRYPTO_ALGORITHM, iv },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}
```

### Dexie Schema 擴充

```typescript
// 新增 settings 表
db.version(5).stores({
  // ... 既有表 ...
  settings: 'key'  // key-value store for app settings
});

interface SettingRecord {
  key: string;
  value: any;
  updatedAt: Date;
}

// 儲存加密後的 API key
await db.settings.put({
  key: KEY_STORAGE_ID,
  value: { iv: '...', data: '...' },
  updatedAt: new Date()
});
```

### API Key 設定 UI

```
┌──────────────────────────────────────────────────────────┐
│  ⚙️ AI 分析設定                                    [✕]   │
│                                                          │
│  Anthropic API Key                                       │
│  ┌──────────────────────────────────────────────────┐    │
│  │ sk-ant-api03-████████████████████████████████     │    │
│  └──────────────────────────────────────────────────┘    │
│  ○ Key 已設定（上次驗證：114.12.15）                      │
│                                                          │
│  模型選擇                                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │ claude-sonnet-4-20250514          ▾               │    │
│  └──────────────────────────────────────────────────┘    │
│  💡 建議使用 Sonnet（速度快、成本低、品質足夠）              │
│     Opus 分析更深入但成本約 5 倍                          │
│                                                          │
│  回應語言                                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 繁體中文                          ▾               │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  [ 驗證 Key ]   [ 清除 Key ]                             │
│                                                          │
│  ⚠️ Key 僅儲存於本機瀏覽器，不會傳送至任何第三方。          │
│     建議在 Anthropic Console 設定月度用量上限。            │
│     聚合數據（比率、密度等統計值）會傳送至 Anthropic API。  │
│     系統不會傳送任何個案層級資料。                         │
└──────────────────────────────────────────────────────────┘
```

### 進入條件

- 設定面板入口：頁面右上角齒輪圖標 或 首次點擊 AI 分析按鈕時自動彈出
- 驗證 Key：發送一個最小 prompt（"Hi"）確認 key 有效，不消耗大量 token
- Key 格式檢查：必須以 `sk-ant-` 開頭

---

## 8.6.3 資料安全檢查閘門

這是最重要的安全機制——確保送出去的 prompt 只包含指標層級的聚合統計，不含個案明細。

**設計原則**：送出的資料為「指標層級的聚合統計」（如：竹北院區某月 CLABSI 2 例 / 1,100 導管人日），不含個案明細（病歷號、姓名、病房、日期），無法反推特定個人。

**注意：不遮蔽小樣本分子。** 許多指標（VAP、CLABSI、跌倒、重返手術室等）的月分子常為 0-5，若遮蔽分子 <10 的數據，超過一半的指標月份會被遮蔽，AI 無法做有意義的分析。分子分母是 AI 理解指標嚴重程度的關鍵資訊（「2/1100 vs 2/50」意義完全不同），應完整送出。

```typescript
// ====== 資料安全閘門 ======

interface SafetyCheckResult {
  pass: boolean;
  blockedFields: string[];
  sanitizedContext: IndicatorAnalysisContext;
}

function runDataSafetyCheck(context: IndicatorAnalysisContext): SafetyCheckResult {
  const blockedFields: string[] = [];
  const sanitized = { ...context };
  
  // 規則 1：偵測品管備註欄位中的 PII（個人可識別資訊）
  // 這是最主要的風險點——品管人員可能在自由文字中貼入個案資料
  const piiPatterns = [
    /[A-Z]\d{9}/,           // 身分證字號格式
    /[\w.-]+@[\w.-]+/,      // email 格式
  ];
  if (context.additionalContext) {
    for (const pattern of piiPatterns) {
      if (pattern.test(context.additionalContext)) {
        blockedFields.push('additionalContext (PII detected)');
        sanitized.additionalContext = '[已移除，偵測到可能的個資]';
        break;
      }
    }
  }
  
  // 規則 2：只允許以下欄位送出（白名單）
  const ALLOWED_FIELDS = new Set([
    'indicatorName', 'indicatorCode', 'category', 'campus',
    'direction', 'recentMonths',        // 月份值（聚合比率/密度）
    'numerator', 'denominator',         // 分子分母（聚合統計，非個案明細）
    'controlLimits', 'isOutOfControl',
    'peerValue', 'peerYear', 'peerLevel', 'peerGapPercentage',
    'prevQuarterAvg', 'currentQuarterAvg', 'changePercentage',
    'consecutiveAbnormalQuarters', 'anomalyPattern',
    'additionalContext',                 // 經過 PII 檢查後的備註
  ]);
  
  // 移除所有不在白名單中的欄位
  for (const key of Object.keys(sanitized)) {
    if (!ALLOWED_FIELDS.has(key)) {
      delete (sanitized as any)[key];
      blockedFields.push(key);
    }
  }
  
  return {
    pass: blockedFields.length === 0,
    blockedFields,
    sanitizedContext: sanitized,
  };
}
```

### 安全檢查失敗時的 UI 回饋

僅在偵測到 PII 時才彈出提示（白名單過濾是靜默執行的）：

```
┌──────────────────────────────────────────────────────┐
│  ⚠️ 資料安全檢查                                      │
│                                                       │
│  品管備註欄位偵測到可能的個人資料，已自動移除：          │
│  • additionalContext（偵測到身分證字號格式）             │
│                                                       │
│  指標的聚合數據（比率、分子、分母等）不受影響，          │
│  仍會正常送出進行分析。                                 │
│  [ 繼續分析 ]   [ 取消 ]                                │
└──────────────────────────────────────────────────────┘
```

---

## 8.6.4 Prompt 工程

### System Prompt（固定）

```typescript
const SYSTEM_PROMPT = `你是一位資深醫院品質管理顧問，專長為台灣醫院評鑑制度下的品質指標分析。

你的任務是根據提供的品質指標數據，進行深度分析並提出可操作的改善建議。

回答規則：
1. 使用繁體中文
2. 語氣專業但易懂，避免過度學術化
3. 不要重複列出已提供的數據數字
4. 聚焦在「為什麼」和「怎麼辦」，而不是「是什麼」
5. 每個建議都要具體到可以指派給特定人員或部門
6. 如果數據不足以得出結論，明確說明需要哪些額外資訊
7. 考慮台灣醫院的實務情境（評鑑制度、健保規範、病安通報）

回應格式（請嚴格遵守）：
<analysis>
<key_findings>
• [發現 1]
• [發現 2]
• [發現 3]（最多 3 點）
</key_findings>

<possible_causes>
• [原因方向 1]：[簡要說明為什麼這可能是原因]
• [原因方向 2]：[簡要說明]
• [原因方向 3]：[簡要說明]
（最多 5 點，按可能性排序）
</possible_causes>

<recommended_actions>
• [行動 1]：[具體步驟]（建議負責：[部門/角色]）
• [行動 2]：[具體步驟]（建議負責：[部門/角色]）
• [行動 3]：[具體步驟]（建議負責：[部門/角色]）
（最多 4 點，按優先順序排列）
</recommended_actions>

<additional_data_needed>
[如果需要額外資訊才能做更精確的判斷，列在這裡]
</additional_data_needed>
</analysis>`;
```

### User Prompt 模板

```typescript
function buildUserPrompt(ctx: SanitizedAnalysisContext): string {
  const directionLabel = 
    ctx.direction === 'lower' ? '越低越好' : 
    ctx.direction === 'higher' ? '越高越好' : '監測型指標';
  
  const monthsText = ctx.recentMonths
    .map(m => `  ${m.label}: ${m.value !== null ? m.value : '無資料'}`)
    .join('\n');
  
  const peerText = ctx.peerValue !== null 
    ? `同儕基準值（${ctx.peerYear} 年度 TCPI ${ctx.peerLevel}）：${ctx.peerValue}\n與同儕差距：${ctx.peerGapPercentage}%`
    : '同儕基準值：無可比較資料';

  return `請分析以下品質指標的異常狀況：

## 指標基本資訊
- 名稱：${ctx.indicatorName}
- 代碼：${ctx.indicatorCode}
- 所屬面向：${ctx.category}
- 院區：${ctx.campus === 'zhubei' ? '竹北院區（區域醫院）' : '竹東院區（地區醫院）'}
- 方向性：${directionLabel}

## 近 6 個月數據趨勢
${monthsText}

## 統計製程管制（SPC）資訊
- 中心線 (CL)：${ctx.controlLimits.cl}
- 管制上限 (UCL)：${ctx.controlLimits.ucl}
- 管制下限 (LCL)：${ctx.controlLimits.lcl}
- 本季末月管制狀態：${ctx.isOutOfControl ? '超出管制界限' : '管制內'}
- 偵測到的異常模式：${ctx.anomalyPattern}

## 同儕比較
${peerText}

## 季度比較
- 上季均值：${ctx.prevQuarterAvg}
- 本季均值：${ctx.currentQuarterAvg}
- 季度變化率：${ctx.changePercentage}%
- 連續異常季數：${ctx.consecutiveAbnormalQuarters}

${ctx.additionalContext ? `## 品管人員補充說明\n${ctx.additionalContext}` : ''}

請根據以上資訊進行深度分析。`;
}
```

### Token 估算

| 組成 | 預估 Token 數 |
|------|--------------|
| System Prompt | ~400 |
| User Prompt（單一指標） | ~500-700 |
| 回應（結構化分析） | ~600-1,000 |
| **單次總計** | **~1,500-2,100** |

以 Claude Sonnet 定價估算：單次分析約 $0.01-0.015 USD（不到 0.5 元台幣）。

---

## 8.6.5 API 呼叫實作

```typescript
// ====== Claude API 呼叫模組 ======

interface AIAnalysisResult {
  keyFindings: string[];
  possibleCauses: string[];
  recommendedActions: string[];
  additionalDataNeeded: string | null;
  rawResponse: string;
  model: string;
  tokenUsage: { input: number; output: number };
  analyzedAt: Date;
}

async function callClaudeAPI(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'claude-sonnet-4-20250514'
): Promise<AIAnalysisResult> {
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',  // 瀏覽器直呼需要
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ],
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new AIAnalysisError(
      `API 呼叫失敗：${error.error?.message || response.statusText}`,
      response.status
    );
  }
  
  const data = await response.json();
  const rawText = data.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('');
  
  // 解析結構化回應
  const parsed = parseAnalysisResponse(rawText);
  
  return {
    ...parsed,
    rawResponse: rawText,
    model: data.model,
    tokenUsage: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
    analyzedAt: new Date(),
  };
}

// 解析 XML 格式的回應
function parseAnalysisResponse(raw: string): Omit<AIAnalysisResult, 'rawResponse' | 'model' | 'tokenUsage' | 'analyzedAt'> {
  const extract = (tag: string): string => {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
    const match = raw.match(regex);
    return match ? match[1].trim() : '';
  };
  
  const bulletList = (text: string): string[] =>
    text.split('\n')
      .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
      .filter(line => line.length > 0);
  
  return {
    keyFindings: bulletList(extract('key_findings')),
    possibleCauses: bulletList(extract('possible_causes')),
    recommendedActions: bulletList(extract('recommended_actions')),
    additionalDataNeeded: extract('additional_data_needed') || null,
  };
}

// 自定義錯誤類別
class AIAnalysisError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'AIAnalysisError';
  }
}
```

### 錯誤處理策略

| 錯誤類型 | HTTP Status | 使用者看到的訊息 | 處理方式 |
|----------|-------------|-----------------|---------|
| Key 無效 | 401 | 「API Key 無效，請至設定重新輸入」 | 清除儲存的 key，彈出設定面板 |
| 額度用盡 | 429 | 「本月 API 額度已用完，請下月再試」 | 顯示提示，不重試 |
| 伺服器錯誤 | 500/503 | 「Anthropic 服務暫時無法使用，請稍後再試」 | 30 秒後可重試，最多 2 次 |
| 網路斷線 | — | 「無法連線至 AI 服務，請確認網路狀態」 | 不重試 |
| 回應解析失敗 | — | 顯示原始回應文字 + 「AI 回應格式異常」 | fallback 顯示 rawResponse |
| 超時 | — | 「分析逾時（30 秒），請重試」 | AbortController 30s timeout |

---

## 8.6.6 快取機制

分析結果儲存在 Dexie 中，避免重複呼叫（同一個指標、同一季的數據沒變就不需要重新分析）。

```typescript
interface AIAnalysisCache {
  id: string;                    // `${indicatorId}-${campus}-${year}Q${quarter}`
  indicatorId: string;
  campus: 'zhubei' | 'zhudong';
  year: number;
  quarter: number;
  
  // 分析結果
  result: AIAnalysisResult;
  
  // 快取有效性
  dataHash: string;              // 基於輸入數據的 hash，數據變了就失效
  model: string;                 // 使用的模型版本
  createdAt: Date;
  expiresAt: Date;               // 預設 30 天過期
}

// Dexie schema
db.version(6).stores({
  // ... 既有表 ...
  aiAnalysisCache: 'id, indicatorId, campus, [year+quarter], expiresAt'
});

// 計算數據 hash（用於判定快取是否失效）
async function computeDataHash(ctx: SanitizedAnalysisContext): Promise<string> {
  const payload = JSON.stringify({
    values: ctx.recentMonths.map(m => m.value),
    cl: ctx.controlLimits.cl,
    ucl: ctx.controlLimits.ucl,
    peer: ctx.peerValue,
    prevQ: ctx.prevQuarterAvg,
    curQ: ctx.currentQuarterAvg,
  });
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 快取查詢邏輯
async function getCachedAnalysis(
  indicatorId: string,
  campus: string,
  year: number,
  quarter: number,
  currentDataHash: string
): Promise<AIAnalysisResult | null> {
  const id = `${indicatorId}-${campus}-${year}Q${quarter}`;
  const cached = await db.aiAnalysisCache.get(id);
  
  if (!cached) return null;
  if (cached.dataHash !== currentDataHash) return null;  // 數據已變更
  if (new Date() > cached.expiresAt) return null;         // 已過期
  
  return cached.result;
}
```

### 快取失效條件

| 條件 | 行為 |
|------|------|
| 新數據匯入（月度值變化） | dataHash 不匹配 → 自動失效 |
| 管制圖參數調整 | CL/UCL/LCL 進入 hash → 自動失效 |
| 超過 30 天 | expiresAt 到期 → 自動失效 |
| 使用者手動點「重新分析」 | 忽略快取，強制重新呼叫 |
| 切換模型（Sonnet → Opus） | model 不匹配 → 自動失效 |

---

## 8.6.7 UI 整合：改善優先清單卡片

### AI 按鈕狀態機

```
[🤖 AI 深度分析]          ← 初始狀態（可點擊）
        │
        ├── 未設定 Key → 彈出設定面板
        │
        ├── 有快取 → 直接展開分析面板
        │
        └── 無快取 → 進入分析流程
                │
        [🤖 分析中...]           ← Loading 狀態（脈衝動畫）
                │
                ├── 成功 → 展開分析面板 + 存入快取
                │
                └── 失敗 → 顯示錯誤訊息 + [重試]
```

### 分析面板（成功時展開）

```
┌────────────────────────────────────────────────────────────────┐
│  🤖 AI 深度分析                      [重新分析]  [收合]        │
│  Claude Sonnet · 114.12.15 14:32 · 快取有效至 115.01.14       │
│                                                                │
│  📌 關鍵發現                                                    │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ 1. 死亡率上升主要集中在 10-11 月，12 月已有回降趨勢。       ││
│  │    這可能反映的是一個短期波動而非結構性惡化。                ││
│  │                                                            ││
│  │ 2. 連續 3 季異常是一個需要嚴肅對待的信號，即使最近一個月    ││
│  │    有好轉跡象，仍不應放鬆監測。                             ││
│  │                                                            ││
│  │ 3. 與同儕值差距 33% 偏大，但 TCPI 同儕值為去年數據，       ││
│  │    實際差距可能略有不同。                                   ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  🔍 可能原因方向                                                │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ 1. 收治病人嚴重度提高：建議調取同期 CMI 資料，確認病例      ││
│  │    組合是否確實改變。                                       ││
│  │                                                            ││
│  │ 2. 特定科別集中：10-11 月若有某科別死亡數偏高，可能是      ││
│  │    該科收治了數例困難個案，而非系統性問題。                  ││
│  │                                                            ││
│  │ 3. 急診轉 ICU 路徑延遲：如果同期急診壅塞加劇，可能導致     ││
│  │    重症病人的處置時機延後。                                 ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  📋 建議行動                                                    │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ 1. 拉出 10-12 月死亡個案的科別分佈（醫務室）               ││
│  │ 2. 比對同期 CMI 變化（病歷室 / DRG 小組）                  ││
│  │ 3. 檢視急診轉住院等床時間趨勢（急診部 / 床管中心）          ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  📎 建議補充資料                                                │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ 如能提供同期各科別死亡人數分佈及 CMI 趨勢，可進行更精確    ││
│  │ 的歸因分析。                                               ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  ⚠️ 以上為 AI 輔助分析，僅供參考，最終判斷應結合臨床專業知識。  │
│                                                                │
│  Token 使用：輸入 1,247 + 輸出 823 = 2,070                    │
│  預估費用：< $0.02 USD                                         │
└────────────────────────────────────────────────────────────────┘
```

---

## 8.6.8 費用控制機制

### 前端內建用量追蹤

```typescript
interface UsageTracker {
  month: string;             // '2025-01' 格式
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  estimatedCostUSD: number;
}

// 每次 API 呼叫後更新
async function trackUsage(tokens: { input: number; output: number }) {
  const month = new Date().toISOString().slice(0, 7);
  const existing = await db.settings.get(`usage-${month}`);
  
  // Sonnet 定價（截至 2025）
  const inputCostPer1M = 3.0;   // USD per 1M input tokens
  const outputCostPer1M = 15.0;  // USD per 1M output tokens
  
  const callCost = 
    (tokens.input / 1_000_000) * inputCostPer1M +
    (tokens.output / 1_000_000) * outputCostPer1M;
  
  const updated: UsageTracker = {
    month,
    totalInputTokens: (existing?.value?.totalInputTokens || 0) + tokens.input,
    totalOutputTokens: (existing?.value?.totalOutputTokens || 0) + tokens.output,
    callCount: (existing?.value?.callCount || 0) + 1,
    estimatedCostUSD: (existing?.value?.estimatedCostUSD || 0) + callCost,
  };
  
  await db.settings.put({ key: `usage-${month}`, value: updated, updatedAt: new Date() });
  return updated;
}
```

### 前端用量警告（軟上限）

```typescript
const MONTHLY_SOFT_LIMIT_USD = 5.0;  // 可在設定中調整

// 每次分析前檢查
async function checkUsageBudget(): Promise<{ allowed: boolean; usage: UsageTracker }> {
  const month = new Date().toISOString().slice(0, 7);
  const usage = (await db.settings.get(`usage-${month}`))?.value as UsageTracker;
  
  if (!usage) return { allowed: true, usage: { month, totalInputTokens: 0, totalOutputTokens: 0, callCount: 0, estimatedCostUSD: 0 } };
  
  if (usage.estimatedCostUSD >= MONTHLY_SOFT_LIMIT_USD) {
    return { allowed: false, usage };
  }
  return { allowed: true, usage };
}
```

軟上限到達時顯示警告但仍允許繼續（只是提醒），真正的硬上限由 Anthropic Console 控制。

### 設定面板中的用量顯示

```
┌──────────────────────────────────────────────┐
│  📊 本月 AI 使用量                             │
│                                               │
│  呼叫次數：12 次                               │
│  Token 用量：18,240（輸入）+ 9,876（輸出）     │
│  預估費用：$0.20 USD（約 6 元台幣）             │
│  月度預算：$5.00 USD                           │
│  ████░░░░░░░░░░░░░░░░  4%                     │
└──────────────────────────────────────────────┘
```

---

## 8.6.9 同期比較預留設計

基於前一輪的討論結論，同期比較（去年同季）不做為常態功能，但在 AI 分析的 prompt 中可以自動加入同期數據作為 context：

```typescript
// 如果有去年同期數據，自動附加在 prompt 中
function appendYoYContext(
  prompt: string,
  yoyData: { year: number; quarter: number; avg: number } | null
): string {
  if (!yoyData) return prompt;
  
  return prompt + `\n\n## 去年同期參考
- ${yoyData.year} 年 Q${yoyData.quarter} 均值：${yoyData.avg}
- 年對年變化：請一併考慮是否有季節性因素影響。`;
}
```

這樣 AI 在分析時會自動考慮季節性，但不需要在 UI 上增加額外的比較維度。

---

## 8.6.10 未來擴充：批次分析

Phase 1 只做單一指標分析，但架構上預留批次分析的能力：

```typescript
// Phase 2 批次分析（目前不實作，僅預留介面）
async function batchAnalyze(
  indicators: SanitizedAnalysisContext[],
  apiKey: string,
  options: { 
    concurrency: number;       // 同時呼叫數（建議 2-3，避免 rate limit）
    delayBetweenMs: number;    // 每次呼叫間隔（建議 1000ms）
    onProgress: (completed: number, total: number) => void;
  }
): Promise<Map<string, AIAnalysisResult>> {
  // 未來實作：使用 p-limit 控制並發
  // 每完成一個就更新 UI 進度條
  // 全部完成後生成一份總結性摘要（再呼叫一次 API 做彙整）
  throw new Error('批次分析尚未啟用');
}
```

批次分析的 UI 入口預留在改善優先清單的標題列：

```
🎯 改善優先清單    [逐一分析]  [批次分析全部（Phase 2）]  [匯出]
```

---

## 8.6.11 開發工時

| 工作項 | 估算工時 |
|--------|---------|
| API Key 加密儲存模組 | 0.5 天 |
| API Key 設定 UI（含驗證流程） | 1 天 |
| 資料安全檢查閘門 | 0.5 天 |
| Prompt 組裝 + 回應解析 | 1 天 |
| Claude API 呼叫模組（含錯誤處理） | 1 天 |
| 快取機制（Dexie 擴充 + hash 比對） | 0.5 天 |
| AI 分析面板 UI（展開/收合/Loading） | 1 天 |
| 費用追蹤 + 用量顯示 UI | 0.5 天 |
| 同期數據自動附加 | 0.5 天 |
| 測試 + 邊界情況處理 | 1 天 |
| **總計** | **~7.5 天（約 1.5 週）** |

### 更新後的總工期

| 項目 | 工時 |
|------|------|
| 基礎月度系統 | 9 週 |
| 季度雙模式（Ch.8） | 3.5 週 |
| 季度變化分析（Ch.8.5） | 4 週 |
| AI 深度分析（Ch.8.6）| 1.5 週 |
| **總計** | **18 週** |

注意：AI 深度分析可以跟季度變化分析的 UI 開發平行進行，因為它只影響改善優先清單卡片的一個展開區塊。實際 critical path 不會增加 1.5 週那麼多，大約多 0.5-1 週。

---

## 8.6.12 給 Claude Code 的實作提示

1. **`anthropic-dangerous-direct-browser-access` header 是必要的**：Anthropic API 預設不允許瀏覽器端直呼（CORS），加這個 header 會啟用瀏覽器直連模式。

2. **回應解析要有 fallback**：AI 不一定每次都完美遵守 XML 格式，如果 XML 解析失敗，直接顯示原始文字（用 `<pre>` 排版），不要讓整個功能壞掉。

3. **Loading 狀態要有脈衝動畫**：API 回應通常需要 3-8 秒，使用者需要知道系統在工作。用 CSS `@keyframes pulse` 做按鈕脈衝即可。

4. **快取 hash 只包含「會影響分析結果的數據」**：不要把 timestamp 或 UI 狀態加進 hash，否則快取永遠命不中。

5. **安全閘門是非 negotiable 的**：即使開發趕時間，也不能跳過 `runDataSafetyCheck()`。這是對醫院的承諾。

6. **Token 用量顯示在 UI 上**：讓使用者（品管主管）能追蹤費用，建立信任感。

7. **設定面板用 Dialog/Modal**，不要用獨立頁面：API key 設定是一次性動作，不需要佔一個完整路由。

8. **預設模型用 Sonnet**：Opus 品質更好但貴 5 倍。在設定面板提供選擇但預設 Sonnet，備註告知差異。品質指標分析的複雜度 Sonnet 完全足夠。

9. **不做 streaming（串流輸出）**：分析結果是完整結構化文本，不需要一個字一個字跑出來。等全部回來再一次渲染，實作更簡單，解析也更可靠。

10. **去年同期數據自動附加但不強制**：如果 Dexie 中有去年同季的數據，自動加進 prompt；沒有就不加。不要因為缺少同期數據就阻擋分析。

---

## 8.6.13 跨院區季度 AI 分析（Cross-Campus Quarterly Analysis）

> 本節定義「季度分析」頁面的 AI 分析標籤（Tab 2）架構，屬於 8.6 功能的延伸應用。

### 架構概覽：4 次 API 呼叫

```
使用者點擊 [開始 AI 分析]
        │
        ├── 費用提示彈窗（約 NT$2-4，4 次 API 呼叫）
        │         使用者確認
        │
        ▼（並行 Parallel）
  ┌─────┬─────────┬─────────┐
  │竹北 │  竹東   │  新竹   │    ← 三院區同時送出（Promise.all）
  └──┬──┴────┬────┴────┬────┘
     │       │         │
     ▼       ▼         ▼
  [院區1結果] [院區2結果] [院區3結果]
        │
        ▼（三院區完成後，Sequential 觸發）
  [共通問題分析]（輸入：三院區結果摘要）
        │
        ▼
  渲染完整 AI 分析報告
```

### 啟用條件

- 設定頁「啟用 AI 分析」開關已開啟（`localStorage: qip_ai_enabled = '1'`）
- API Key 已設定且有效
- 當前院區資料已載入（至少有一個有異常的指標）

### 費用提示 UI

```
┌─────────────────────────────────────────┐
│  ⚠ AI 分析費用提示                      │
│                                         │
│  本次將進行 4 次 Claude API 呼叫：       │
│    • 竹北院區分析                        │
│    • 竹東院區分析                        │
│    • 新竹院區分析                        │
│    • 跨院區共通問題分析                  │
│                                         │
│  預估費用：約 NT$2–4（依數據量而定）      │
│  快取期限：30 天（相同季度資料免重複計費） │
│                                         │
│   [取消]          [確認開始分析]          │
└─────────────────────────────────────────┘
```

### UI 排版

```
季度分析 > [統整表] [AI 分析]
                      ↑ 目前頁

─────────────────────────────────
  115年 Q1（1-3月）跨院區 AI 分析
─────────────────────────────────

  [竹北院區] ✓ 分析完成          ← 展開/收合卡片
  ─────────────────────────────
  [竹東院區] ⟳ 分析中...         ← 進度動畫
  ─────────────────────────────
  [新竹院區] ✓ 分析完成
  ─────────────────────────────
  [跨院區共通問題] ⏳ 等待院區分析完成

─────────────────────────────────
```

### 院區分析 Prompt 輸入（PromptInput 結構）

每個院區送出的 `PromptInput`：

```typescript
interface CrossCampusPromptInput {
  campus: '竹北' | '竹東' | '新竹';
  quarter: string;           // e.g., "115年Q1"
  quarterMonths: string[];   // e.g., ["115年1月","115年2月","115年3月"]
  prevQuarter: string;       // e.g., "114年Q4"

  // 只包含該院區有異常的指標
  anomalousIndicators: {
    code: string;
    name: string;
    category: string;
    direction: '↑' | '↓';
    unit: string;
    currentValue: number | string;  // 季末月值
    prevQuarterValue: number | string;
    changeDirection: 'improved' | 'deteriorated' | 'stable';
    latestStatus: string;           // 六級燈號
    isUniqueToThisCampus: boolean;  // 其他院區無此指標 = 院區特色
    anomalyTypes: string[];         // e.g., ["持續異常","趨勢危險"]
  }[];

  // 三院區都有此指標，但本院區異常
  sharedAnomalousIndicators: string[];  // 指標代碼列表
}
```

### 院區分析 System Prompt

```
你是一位資深醫院品質管理顧問，專精於 QI（品質改善）指標分析。
請以繁體中文（台灣用語）回應。

你將收到某一院區本季的異常指標清單，以及與上一季的比較。
請輸出 JSON 格式，結構如下：

{
  "campus_summary": "<30 字以內的本院區整體評估>",
  "key_concerns": [
    {
      "indicator_code": "<指標代碼>",
      "concern": "<核心問題描述>",
      "urgency": "high|medium|low",
      "possible_causes": ["<原因1>", "<原因2>"],
      "recommended_action": "<最優先改善行動>"
    }
  ],
  "campus_strengths": ["<優點1>", "<優點2>"],
  "focus_this_quarter": "<本季最需關注的 1-2 件事（50 字以內）>"
}

注意：
- key_concerns 最多列 5 項，按緊迫程度排序
- 若某指標標記為 isUniqueToThisCampus=true，在分析中強調這是院區特色，需特別關注
- 若與上一季相比惡化，urgency 提高一級
```

### 共通問題分析 System Prompt

在三院區分析完成後，將各院區結果摘要送入：

```typescript
interface CommonIssuesPromptInput {
  quarter: string;
  campusResults: {
    campus: string;
    summary: string;           // campus_summary 欄位
    topConcerns: string[];     // 各院區 top 3 key_concerns 的 concern 欄位
    sharedAnomalous: string[]; // 三院區共通異常指標代碼
  }[];
  allSharedAnomalousIndicators: {
    code: string;
    name: string;
    allCampusStatus: Record<string, string>; // { '竹北': '紅燈', ... }
  }[];
}
```

System Prompt：

```
你是一位資深醫院品質管理顧問。
你將收到同一醫院體系三個院區（竹北、竹東、新竹）的本季 AI 分析結果摘要。

請識別跨院區的共通問題，並給出整體建議。
請輸出 JSON 格式：

{
  "common_issues": [
    {
      "issue": "<共通問題描述>",
      "affected_campuses": ["竹北", "竹東"],
      "related_indicators": ["<指標代碼1>"],
      "root_cause_hypothesis": "<可能根本原因>",
      "system_level_action": "<需要院級層面介入的改善行動>"
    }
  ],
  "campus_differentiation": "<各院區最顯著差異的摘要（50 字以內）>",
  "priority_recommendation": "<給品管委員會的最高優先建議（60 字以內）>",
  "positive_highlights": ["<跨院區正面亮點1>"]
}

注意：
- common_issues 最多 3 項，只列真正跨院區的問題
- 若某指標三院區都異常，必須列入 common_issues
```

### 快取策略

| 快取維度 | 說明 |
|--------|------|
| Cache Key | `cross_campus_{campus}_{quarter}` |
| TTL | 30 天 |
| Hash 計算 | 院區所有異常指標的代碼 + 值 + 燈號（排序後 JSON） |
| 共通問題 | `cross_campus_common_{quarter}`，依賴各院區結果 hash |
| 失效條件 | 重新匯入該季資料（任一院區 hash 改變）|

### AI 啟用開關實作

`lib/ai/apiKeyManager.ts` 新增：

```typescript
export function isAIEnabled(): boolean {
  return localStorage.getItem('qip_ai_enabled') === '1';
}

export function setAIEnabled(enabled: boolean): void {
  localStorage.setItem('qip_ai_enabled', enabled ? '1' : '0');
}
```

`app/settings/ai/page.tsx` 設定頁新增一個 Toggle：

```
┌───────────────────────────────────────┐
│  啟用 AI 分析功能                [ON] │
│  關閉後「季度分析 > AI 分析」頁籤會隱藏 │
└───────────────────────────────────────┘
```

### 實作組件清單

| 組件 | 路徑 | 說明 |
|------|------|------|
| `CrossCampusAITab` | `components/cross-campus/CrossCampusAITab.tsx` | AI 分析 Tab 整體容器，管理 4 次呼叫狀態 |
| `CampusAIPanel` | `components/cross-campus/CampusAIPanel.tsx` | 單一院區分析結果卡片（展開/收合） |
| `CommonIssuesPanel` | `components/cross-campus/CommonIssuesPanel.tsx` | 共通問題分析結果卡片 |
| `crossCampusPromptBuilder` | `lib/ai/promptBuilder.ts`（擴充） | 院區分析 + 共通問題 Prompt 組裝函式 |

### 開發工時估算（跨院區 AI 分析）

| 工作項 | 估算工時 |
|--------|---------|
| 跨院區資料聚合邏輯（讀取三院區異常指標） | 1 天 |
| 費用提示對話框 + 4 呼叫協調邏輯 | 0.5 天 |
| `CampusAIPanel` 組件 | 1 天 |
| `CommonIssuesPanel` 組件 | 0.5 天 |
| Prompt 組裝（院區 + 共通問題） | 1 天 |
| 快取整合（4 個獨立 cache key） | 0.5 天 |
| AI 啟用開關設定 UI | 0.5 天 |
| 測試 + 邊界處理 | 0.5 天 |
| **總計** | **~5.5 天（約 1 週）** |
