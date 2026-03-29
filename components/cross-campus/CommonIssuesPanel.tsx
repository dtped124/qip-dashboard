'use client';

import { Loader2, AlertCircle, CheckCircle2, Users } from 'lucide-react';
import type { ParsedCommonIssues } from '@/lib/ai/promptBuilder';
import type { PanelStatus } from './CampusAIPanel';

interface Props {
  status: PanelStatus;
  result: ParsedCommonIssues | null;
  rawText?: string;
  error?: string;
}

export function CommonIssuesPanel({ status, result, rawText, error }: Props) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border-b border-indigo-100">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-indigo-600" />
          <span className="font-medium text-indigo-700 text-sm">跨院區共通問題分析</span>
        </div>
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
          <span className="text-xs text-gray-400">等待院區分析完成...</span>
        )}
      </div>

      {status === 'loading' && (
        <div className="p-4 space-y-3 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
        </div>
      )}

      {status === 'error' && (
        <div className="p-4">
          <p className="text-sm text-red-600">{error || '分析失敗，請稍後再試。'}</p>
        </div>
      )}

      {status === 'pending' && (
        <div className="p-4 text-sm text-gray-400 text-center py-6">
          等待三院區分析完成後自動執行...
        </div>
      )}

      {status === 'done' && result && (
        <div className="p-4 space-y-4">
          {/* Priority recommendation */}
          {result.priority_recommendation && (
            <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <div className="text-xs font-semibold text-indigo-600 mb-1">院級優先建議</div>
              <p className="text-sm text-indigo-800 font-medium">{result.priority_recommendation}</p>
            </div>
          )}

          {/* Common issues */}
          {result.common_issues.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                共通問題（{result.common_issues.length} 項）
              </h4>
              <div className="space-y-3">
                {result.common_issues.map((issue, i) => (
                  <div key={i} className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-orange-800">{issue.issue}</p>
                      <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                        {issue.affected_campuses.map(c => (
                          <span key={c} className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                    {issue.root_cause_hypothesis && (
                      <p className="text-xs text-orange-700 mt-1">
                        可能根本原因：{issue.root_cause_hypothesis}
                      </p>
                    )}
                    {issue.system_level_action && (
                      <p className="text-xs text-orange-800 font-medium mt-1">
                        院級行動：{issue.system_level_action}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Campus differentiation */}
          {result.campus_differentiation && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">各院區差異</h4>
              <p className="text-sm text-gray-600">{result.campus_differentiation}</p>
            </div>
          )}

          {/* Positive highlights */}
          {result.positive_highlights.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">正面亮點</h4>
              <ul className="text-sm text-gray-600 space-y-0.5">
                {result.positive_highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 size={14} className="text-green-500 mt-0.5 shrink-0" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {status === 'done' && !result && rawText && (
        <div className="p-4">
          <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-48">{rawText}</pre>
        </div>
      )}
    </div>
  );
}
