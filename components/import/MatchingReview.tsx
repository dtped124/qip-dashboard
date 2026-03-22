'use client';

import { useState } from 'react';
import { Check, X, AlertTriangle, HelpCircle, Link } from 'lucide-react';
import type { MatchResult } from '@/lib/types';
import { INDICATOR_META } from '@/lib/constants';

interface Props {
  results: MatchResult[];
  onConfirm: (confirmed: { excelName: string; indicatorCode: string }[]) => void;
  onCancel: () => void;
}

const CONFIDENCE_CONFIG: Record<string, { label: string; color: string; icon: typeof Check }> = {
  exact:        { label: '完全匹配', color: 'text-green-600 bg-green-50', icon: Check },
  alias:        { label: '別名匹配', color: 'text-blue-600 bg-blue-50', icon: Link },
  contains:     { label: '包含匹配', color: 'text-yellow-600 bg-yellow-50', icon: AlertTriangle },
  similar:      { label: '模糊匹配', color: 'text-orange-600 bg-orange-50', icon: HelpCircle },
  unrecognized: { label: '無法識別', color: 'text-red-600 bg-red-50', icon: X },
};

export function MatchingReview({ results, onConfirm, onCancel }: Props) {
  // 每個結果的使用者選擇狀態
  const [selections, setSelections] = useState<Map<string, string | null>>(() => {
    const map = new Map<string, string | null>();
    results.forEach(r => {
      map.set(r.excelName, r.indicatorCode);
    });
    return map;
  });

  // 所有可用指標列表（用於下拉選擇）
  const allIndicators = Object.entries(INDICATOR_META).map(([code, meta]) => ({
    code,
    name: meta.name,
  }));

  function handleSelectionChange(excelName: string, code: string | null) {
    setSelections(prev => {
      const next = new Map(prev);
      next.set(excelName, code);
      return next;
    });
  }

  function handleConfirm() {
    const confirmed: { excelName: string; indicatorCode: string }[] = [];
    selections.forEach((code, excelName) => {
      if (code) {
        confirmed.push({ excelName, indicatorCode: code });
      }
    });
    onConfirm(confirmed);
  }

  const exactCount = results.filter(r => r.confidence === 'exact' || r.confidence === 'alias').length;
  const needReviewCount = results.filter(r => r.confidence === 'similar' || r.confidence === 'contains').length;
  const unrecognizedCount = results.filter(r => r.confidence === 'unrecognized').length;

  return (
    <div className="space-y-4">
      {/* 摘要 */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-green-600">
          自動匹配: {exactCount}
        </span>
        <span className="text-orange-600">
          需確認: {needReviewCount}
        </span>
        <span className="text-red-600">
          無法識別: {unrecognizedCount}
        </span>
      </div>

      {/* 匹配結果列表 */}
      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Excel 名稱</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-24">匹配狀態</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">對應指標</th>
              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 w-16">分數</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => {
              const conf = CONFIDENCE_CONFIG[r.confidence];
              const Icon = conf.icon;
              const selectedCode = selections.get(r.excelName);
              const needsAttention = r.confidence === 'similar' || r.confidence === 'contains' || r.confidence === 'unrecognized';

              return (
                <tr
                  key={r.excelName}
                  className={`border-t border-gray-100 ${needsAttention ? 'bg-yellow-50/30' : ''}`}
                >
                  <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={r.excelName}>
                    {r.excelName}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${conf.color}`}>
                      <Icon size={10} />
                      {conf.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {needsAttention ? (
                      <select
                        value={selectedCode ?? ''}
                        onChange={e => handleSelectionChange(r.excelName, e.target.value || null)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- 略過 --</option>
                        {r.indicatorCode && (
                          <option value={r.indicatorCode}>
                            {r.indicatorCode} - {r.indicatorName} (建議)
                          </option>
                        )}
                        {allIndicators
                          .filter(i => i.code !== r.indicatorCode)
                          .map(i => (
                            <option key={i.code} value={i.code}>
                              {i.code} - {i.name}
                            </option>
                          ))
                        }
                      </select>
                    ) : (
                      <span className="text-xs text-gray-600">
                        {selectedCode && (
                          <>
                            <span className="font-mono text-gray-400">{selectedCode}</span>
                            {' '}
                            {r.indicatorName}
                          </>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-gray-400">
                    {(r.score * 100).toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 按鈕 */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          確認匹配結果
        </button>
      </div>
    </div>
  );
}
