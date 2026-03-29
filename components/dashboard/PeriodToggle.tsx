'use client';

import { useDashboardStore, type PeriodMode } from '@/lib/store/dashboardStore';
import { Calendar, CalendarDays } from 'lucide-react';

const modes: { mode: PeriodMode; label: string; icon: typeof Calendar }[] = [
  { mode: 'monthly', label: '月', icon: Calendar },
  { mode: 'quarterly', label: '季', icon: CalendarDays },
];

export function PeriodToggle() {
  const periodMode = useDashboardStore(s => s.periodMode);
  const setPeriodMode = useDashboardStore(s => s.setPeriodMode);

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
      {modes.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          onClick={() => setPeriodMode(mode)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-sm transition-colors ${
            periodMode === mode
              ? 'bg-white shadow-sm text-gray-800 font-medium'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
}
