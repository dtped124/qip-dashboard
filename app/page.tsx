'use client';

import { useState, useEffect } from 'react';
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
import { FileSpreadsheet, Loader2, ShieldAlert } from 'lucide-react';
import { loadDashboardFromAPI } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useAuthStore } from '@/lib/auth/store';
import { isAdmin } from '@/lib/auth/roles';

export default function HomePage() {
  const store = useDashboardStore();
  const indicators = useFilteredIndicators();
  const roles = useAuthStore(s => s.user?.roles);
  const [initializing, setInitializing] = useState(true);
  // 載入失敗的原因（ApiError.code 決定要顯示哪個畫面）；store.error 只是給人看的字串
  const [loadError, setLoadError] = useState<unknown>(null);

  // 從 Django API 載入資料（啟動時 + 切換院區時）
  useEffect(() => {
    let cancelled = false;
    setInitializing(true);
    setLoadError(null);
    loadDashboardFromAPI(store.campus)
      .then(loaded => {
        if (!cancelled && loaded.length > 0) {
          store.setIndicators(loaded);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.error('Failed to load from API:', err);
          setLoadError(err);
          store.setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.campus]);

  // 初始載入中
  if (initializing) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Loader2 size={48} className="text-blue-400 animate-spin mb-4" />
        <p className="text-sm text-gray-500">載入資料中...</p>
      </div>
    );
  }

  // API 錯誤：依後端回的 code 分流，不能一律說「無法連線後端」
  if (store.error && store.indicators.length === 0) {
    const code = loadError instanceof ApiError ? loadError.code : undefined;

    // 未登入／必須先改密碼：AuthGuard 正在把使用者導去登入頁，這裡不用顯示任何東西
    if (code === 'not_authenticated' || code === 'password_change_required') return null;

    // 已登入，但角色不能看儀表板
    if (code === 'permission_denied') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <ShieldAlert size={48} className="text-amber-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-800 mb-2">沒有檢視權限</h2>
          <p className="text-sm text-gray-600 max-w-md">你的帳號沒有儀表板檢視權限，請聯絡品管中心</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="text-red-500 text-4xl mb-4">⚠</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">無法連線後端</h2>
        <p className="text-sm text-red-500 mb-4 max-w-md">{store.error}</p>
        <p className="text-xs text-gray-400 mb-4">請確認 Docker 容器正在運行：docker-compose up -d</p>
        <button
          onClick={() => { store.setError(null); setLoadError(null); setInitializing(true); loadDashboardFromAPI(store.campus).then(d => { store.setIndicators(d); }).catch(e => { setLoadError(e); store.setError(String(e)); }).finally(() => setInitializing(false)); }}
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
        <p className="text-sm text-gray-500 max-w-md">
          {isAdmin(roles)
            ? '請點擊右上角「匯入資料」按鈕，上傳 QIP 持續性監測指標 Excel 檔案（.xls）以開始使用。'
            : '目前還沒有可顯示的資料，請聯絡品管中心。'}
        </p>
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
          <PeriodToggle />
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
