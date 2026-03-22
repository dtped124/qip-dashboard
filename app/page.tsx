'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { useFilteredIndicators } from '@/lib/store/selectors';
import { CATEGORY_ORDER } from '@/lib/constants';
import { OverviewStats } from '@/components/dashboard/OverviewStats';
import { CategorySection } from '@/components/dashboard/CategorySection';
import { TableView } from '@/components/dashboard/TableView';
import { ViewToggle } from '@/components/dashboard/ViewToggle';
import { AlertBanner } from '@/components/layout/AlertBanner';
import { IndicatorCard } from '@/components/dashboard/IndicatorCard';
import { StatusMatrix } from '@/components/dashboard/StatusMatrix';
import { FileSpreadsheet, Database, Loader2 } from 'lucide-react';
import { parseQIPExcel } from '@/lib/excel-parser';
import { applyStatus } from '@/lib/status-engine';
import { applyTrends } from '@/lib/trend-calculator';
import { loadIndicatorsFromDB } from '@/lib/db/loader';
import * as XLSX from 'xlsx';

export default function HomePage() {
  const store = useDashboardStore();
  const indicators = useFilteredIndicators();
  const [loadingSample, setLoadingSample] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // 啟動時從 IndexedDB 載入資料（頁面重整後還原）
  useEffect(() => {
    if (store.indicators.length > 0) {
      setInitializing(false);
      return;
    }
    loadIndicatorsFromDB()
      .then(loaded => {
        if (loaded.length > 0) {
          store.setIndicators(loaded);
        }
      })
      .catch(err => {
        console.error('Failed to load from IndexedDB:', err);
      })
      .finally(() => {
        setInitializing(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSampleData = useCallback(async () => {
    setLoadingSample(true);
    try {
      const resp = await fetch('/sample.xls');
      const buffer = await resp.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const { indicators: parsed } = parseQIPExcel(workbook);
      let processed = applyStatus(parsed);
      processed = applyTrends(processed);
      store.setIndicators(processed);
    } catch (err) {
      store.setError(String(err));
    } finally {
      setLoadingSample(false);
    }
  }, [store]);

  // 初始載入中
  if (initializing) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Loader2 size={48} className="text-blue-400 animate-spin mb-4" />
        <p className="text-sm text-gray-500">載入資料中...</p>
      </div>
    );
  }

  // 空狀態
  if (store.indicators.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <FileSpreadsheet size={64} className="text-gray-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 mb-2">尚無資料</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md">
          請點擊右上角「匯入資料」按鈕，上傳 QIP 持續性監測指標 Excel 檔案（.xls）以開始使用。
        </p>
        <button
          onClick={loadSampleData}
          disabled={loadingSample}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          <Database size={16} />
          {loadingSample ? '載入中...' : '載入範例資料'}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* 警示橫幅 */}
      <AlertBanner indicators={indicators} />

      {/* 總覽統計 */}
      <OverviewStats indicators={indicators} />

      {/* 檢視模式切換 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-800">
          {store.viewMode === 'heatmap'
            ? '狀態矩陣'
            : store.selectedCategory === 'all'
              ? '全部指標'
              : store.selectedCategory}
          <span className="text-sm font-normal text-gray-400 ml-2">
            {store.viewMode !== 'heatmap' && `${indicators.length} 項`}
          </span>
        </h2>
        <ViewToggle />
      </div>

      {/* 指標列表 / 熱力圖 */}
      {store.viewMode === 'heatmap' ? (
        <StatusMatrix indicators={indicators} year={store.selectedYear} />
      ) : store.viewMode === 'card' ? (
        store.selectedCategory === 'all' ? (
          CATEGORY_ORDER.map(cat => {
            const catIndicators = indicators.filter(i => i.meta.category === cat);
            if (catIndicators.length === 0) return null;
            return (
              <CategorySection key={cat} category={cat} indicators={catIndicators} />
            );
          })
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {indicators.map(ind => (
              <IndicatorCard key={ind.meta.code} indicator={ind} />
            ))}
          </div>
        )
      ) : (
        <TableView indicators={indicators} />
      )}
    </div>
  );
}
