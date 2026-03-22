'use client';

import { useMemo } from 'react';
import { useDashboardStore } from './dashboardStore';
import type { IndicatorData } from '../types';

const ALERT_STATUSES = new Set(['alert', 'warning', 'watch']);

export function useFilteredIndicators(): IndicatorData[] {
  const campus = useDashboardStore(s => s.campus);
  const selectedCategory = useDashboardStore(s => s.selectedCategory);
  const searchQuery = useDashboardStore(s => s.searchQuery);
  const statusFilter = useDashboardStore(s => s.statusFilter);
  const indicators = useDashboardStore(s => s.indicators);

  return useMemo(() => {
    let filtered = indicators.filter(ind => ind.campus === campus);

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(ind => ind.meta.category === selectedCategory);
    }

    if (statusFilter === 'alert') {
      filtered = filtered.filter(ind => ALERT_STATUSES.has(ind.status));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(ind =>
        ind.meta.code.toLowerCase().includes(q) ||
        ind.meta.name.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [indicators, campus, selectedCategory, searchQuery, statusFilter]);
}
