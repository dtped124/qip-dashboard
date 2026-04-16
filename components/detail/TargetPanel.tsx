'use client';

import { useEffect, useState } from 'react';
import { Target, Check, X } from 'lucide-react';
import { loadIndicatorMeta, updateIndicatorTarget } from '@/lib/api';
import type { IndicatorUnit } from '@/lib/types';

interface Props {
  code: string;
  unit: IndicatorUnit;
  /** 變更後通知父層重新載入分析 */
  onChange?: () => void;
}

const UNIT_SUFFIX: Record<IndicatorUnit, string> = {
  percent: '%',
  permille: '‰',
  count: '件',
  ratio: '',
};

export function TargetPanel({ code, unit, onChange }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [value, setValue] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadIndicatorMeta(code)
      .then(meta => {
        if (cancelled) return;
        setEnabled(meta.targetMode);
        setValue(meta.targetValue !== null ? String(meta.targetValue) : '');
      })
      .catch(err => {
        if (!cancelled) setError(err.message ?? '載入失敗');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  async function commit(nextEnabled: boolean, nextValueStr: string) {
    setError('');
    let parsed: number | null = null;
    if (nextValueStr.trim() !== '') {
      const num = Number(nextValueStr);
      if (Number.isNaN(num)) {
        setError('請輸入有效數字');
        return;
      }
      if (unit === 'percent' && (num < 0 || num > 100)) {
        setError('百分比必須介於 0-100');
        return;
      }
      if (num < 0) {
        setError('目標值不可為負');
        return;
      }
      parsed = num;
    }
    if (nextEnabled && parsed === null) {
      setError('啟用時須輸入目標值');
      return;
    }

    setSaving(true);
    try {
      const res = await updateIndicatorTarget(code, {
        targetMode: nextEnabled,
        targetValue: parsed,
      });
      setEnabled(res.targetMode);
      setValue(res.targetValue !== null ? String(res.targetValue) : '');
      setEditing(false);
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
        <div className="text-xs text-gray-400">載入挑戰目標設定中…</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Target size={16} className={enabled ? 'text-purple-600' : 'text-gray-400'} />
          <h3 className="text-sm font-bold text-gray-800">挑戰平均值模式</h3>
          <span className="text-xs text-gray-400">
            （以指定目標值取代統計平均，UCL/LCL 重新計算）
          </span>
        </div>

        <div className="flex items-center gap-3">
          {enabled && !editing && (
            <span className="text-sm font-medium text-purple-700 bg-purple-50 px-3 py-1 rounded">
              目標 CL = {value}{UNIT_SUFFIX[unit]}
            </span>
          )}

          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="例如 3.5"
                className="w-28 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                autoFocus
              />
              <span className="text-sm text-gray-500">{UNIT_SUFFIX[unit]}</span>
              <button
                onClick={() => commit(true, value)}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
              >
                <Check size={14} /> 套用
              </button>
              <button
                onClick={() => { setEditing(false); setError(''); }}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1 text-gray-600 hover:bg-gray-100 rounded text-sm"
              >
                <X size={14} /> 取消
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded font-medium"
              >
                {enabled ? '編輯目標' : '設定目標'}
              </button>
              {enabled && (
                <button
                  onClick={() => commit(false, '')}
                  disabled={saving}
                  className="px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 rounded"
                >
                  停用
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2 text-xs text-red-600">{error}</div>
      )}
    </div>
  );
}
