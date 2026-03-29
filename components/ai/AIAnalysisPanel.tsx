'use client';

/**
 * AI 深度分析面板元件
 *
 * 在指標詳情頁以可展開面板形式呈現 AI 分析結果。
 * 包含：觸發按鈕、安全確認對話框、載入動畫、結構化結果顯示、原始文字 fallback。
 */

import { useState, useCallback } from 'react';
import { Bot, RefreshCw, ChevronDown, ChevronUp, AlertCircle, Shield, Zap, Clock, CheckCircle2, CircleDot, FileDown } from 'lucide-react';
import { analyzeIndicator, AIAnalysisError, type AIAnalysisResult } from '@/lib/ai/claudeClient';
import { hasApiKey } from '@/lib/ai/apiKeyManager';
import { getMonthlyUsage, formatCostTWD, formatTokens, isOverSoftLimit, getSoftLimitUSD } from '@/lib/ai/usageTracker';
import type { PromptInput } from '@/lib/ai/promptBuilder';
import Link from 'next/link';

interface Props {
  promptInput: PromptInput;
  cacheKey: string;
}

type PanelState = 'idle' | 'safety_warning' | 'limit_warning' | 'loading' | 'done' | 'error';

const TIMELINE_COLORS: Record<string, string> = {
  '立即': 'bg-red-100 text-red-700',
  '本週': 'bg-orange-100 text-orange-700',
  '本月': 'bg-yellow-100 text-yellow-700',
  '本季': 'bg-blue-100 text-blue-700',
};

const LIKELIHOOD_COLORS: Record<string, string> = {
  '高': 'text-red-600 font-semibold',
  '中': 'text-orange-600 font-semibold',
  '低': 'text-gray-500',
};

