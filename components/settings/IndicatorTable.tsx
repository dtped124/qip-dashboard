'use client';

import { useState } from 'react';
import { Edit2, Trash2, Search, ChevronDown, ChevronUp } from 'lucide-react';
import type { IndicatorMeta, Category } from '@/lib/types';
import { CATEGORY_COLORS, CATEGORY_ORDER } from '@/lib/constants';

interface Props {
  indicators: IndicatorMeta[];
  onEdit: (indicator: IndicatorMeta) => void;
  onDelete: (code: string) => void;
}

const DIRECTION_LABELS: Record<string, string> = {
  lower: '越低越好',
  higher: '越高越好',
  monitor: '監測',
};

const UNIT_LABELS: Record<string, string> = {
  percent: '%',
  permille: '‰',
  count: '計數',
  ratio: '比率',
};

export function IndicatorTable({ indicators, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<Category | 'all'>('all');
  const [filterSource, setFilterSource] = useState<'all' | 'preset' | 'custom'>('all');
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const filtered = indicators.filter(ind => {
    if (filterCategory !== 'all' && ind.category !== filterCategory) return false;
    if (filterSource !== 'all' && ind.source !== filterSource) return false;
    if (search) {
      const q = search.toLowerCase();
      return ind.code.toLowerCase().includes(q) || ind.name.toLowerCase().includes(q);
    }
    return true;
  });

  // 按類別分組
  const grouped = new Map<string, IndicatorMeta[]>();
  for (const cat of CATEGORY_ORDER) {
    const items = filtered.filter(ind => ind.category === cat);
    if (items.length > 0) {
      grouped.set(cat, items);
    }
  }

  return (
    <div>
      {/* 篩選列 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋代碼或名稱..."
            className="pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm w-full focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value as Category | 'all')}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">全部類別</option>
          {CATEGORY_ORDER.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value as 'all' | 'preset' | 'custom')}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">全部來源</option>
          <option value="preset">預設</option>
          <option value="custom">自訂</option>
        </select>
        <div className="text-sm text-gray-400">
          共 {filtered.length} 筆
        </div>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-24">代碼</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">名稱</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-20">單位</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-24">方向</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-20">院區</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-16">來源</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(grouped.entries()).map(([category, items]) => (
              <>
                <tr key={`cat-${category}`}>
                  <td
                    colSpan={7}
                    className="px-4 py-1.5 bg-gray-50 text-xs font-semibold border-b border-gray-100"
                    style={{ color: CATEGORY_COLORS[category as Category] }}
                  >
                    {category} ({items.length})
                  </td>
                </tr>
                {items.map(ind => (
                  <tr
                    key={ind.code}
                    className="border-b border-gray-50 hover:bg-gray-50/50 group"
                  >
                    <td className="px-4 py-2 text-xs font-mono text-gray-500">{ind.code}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setExpandedCode(expandedCode === ind.code ? null : ind.code)}
                        className="flex items-center gap-1 text-sm text-gray-700 hover:text-blue-600 text-left"
                      >
                        <span className="truncate max-w-[300px]">{ind.name}</span>
                        {(ind.aliases.length > 0 || ind.description) && (
                          expandedCode === ind.code
                            ? <ChevronUp size={12} className="shrink-0 text-gray-400" />
                            : <ChevronDown size={12} className="shrink-0 text-gray-400" />
                        )}
                      </button>
                      {expandedCode === ind.code && (
                        <div className="mt-1 space-y-1 text-xs text-gray-500">
                          {ind.aliases.length > 0 && (
                            <div>別名: {ind.aliases.join(', ')}</div>
                          )}
                          {ind.description && <div>{ind.description}</div>}
                          {ind.formula && <div>公式: {ind.formula}</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{UNIT_LABELS[ind.unit]}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{DIRECTION_LABELS[ind.direction]}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{ind.campuses.join('/')}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        ind.source === 'preset'
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-purple-50 text-purple-600'
                      }`}>
                        {ind.source === 'preset' ? '預設' : '自訂'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onEdit(ind)}
                          className="p-1 hover:bg-blue-50 rounded text-gray-400 hover:text-blue-600"
                          title="編輯"
                        >
                          <Edit2 size={14} />
                        </button>
                        {ind.source === 'custom' && (
                          <button
                            onClick={() => onDelete(ind.code)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title="刪除"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-sm text-gray-400">
            找不到符合條件的指標
          </div>
        )}
      </div>
    </div>
  );
}
