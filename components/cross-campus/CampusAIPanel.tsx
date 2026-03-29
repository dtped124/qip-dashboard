'use client';

import { ChevronDown, ChevronUp, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import type { ParsedCampusAnalysis } from '@/lib/ai/promptBuilder';

export type PanelStatus = 'pending' | 'loading' | 'done' | 'error';

interface Props {
  campus: string;
  status: PanelStatus;
  result: ParsedCampusAnalysis | null;
  rawText?: string;
  error?: string;
}

const URGENCY_STYLE = {
  high:   'bg-red-50 border-red-200 text-red-700',
  medium: 'bg-orange-50 border-orange-200 text-orange-700',
  low:    'bg-yellow-50 border-yellow-200 text-yellow-700',
};
const URGENCY_LABEL = { high: '高', medium: '中', low: '低' };

export function CampusAIPanel({ campus, status, result, rawText, error }: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 text-sm">{campus}院區</span>
          {status === 'loading' && (
            <span className="flex items-center gap-1 text-xs text-purple-600">
              <Loader2 size={12} className="animate-spin" /> 分析中...
            </span>
          )}
          {status === 'done' && result && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 size={12} /> 分析完成
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle size={12} /> 分析失敗
            </span>
          )}
          {status === 'pending' && (
            <span className="text-xs text-gray-400">等待中...</span>
          )}
        </div>
        {status === 'done' && (expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />)}
      </button>

      {/* Loading skeleton */}
      {status === 'loading' && (
        <div className="p-4 space-y-3 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="p-4">
          <p className="text-sm text-red-600">{error || '分析失敗，請稍後再試。'}</p>
          {rawText && (
            <details className="mt-2">
              <summary className="text-xs text-gray-400 cursor-pointer">原始回應</summary>
              <pre className="mt-1 text-xs text-gray-500 whitespace-pre-wrap overflow-auto max-h-32">{rawText}</pre>
            </details>
          )}
        </div>
      )}

      {/* Parsed result */}
      {status === 'done' && result && expanded && (
        <div className="p-4 space-y-4">
          {/* Summary */}
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-sm text-purple-800">{result.campus_summary}</p>
          </div>

          {/* Focus */}
          {result.focus_this_quarter && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">本季重點</h4>
              <p className="text-sm text-gray-700">{result.focus_this_quarter}</p>
            </div>
          )}

          {/* Key concerns */}
          {result.key_concerns.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">重點關注（{result.key_concerns.length} 項）</h4>
              <div className="space-y-2">
                {result.key_concerns.map((concern, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border text-sm ${URGENCY_STYLE[concern.urgency] || URGENCY_STYLE.low}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-medium">{concern.concern}</span>
                      <span className="text-xs shrink-0 px-1.5 py-0.5 rounded bg-white bg-opacity-60">
                        {concern.indicator_code} · 緊迫度：{URGENCY_LABEL[concern.urgency] || concern.urgency}
                      </span>
                    </div>
                    {concern.possible_causes.length > 0 && (
                      <p className="text-xs mt-1 opacity-80">
                        可能原因：{concern.possible_causes.join('；')}
                      </p>
                    )}
                    {concern.recommended_action && (
                      <p className="text-xs mt-1 font-medium">
                        建議行動：{concern.recommended_action}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strengths */}
          {result.campus_strengths.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">院區優點</h4>
              <ul className="text-sm text-gray-600 space-y-0.5">
                {result.campus_strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 size={14} className="text-green-500 mt-0.5 shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Done but no parsed result — show raw */}
      {status === 'done' && !result && rawText && expanded && (
        <div className="p-4">
          <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-48">{rawText}</pre>
        </div>
      )}
    </div>
  );
}