export function AIAnalysisPanel({ promptInput, cacheKey }: Props) {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [errorCode, setErrorCode] = useState<string>('');
  const [safetyDetails, setSafetyDetails] = useState<{ maskedFields: string[]; piiWarnings: string[] } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [isForceRefresh, setIsForceRefresh] = useState(false);

  const runAnalysis = useCallback(async (opts: { forceRefresh?: boolean; skipLimitCheck?: boolean } = {}) => {
    setPanelState('loading');
    setErrorMsg('');
    setErrorCode('');
    try {
      const res = await analyzeIndicator(promptInput, cacheKey, opts);
      setResult(res);
      setPanelState('done');
      setExpanded(true);
    } catch (err) {
      if (err instanceof AIAnalysisError) {
        setErrorCode(err.code);
        setErrorMsg(err.message);

        if (err.code === 'SAFETY_BLOCKED') {
          const details = err.details as { maskedFields: string[]; piiWarnings: string[] };
          setSafetyDetails(details);
          setPanelState('safety_warning');
          return;
        }
        if (err.code === 'OVER_LIMIT') {
          setPanelState('limit_warning');
          return;
        }
      } else {
        setErrorMsg('發生未預期的錯誤，請稍後再試。');
        setErrorCode('UNKNOWN');
      }
      setPanelState('error');
    }
  }, [promptInput, cacheKey]);

  const handleAnalyzeClick = useCallback(() => {
    if (!hasApiKey()) {
      setErrorCode('NO_API_KEY');
      setErrorMsg('尚未設定 Claude API Key。');
      setPanelState('error');
      return;
    }
    if (isOverSoftLimit()) {
      setPanelState('limit_warning');
      return;
    }
    runAnalysis({ forceRefresh: isForceRefresh });
  }, [runAnalysis, isForceRefresh]);

  // ============================
  // 尚未分析的初始狀態
  // ============================
  if (panelState === 'idle') {
    return (
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 rounded-lg p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Bot size={20} className="text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">AI 深度分析</h3>
              <p className="text-xs text-gray-500">由 Claude 分析可能原因與改善行動</p>
            </div>
          </div>
          <button
            onClick={handleAnalyzeClick}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Zap size={14} />
            開始分析
          </button>
        </div>
        <UsageSummary />
      </div>
    );
  }

  // ============================
  // 安全閘門警告
  // ============================
  if (panelState === 'safety_warning' && safetyDetails) {
    return (
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-5">
        <div className="flex items-start gap-3 mb-4">
          <Shield size={20} className="text-orange-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-orange-800 mb-1">資料安全警告</h3>
            {safetyDetails.piiWarnings.length > 0 && (
              <p className="text-xs text-orange-700 mb-2">
                偵測到可能的個資欄位：{safetyDetails.piiWarnings.join('、')}
              </p>
            )}
            {safetyDetails.maskedFields.length > 0 && (
              <p className="text-xs text-orange-700">
                以下欄位已自動遮蔽（分子 &lt; 10）：{safetyDetails.maskedFields.join('、')}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => runAnalysis({ skipLimitCheck: false })}
            className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
          >
            已確認，繼續分析
          </button>
          <button
            onClick={() => setPanelState('idle')}
            className="px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  // ============================
  // 費用上限警告
  // ============================
  if (panelState === 'limit_warning') {
    const usage = getMonthlyUsage();
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-5">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle size={20} className="text-yellow-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-yellow-800 mb-1">
              本月用量已達軟上限（${getSoftLimitUSD()} USD）
            </h3>
            <p className="text-xs text-yellow-700">
              本月累計費用約 {formatCostTWD(usage.estimatedUSD)}（{formatTokens(usage.inputTokens + usage.outputTokens)} tokens，共 {usage.requestCount} 次）
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => runAnalysis({ skipLimitCheck: true })}
            className="px-3 py-1.5 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700"
          >
            仍要繼續
          </button>
          <button
            onClick={() => setPanelState('idle')}
            className="px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  // ============================
  // 載入中
  // ============================
  if (panelState === 'loading') {
    return (
      <div className="bg-purple-50 border border-purple-100 rounded-lg p-5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bot size={20} className="text-purple-400" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-purple-500 rounded-full animate-ping" />
          </div>
          <div>
            <p className="text-sm font-medium text-purple-800">Claude 分析中</p>
            <p className="text-xs text-purple-500">正在讀取指標數據並生成分析報告...</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 bg-purple-100 rounded-full overflow-hidden">
          <div className="h-full bg-purple-400 rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  // ============================
  // 錯誤
  // ============================
  if (panelState === 'error') {
    return (
      <div className="bg-red-50 border border-red-100 rounded-lg p-5">
        <div className="flex items-start gap-3 mb-3">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-red-700">{errorMsg}</p>
            {errorCode === 'NO_API_KEY' && (
              <Link href="/settings/ai" className="text-xs text-blue-600 hover:underline mt-1 block">
                → 前往設定 API Key
              </Link>
            )}
          </div>
        </div>
        <button
          onClick={() => setPanelState('idle')}
          className="text-xs text-red-600 hover:underline"
        >
          關閉
        </button>
      </div>
    );
  }

  // ============================
  // 分析完成
  // ============================
  if (panelState === 'done' && result) {
    const { parsed, rawText, isCached } = result;

    return (
      <div className="bg-white border border-purple-100 rounded-lg shadow-sm">
        {/* 標題列 */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-purple-50/50 transition-colors rounded-lg"
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-purple-100 rounded-lg">
              <Bot size={16} className="text-purple-600" />
            </div>
            <span className="text-sm font-semibold text-gray-800">AI 深度分析結果</span>
            {isCached && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Clock size={12} /> 快取
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {parsed && (
              <button
                onClick={async e => {
                  e.stopPropagation();
                  const { exportSingleIndicatorReport } = await import('@/lib/export/reportExporter');
                  await exportSingleIndicatorReport({
                    indicatorCode: promptInput.meta.code,
                    indicatorName: promptInput.meta.name,
                    campus: promptInput.campus,
                    latestValue: promptInput.latestValue != null ? String(promptInput.latestValue) : '—',
                    latestMonth: promptInput.latestMonth ?? '—',
                    peerValue: promptInput.peerValue != null ? String(promptInput.peerValue) : undefined,
                    parsed,
                  });
                }}
                className="p-1 text-gray-400 hover:text-purple-600 rounded"
                title="匯出 Word 報告"
              >
                <FileDown size={14} />
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); setIsForceRefresh(true); runAnalysis({ forceRefresh: true }); }}
              className="p-1 text-gray-400 hover:text-purple-600 rounded"
              title="重新分析"
            >
              <RefreshCw size={14} />
            </button>
            {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-4 border-t border-purple-50">
            {parsed ? (
              <StructuredResult parsed={parsed} />
            ) : (
              <div>
                <p className="text-xs text-gray-500 mb-2 mt-3">無法解析結構化格式，顯示原始回應：</p>
                <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded p-3 text-xs leading-relaxed">
                  {rawText}
                </div>
              </div>
            )}

            {/* 原始回應切換 */}
            {parsed && (
              <div className="mt-3">
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  {showRaw ? '▲ 隱藏原始回應' : '▼ 顯示原始回應'}
                </button>
                {showRaw && (
                  <div className="mt-2 text-xs text-gray-500 whitespace-pre-wrap bg-gray-50 rounded p-3 leading-relaxed font-mono">
                    {rawText}
                  </div>
                )}
              </div>
            )}

            {/* 用量資訊 */}
            <UsageSummary compact />
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ============================
// 結構化結果
// ============================

function StructuredResult({ parsed }: { parsed: NonNullable<AIAnalysisResult['parsed']> }) {
  return (
    <div className="space-y-4 mt-3">
      {/* 關鍵發現 */}
      {parsed.keyFindings.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">關鍵發現</h4>
          <ul className="space-y-1.5">
            {parsed.keyFindings.map((finding, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                <CheckCircle2 size={14} className="text-purple-500 mt-0.5 shrink-0" />
                {finding}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 可能原因 */}
      {parsed.possibleCauses.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">可能原因</h4>
          <div className="space-y-2">
            {parsed.possibleCauses.map((item, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CircleDot size={13} className="text-gray-400" />
                  <span className="text-sm text-gray-800 flex-1">{item.cause}</span>
                  <span className={`text-xs ${LIKELIHOOD_COLORS[item.likelihood] ?? 'text-gray-500'}`}>
                    可能性：{item.likelihood}
                  </span>
                </div>
                {item.evidence && (
                  <p className="text-xs text-gray-500 ml-5">{item.evidence}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 建議行動 */}
      {parsed.recommendedActions.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">建議行動</h4>
          <div className="space-y-2">
            {parsed.recommendedActions.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-100">
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${TIMELINE_COLORS[item.timeline] ?? 'bg-gray-100 text-gray-600'}`}>
                  {item.timeline}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-gray-800">{item.action}</p>
                  {item.owner && (
                    <p className="text-xs text-gray-400 mt-0.5">負責：{item.owner}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 還需要哪些資料 */}
      {parsed.additionalDataNeeded.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">需要更多資料</h4>
          <ul className="space-y-1">
            {parsed.additionalDataNeeded.map((item, i) => (
              <li key={i} className="text-xs text-gray-500 flex items-start gap-2">
                <span className="text-gray-300 mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ============================
// 用量摘要
// ============================

function UsageSummary({ compact = false }: { compact?: boolean }) {
  const usage = getMonthlyUsage();
  if (usage.requestCount === 0) return null;

  return (
    <div className={`${compact ? 'mt-3 pt-3 border-t border-gray-100' : 'mt-3 pt-3 border-t border-purple-100'}`}>
      <p className="text-xs text-gray-400">
        本月用量：{usage.requestCount} 次分析 ·{' '}
        {formatTokens(usage.inputTokens + usage.outputTokens)} tokens ·{' '}
        約 {formatCostTWD(usage.estimatedUSD)}
        {isOverSoftLimit() && (
          <span className="ml-1 text-yellow-600">⚠ 已達軟上限</span>
        )}
      </p>
    </div>
  );
}
