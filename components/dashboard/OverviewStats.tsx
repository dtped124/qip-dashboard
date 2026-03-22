'use client';

import { IndicatorData } from '@/lib/types';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { Activity, CheckCircle2, AlertTriangle, Eye } from 'lucide-react';

interface Props {
  indicators: IndicatorData[];
}

export function OverviewStats({ indicators }: Props) {
  const statusFilter = useDashboardStore(s => s.statusFilter);
  const setStatusFilter = useDashboardStore(s => s.setStatusFilter);

  const total = indicators.length;
  const excellent = indicators.filter(i => i.status === 'excellent').length;
  const good = indicators.filter(i => i.status === 'good').length;
  const watch = indicators.filter(i => i.status === 'watch').length;
  const warning = indicators.filter(i => i.status === 'warning').length;
  const alertCount = indicators.filter(i => i.status === 'alert').length;
  const passRate = total > 0 ? (((excellent + good) / total) * 100).toFixed(1) : '0';
  const collected = indicators.filter(i => i.latestValue !== null).length;
  const problemCount = alertCount + warning + watch;

  const stats = [
    {
      key: 'total',
      label: '總指標數',
      value: total,
      icon: Activity,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      key: 'good',
      label: '良好以上',
      value: excellent + good,
      suffix: `(${passRate}%)`,
      icon: CheckCircle2,
      color: 'text-green-600',
      bg: 'bg-green-50',
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
      label: '已收集',
      value: collected,
      suffix: `/ ${total}`,
      icon: Eye,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map(stat => {
        const isActive = stat.key === 'alert' && statusFilter === 'alert';
        return (
          <div
            key={stat.label}
            onClick={() => {
              if (stat.key === 'alert' && stat.clickable) {
                setStatusFilter(statusFilter === 'alert' ? 'all' : 'alert');
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
                <div className="text-2xl font-bold text-gray-900">
                  {stat.value}
                  {stat.suffix && <span className="text-sm font-normal text-gray-400 ml-1">{stat.suffix}</span>}
                </div>
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
