'use client';

import { IndicatorData } from '@/lib/types';
import { formatValue, CATEGORY_COLORS } from '@/lib/constants';
import { StatusBadge } from './StatusBadge';
import { TrendArrow } from './TrendArrow';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface Props {
  indicators: IndicatorData[];
}

type SortKey = 'code' | 'name' | 'status' | 'value' | 'trend' | 'category';

const statusOrder: Record<string, number> = { alert: 0, warning: 1, watch: 2, neutral: 3, good: 4, excellent: 5 };

export function TableView({ indicators }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = [...indicators].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'code':
        cmp = a.meta.code.localeCompare(b.meta.code);
        break;
      case 'name':
        cmp = a.meta.name.localeCompare(b.meta.name);
        break;
      case 'status':
        cmp = statusOrder[a.status] - statusOrder[b.status];
        break;
      case 'value':
        cmp = (a.latestValue ?? -Infinity) - (b.latestValue ?? -Infinity);
        break;
      case 'category':
        cmp = a.meta.category.localeCompare(b.meta.category);
        break;
      default:
        cmp = 0;
    }
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <button
      onClick={() => handleSort(k)}
      className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
    >
      {label}
      {sortKey === k && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
    </button>
  );

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-4 py-3"><SortHeader label="狀態" k="status" /></th>
            <th className="text-left px-4 py-3"><SortHeader label="代碼" k="code" /></th>
            <th className="text-left px-4 py-3"><SortHeader label="指標名稱" k="name" /></th>
            <th className="text-left px-4 py-3"><SortHeader label="面向" k="category" /></th>
            <th className="text-right px-4 py-3"><SortHeader label="最新值" k="value" /></th>
            <th className="text-right px-4 py-3 whitespace-nowrap">標竿</th>
            <th className="text-center px-4 py-3">趨勢</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(ind => (
            <tr key={ind.meta.code} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-4 py-3">
                <StatusBadge status={ind.status} size="sm" />
              </td>
              <td className="px-4 py-3">
                <Link href={`/indicators/${ind.meta.code}`} className="font-mono text-sm text-blue-600 hover:underline">
                  {ind.meta.code}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm text-gray-800 max-w-xs truncate">
                {ind.meta.name}
              </td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[ind.meta.category] }} />
                  {ind.meta.category}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-sm font-medium">
                {formatValue(ind.latestValue, ind.meta.unit)}
              </td>
              <td className="px-4 py-3 text-right text-sm text-gray-500">
                {formatValue(ind.peerValue ?? ind.benchmarkValue, ind.meta.unit)}
              </td>
              <td className="px-4 py-3 text-center">
                <TrendArrow trend={ind.trend} isReverse={ind.meta.isReverse} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
