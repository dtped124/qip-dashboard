'use client';

/**
 * 達文西總覽統計 — 版型 1:1 鏡射 QIP 的 components/dashboard/OverviewStats：
 * 四張圖示卡（色底 icon chip + 大字數值 + 小字標籤），警示/注意可點擊篩選。
 */

import { Activity, AlertTriangle, Eye, Users } from 'lucide-react';
import type { DavinciIndicatorRow } from '../lib/types';

interface Props {
  rows: DavinciIndicatorRow[];      // 當期各指標列
  collectedPeriods: number;         // 已收集期數
  periodUnit: string;               // '月' / '季'
  statusFilter: 'all' | 'unfavorable';
  setStatusFilter: (f: 'all' | 'unfavorable') => void;
}

export function DavinciOverviewStats({
  rows, collectedPeriods, periodUnit, statusFilter, setStatusFilter,
}: Props) {
  const total = rows.length;
  const nCases = rows[0]?.n_cases ?? 0;
  const alertCount = rows.filter(r => r.rating === 'alert').length;
  const problemCount = rows.filter(r => r.rating !== 'neutral').length;

  const stats = [
    {
      key: 'total',
      label: '監測指標數',
      value: total,
      icon: Activity,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      clickable: false,
    },
    {
      key: 'cases',
      label: `本${periodUnit}手術人次`,
      value: nCases,
      icon: Users,
      color: 'text-green-600',
      bg: 'bg-green-50',
      clickable: false,
    },
    {
      key: 'alert',
      label: '警示/注意',
      value: problemCount,
      icon: AlertTriangle,
      color: alertCount > 0 ? 'text-red-600' : 'text-yellow-600',
      bg: alertCount > 0 ? 'bg-red-50' : 'bg-yellow-50',
      clickable: problemCount > 0,
    },
    {
      key: 'collected',
      label: `已收集${periodUnit}數`,
      value: collectedPeriods,
      icon: Eye,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      clickable: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map(stat => {
        const isActive = stat.key === 'alert' && statusFilter === 'unfavorable';
        return (
          <div
            key={stat.label}
            onClick={() => {
              if (stat.key === 'alert' && stat.clickable) {
                setStatusFilter(statusFilter === 'unfavorable' ? 'all' : 'unfavorable');
              }
            }}
            className={`bg-white rounded-lg shadow-sm border p-4 transition-all ${
              stat.clickable ? 'cursor-pointer hover:shadow-md' : ''
            } ${isActive ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-100'}`}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon size={20} className={stat.color} />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-xs text-gray-500">
                  {stat.label}
                  {isActive && <span className="ml-1 text-red-500">(篩選中)</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
