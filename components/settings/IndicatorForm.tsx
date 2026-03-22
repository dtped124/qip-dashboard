'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { IndicatorMeta, Category, Campus, IndicatorUnit, Direction } from '@/lib/types';
import { CATEGORY_ORDER } from '@/lib/constants';

interface Props {
  indicator?: IndicatorMeta;
  onSave: (indicator: IndicatorMeta) => void;
  onCancel: () => void;
}

const UNIT_OPTIONS: { value: IndicatorUnit; label: string }[] = [
  { value: 'percent', label: '百分比 (%)' },
  { value: 'permille', label: '千分比 (‰)' },
  { value: 'count', label: '計數' },
  { value: 'ratio', label: '比率' },
];

const DIRECTION_OPTIONS: { value: Direction; label: string; desc: string }[] = [
  { value: 'lower', label: '越低越好', desc: '如：死亡率、感染率' },
  { value: 'higher', label: '越高越好', desc: '如：完成率、脫離率' },
  { value: 'monitor', label: '監測', desc: '無明確方向性' },
];

const CAMPUS_OPTIONS: Campus[] = ['竹北', '竹東', '新竹'];

export function IndicatorForm({ indicator, onSave, onCancel }: Props) {
  const isEdit = !!indicator;

  const [code, setCode] = useState(indicator?.code ?? '');
  const [name, setName] = useState(indicator?.name ?? '');
  const [category, setCategory] = useState<Category>(indicator?.category ?? '整體照護');
  const [unit, setUnit] = useState<IndicatorUnit>(indicator?.unit ?? 'percent');
  const [direction, setDirection] = useState<Direction>(indicator?.direction ?? 'lower');
  const [isQuarterly, setIsQuarterly] = useState(indicator?.isQuarterly ?? false);
  const [campuses, setCampuses] = useState<Campus[]>(indicator?.campuses ?? ['竹北', '竹東']);
  const [aliases, setAliases] = useState(indicator?.aliases.join(', ') ?? '');
  const [description, setDescription] = useState(indicator?.description ?? '');
  const [formula, setFormula] = useState(indicator?.formula ?? '');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!code.trim()) {
      setError('請輸入指標代碼');
      return;
    }
    if (!name.trim()) {
      setError('請輸入指標名稱');
      return;
    }
    if (campuses.length === 0) {
      setError('請至少選擇一個院區');
      return;
    }

    // 依 unit 推導 dataNature
    const dataNature = unit === 'permille' ? 'poisson_rate' as const
      : (unit === 'percent' ? 'binomial_rate' as const : 'continuous' as const);

    const ind: IndicatorMeta = {
      code: code.trim(),
      name: name.trim(),
      category,
      unit,
      direction,
      isQuarterly,
      campuses,
      source: indicator?.source ?? 'custom',
      aliases: aliases.split(',').map(a => a.trim()).filter(Boolean),
      isActive: true,
      dataNature,
      isReverse: direction === 'higher',
      description: description.trim() || undefined,
      formula: formula.trim() || undefined,
    };

    onSave(ind);
  }

  function toggleCampus(c: Campus) {
    setCampuses(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800">
            {isEdit ? '編輯指標' : '新增自訂指標'}
          </h2>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
          )}

          {/* 指標代碼 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">指標代碼 *</label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={isEdit}
              placeholder="例如: HA01-01 或 CUSTOM-01"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          {/* 指標名稱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">指標名稱 *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="指標完整名稱"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* 類別 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">類別</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as Category)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            >
              {CATEGORY_ORDER.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* 單位 + 方向 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">單位</label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value as IndicatorUnit)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              >
                {UNIT_OPTIONS.map(u => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">方向性</label>
              <select
                value={direction}
                onChange={e => setDirection(e.target.value as Direction)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              >
                {DIRECTION_OPTIONS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 院區 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">適用院區 *</label>
            <div className="flex gap-3">
              {CAMPUS_OPTIONS.map(c => (
                <label key={c} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={campuses.includes(c)}
                    onChange={() => toggleCampus(c)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{c}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 季報 */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isQuarterly}
                onChange={e => setIsQuarterly(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">季報指標（非月報）</span>
            </label>
          </div>

          {/* 別名 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              別名 <span className="font-normal text-gray-400">（以逗號分隔）</span>
            </label>
            <input
              type="text"
              value={aliases}
              onChange={e => setAliases(e.target.value)}
              placeholder="例如: ICU死亡率, 加護死亡"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* 公式 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">計算公式</label>
            <input
              type="text"
              value={formula}
              onChange={e => setFormula(e.target.value)}
              placeholder="分子 / 分母 x 100%"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* 說明 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">說明</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          {/* 按鈕 */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {isEdit ? '儲存變更' : '新增指標'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
