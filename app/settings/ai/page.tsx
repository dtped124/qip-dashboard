'use client';

import { useState, useEffect } from 'react';
import { Bot, Eye, EyeOff, CheckCircle2, XCircle, Trash2, BarChart2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import {
  saveApiKey, loadApiKey, clearApiKey, hasApiKey,
  validateApiKeyFormat, getModelSetting, setModelSetting,
  isAIEnabled, setAIEnabled,
} from '@/lib/ai/apiKeyManager';
import {
  getMonthlyUsage, resetUsage, formatCostTWD, formatTokens,
  isOverSoftLimit, getSoftLimitUSD,
} from '@/lib/ai/usageTracker';
import { getCacheStats, clearAllAICache } from '@/lib/ai/cache';

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6（建議）', note: '速度快、品質好、費用適中' },
  { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6（最強）',   note: '分析最深入，費用較高' },
  { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5（最快）',  note: '速度最快、費用最低，適合頻繁使用' },
];

export default function AISettingsPage() {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'unknown' | 'set' | 'unset'>('unknown');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<'ok' | 'fail' | null>(null);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6');
  const [cacheStats, setCacheStats] = useState({ count: 0, oldestDate: null as Date | null });
  const [usage, setUsage] = useState<ReturnType<typeof getMonthlyUsage> | null>(null);
  const [aiEnabled, setAiEnabledState] = useState(false);

  useEffect(() => {
    // 讀取初始狀態（client-side only，避免 SSR hydration mismatch）
    setKeyStatus(hasApiKey() ? 'set' : 'unset');
    setSelectedModel(getModelSetting());
    setCacheStats(getCacheStats());
    setUsage(getMonthlyUsage());
    setAiEnabledState(isAIEnabled());
  }, []);

  function handleToggleAI() {
    const next = !aiEnabled;
    setAIEnabled(next);
    setAiEnabledState(next);
  }

  async function handleSaveKey() {
    const trimmed = apiKeyInput.trim();
    if (!validateApiKeyFormat(trimmed)) {
      setSaveResult('error');
      return;
    }
    setSaving(true);
    try {
      await saveApiKey(trimmed);
      setApiKeyInput('');
      setKeyStatus('set');
      setSaveResult('success');
    } catch {
      setSaveResult('error');
    } finally {
      setSaving(false);
    }
  }

  function handleClearKey() {
    if (!confirm('確定要清除 API Key？清除後需重新輸入才能使用 AI 分析。')) return;
    clearApiKey();
    setKeyStatus('unset');
    setSaveResult(null);
    setVerifyResult(null);
  }

  async function handleVerifyKey() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const key = await loadApiKey();
      if (!key) { setVerifyResult('fail'); return; }

      // 送一個極短的測試請求
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      setVerifyResult(resp.ok ? 'ok' : 'fail');
    } catch {
      setVerifyResult('fail');
    } finally {
      setVerifying(false);
    }
  }

  function handleModelChange(model: string) {
    setSelectedModel(model);
    setModelSetting(model);
  }

  function handleClearCache() {
    if (!confirm('確定要清除所有 AI 分析快取？')) return;
    clearAllAICache();
    setCacheStats({ count: 0, oldestDate: null });
  }

  function handleResetUsage() {
    if (!confirm('確定要重置本月用量統計？')) return;
    resetUsage();
    setUsage(getMonthlyUsage());
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <div className="p-2 bg-purple-100 rounded-lg">
          <Bot size={20} className="text-purple-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">AI 深度分析設定</h1>
      </div>

      <div className="space-y-5">
        {/* ===== AI 功能開關 ===== */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">啟用 AI 分析功能</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                關閉後「季度分析 › AI 分析」頁籤將顯示為灰色停用狀態
              </p>
            </div>
            <button
              onClick={handleToggleAI}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                aiEnabled ? 'bg-purple-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  aiEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </section>

        {/* ===== API Key 管理 ===== */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Claude API Key</h2>
          <p className="text-xs text-gray-400 mb-4">
            Key 以 AES-GCM 加密後儲存於本機，不會上傳至任何伺服器。
            請至 <a href="https://console.anthropic.com" target="_blank" rel="noopener" className="text-purple-600 hover:underline">Anthropic Console</a> 取得 API Key。
          </p>

          {/* 目前狀態 */}
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-gray-50">
            {keyStatus === 'set' ? (
              <><CheckCircle2 size={16} className="text-green-500" />
                <span className="text-sm text-green-700">已設定 API Key</span>
              </>
            ) : keyStatus === 'unset' ? (
              <><XCircle size={16} className="text-red-400" />
                <span className="text-sm text-red-600">尚未設定 API Key</span>
              </>
            ) : (
              <span className="text-sm text-gray-400">讀取中...</span>
            )}
          </div>

          {/* 輸入區 */}
          <div className="space-y-2 mb-3">
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={e => { setApiKeyInput(e.target.value); setSaveResult(null); }}
                placeholder="sk-ant-..."
                className="w-full pr-10 pl-3 py-2 text-sm border border-gray-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {apiKeyInput && !validateApiKeyFormat(apiKeyInput.trim()) && (
              <p className="text-xs text-red-500">格式不正確，API Key 應以 sk-ant- 開頭</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveKey}
              disabled={saving || !apiKeyInput.trim()}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? '儲存中...' : '儲存 Key'}
            </button>

            {keyStatus === 'set' && (
              <>
                <button
                  onClick={handleVerifyKey}
                  disabled={verifying}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  {verifying ? '驗證中...' : '驗證 Key'}
                </button>
                <button
                  onClick={handleClearKey}
                  className="flex items-center gap-1 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                >
                  <Trash2 size={14} /> 清除
                </button>
              </>
            )}
          </div>

          {saveResult === 'success' && (
            <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 size={12} /> API Key 已加密儲存
            </p>
          )}
          {saveResult === 'error' && (
            <p className="mt-2 text-xs text-red-500">儲存失敗，請確認格式是否正確</p>
          )}
          {verifyResult === 'ok' && (
            <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 size={12} /> API Key 驗證成功
            </p>
          )}
          {verifyResult === 'fail' && (
            <p className="mt-2 text-xs text-red-500">驗證失敗：Key 無效或已過期</p>
          )}
        </section>

        {/* ===== 模型選擇 ===== */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">分析模型</h2>
          <div className="space-y-2">
            {AVAILABLE_MODELS.map(m => (
              <label
                key={m.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedModel === m.id
                    ? 'border-purple-300 bg-purple-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={selectedModel === m.id}
                  onChange={() => handleModelChange(m.id)}
                  className="mt-0.5 accent-purple-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">{m.label}</p>
                  <p className="text-xs text-gray-500">{m.note}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* ===== 用量統計 ===== */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">本月用量統計</h2>
            <button
              onClick={handleResetUsage}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              重置
            </button>
          </div>

          {usage ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <BarChart2 size={14} className="text-purple-500" />
                  <span className="text-xs text-gray-500">分析次數</span>
                </div>
                <p className="text-lg font-bold text-gray-800">{usage.requestCount} 次</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">Token 用量</div>
                <p className="text-lg font-bold text-gray-800">{formatTokens(usage.inputTokens + usage.outputTokens)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">預估費用（USD）</div>
                <p className={`text-lg font-bold ${isOverSoftLimit() ? 'text-yellow-600' : 'text-gray-800'}`}>
                  ${usage.estimatedUSD.toFixed(3)}
                  {isOverSoftLimit() && <span className="text-xs ml-1">⚠</span>}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">預估費用（台幣）</div>
                <p className="text-lg font-bold text-gray-800">{formatCostTWD(usage.estimatedUSD)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">無用量記錄</p>
          )}

          <p className="mt-3 text-xs text-gray-400">
            軟上限：${getSoftLimitUSD()} USD / 月（超過時顯示警告，硬上限請至 Anthropic Console 設定）
          </p>
        </section>

        {/* ===== 快取管理 ===== */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">分析快取</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">
                目前快取：{cacheStats.count} 筆
                {cacheStats.oldestDate && (
                  <span className="text-xs text-gray-400 ml-1">
                    （最早：{cacheStats.oldestDate.toLocaleDateString('zh-TW')}）
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">快取有效期 30 天，數據更新後自動失效</p>
            </div>
            {cacheStats.count > 0 && (
              <button
                onClick={handleClearCache}
                className="flex items-center gap-1 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
              >
                <Trash2 size={12} /> 清除快取
              </button>
            )}
          </div>
        </section>

        {/* ===== 關於 ===== */}
        <section className="bg-gray-50 rounded-lg border border-gray-100 p-4">
          <h2 className="text-sm font-semibold text-gray-600 mb-2">關於 AI 分析</h2>
          <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
            <li>AI 分析需要網路連線（呼叫 Anthropic API），其餘功能完全離線</li>
            <li>每次分析約消耗 1,500-2,100 tokens，約 NT$ 0.5-1</li>
            <li>分析結果會快取 30 天，相同指標數據不會重複計費</li>
            <li>個資安全：送出前自動過濾 PII</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
