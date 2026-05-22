'use client';

import { useDashboardStore } from '@/lib/store/dashboardStore';
import { Search, Upload, LogOut } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ImportWizard } from '@/components/import/ImportWizard';
import { ExportElementListButton } from '@/components/layout/ExportElementListButton';
import { logout } from '@/lib/entry/api';

/** 即時時鐘 + 心跳脈搏，證明應用仍在運行 */
function HeartbeatClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400 select-none" title="系統運行中">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <span className="font-mono tabular-nums">{hh}:{mm}:{ss}</span>
    </div>
  );
}

export function Header() {
  const campus = useDashboardStore(s => s.campus);
  const searchQuery = useDashboardStore(s => s.searchQuery);
  const setSearchQuery = useDashboardStore(s => s.setSearchQuery);
  const [showImport, setShowImport] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // 即使 API 失敗仍跳轉
    }
    router.replace('/entry/login');
  };

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-800">
              持續性監測指標儀表板
            </h2>
            <HeartbeatClock />
          </div>
          <p className="text-sm text-gray-500">
            {campus}院區 — 醫院評鑑 QIP 指標監測
          </p>
        </div>

        {/* 搜尋 */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="搜尋指標代碼或名稱..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 匯出要素清單（依當前院區） */}
        <ExportElementListButton />

        {/* 匯入按鈕 */}
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Upload size={16} />
          匯入資料
        </button>

        {/* 登出 */}
        <button
          onClick={handleLogout}
          title="登出"
          className="flex items-center gap-1.5 px-3 py-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors"
        >
          <LogOut size={16} />
          登出
        </button>
      </header>

      {showImport && <ImportWizard onClose={() => setShowImport(false)} />}
    </>
  );
}
