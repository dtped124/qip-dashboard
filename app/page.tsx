'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { useFilteredIndicators } from '@/lib/store/selectors';
import { CATEGORY_ORDER } from '@/lib/constants';
import { OverviewStats } from '@/components/dashboard/OverviewStats';
import { CategorySection } from '@/components/dashboard/CategorySection';
import { TableView } from '@/components/dashboard/TableView';
import { ViewToggle } from '@/components/dashboard/ViewToggle';
import { PeriodToggle } from '@/components/dashboard/PeriodToggle';
import { AlertBanner } from '@/components/layout/AlertBanner';
import { IndicatorCard } from '@/components/dashboard/IndicatorCard';
import { StatusMatrix } from '@/components/dashboard/StatusMatrix';
import { FileSpreadsheet, Database, Loader2 } from 'lucide-react';
import { loadDashboardFromAPI, uploadExcel } from '@/lib/api';

export default function HomePage() {
  const store = useDashboardStore();
  const indicators = useFilteredIndicators();
  const [loadingSample, setLoadingSample] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // 從 Django API 載入資料（啟動時 + 切換院區時）
  useEffect(() => {
    let cancelled = false;
    setInitializing(true);
    loadDashboardFromAPI(store.campus)
      .then(loaded => {
        if (!cancelled && loaded.length > 0) {
          store.setIndicators(loaded);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.error('Failed to load from API:', err);
          store.setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.campus]);

  const loadSampleData = useCallback(async () => {
    setLoadingSample(true);
    try {
      // Upload sample.xls to Django API, then reload dashboard
      const resp = await fetch('/sample.xls');
      const blob = await resp.blob();
      const file = new File([blob], 'sample.xls', { type: blob.type });
      await uploadExcel(file);
      // Reload dashboard from API
      const loaded = await loadDashboardFromAPI(store.campus);
      store.setIndicators(loaded);
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
        <p className="text-xs text-gray-400 mt-2">連線 Django API ({process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'})</p>
      </div>
    );
  }

  // API 錯誤
  if (store.error && store.indicators.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="text-red-500 text-4xl mb-4">⚠</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">無法連線後端</h2>
        <p className="text-sm text-red-500 mb-4 max-w-md">{store.error}</p>
        <p className="text-xs text-gray-400 mb-4">請確認 Docker 容器正在運行：docker-compose up -d</p>
        <button
          onClick={() => { store.setError(null); setInitializing(true); loadDashboardFromAPI(store.campus).then(d => { store.setIndicators(d); }).catch(e => store.setError(String(e))).finally(() => setInitializing(false)); }}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
        >
          重試連線
        </button>
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
        <div className="flex items-center gap-3">
          {store.viewMode === 'heatmap' && <PeriodToggle />}
          <ViewToggle />
        </div>
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
