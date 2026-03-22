'use client';

import { create } from 'zustand';
import type { Campus, Category, IndicatorData, ViewMode } from '../types';

export type StatusFilter = 'all' | 'alert';

interface DashboardStore {
  // UI 狀態
  campus: Campus;
  viewMode: ViewMode;
  searchQuery: string;
  selectedCategory: Category | 'all';
  selectedYear: number;
  statusFilter: StatusFilter;
  loading: boolean;
  error: string | null;

  // 資料
  indicators: IndicatorData[];

  // Actions
  setCampus: (campus: Campus) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: Category | 'all') => void;
  setSelectedYear: (year: number) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setIndicators: (indicators: IndicatorData[]) => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  campus: '竹北',
  viewMode: 'card',
  searchQuery: '',
  selectedCategory: 'all',
  selectedYear: 115,
  statusFilter: 'all',
  loading: false,
  error: null,
  indicators: [],

  setCampus: (campus) => set((state) => {
    // 自動偵測該院區最新有資料的年度
    const campusIndicators = state.indicators.filter(i => i.campus === campus);
    let latestYear = state.selectedYear;
    if (campusIndicators.length > 0) {
      let maxYear = 0;
      for (const ind of campusIndicators) {
        for (const dp of ind.monthlyData) {
          if (dp.value !== null && dp.year > maxYear) {
            maxYear = dp.year;
          }
        }
      }
      if (maxYear > 0) latestYear = maxYear;
    }
    return { campus, selectedYear: latestYear };
  }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (category) => set({ selectedCategory: category }),
  setSelectedYear: (year) => set({ selectedYear: year }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setIndicators: (indicators) => set((state) => {
    // 自動偵測當前院區最新有資料的年度
    const campusIndicators = indicators.filter(i => i.campus === state.campus);
    let latestYear = state.selectedYear;
    if (campusIndicators.length > 0) {
      let maxYear = 0;
      for (const ind of campusIndicators) {
        for (const dp of ind.monthlyData) {
          if (dp.value !== null && dp.year > maxYear) {
            maxYear = dp.year;
          }
        }
      }
      if (maxYear > 0) latestYear = maxYear;
    }
    return { indicators, loading: false, error: null, selectedYear: latestYear };
  }),
}));
