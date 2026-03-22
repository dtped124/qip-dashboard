'use client';

import { useDashboardStore } from '@/lib/store/dashboardStore';
import { LayoutGrid, Table, Grid3x3 } from 'lucide-react';
import type { ViewMode } from '@/lib/types';

const views: { mode: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { mode: 'card', label: '卡片', icon: LayoutGrid },
  { mode: 'table', label: '表格', icon: Table },
  { mode: 'heatmap', label: '矩陣', icon: Grid3x3 },
];

export function ViewToggle() {
  const viewMode = useDashboardStore(s => s.viewMode);
  const setViewMode = useDashboardStore(s => s.setViewMode);

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
      {views.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            viewMode === mode
              ? 'bg-white shadow-sm text-gray-800 font-medium'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
