'use client';

/**
 * 達文西模式頂部標題列（/davinci 路徑下取代 QIP Header，版型鏡射）
 * - 標題：達文西手術品質儀表板 + 即時時鐘 + 院區副標
 * - 右側：匯出 xlsx / 匯入資料（開達文西匯入對話框）/ 登出
 * 搜尋框省略（七項指標不需搜尋）。
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, LogOut, Upload } from 'lucide-react';
import { logout } from '@/lib/entry/api';
import { davinciExportUrl } from '../lib/api';
import { useDavinciStore } from '../lib/store';
import { ImportDialog } from './ImportDialog';

/** 即時時鐘 + 心跳（鏡射 QIP Header，不改其原始檔） */
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

export function DavinciHeader() {
  const campus = useDavinciStore(s => s.campus);
  const importOpen = useDavinciStore(s => s.importOpen);
  const setImportOpen = useDavinciStore(s => s.setImportOpen);
  const bumpDataVersion = useDavinciStore(s => s.bumpDataVersion);
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
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-800">
            達文西手術品質儀表板
          </h2>
          <HeartbeatClock />
        </div>
        <p className="text-sm text-gray-500">
          {campus}院區 — 醫院評鑑 達文西指標監測
        </p>
      </div>

      {/* 匯出 xlsx（依當前院區） */}
      <a
        href={davinciExportUrl(campus)}
        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
      >
        <Download size={16} />
        匯出 xlsx（{campus}）
      </a>

      {/* 匯入按鈕 */}
      <button
        onClick={() => setImportOpen(true)}
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

      {/* 匯入對話框由 Header 統一持有（總覽/詳情頁皆可匯入），
          完成後 bump dataVersion → 各頁面 reload */}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={bumpDataVersion}
      />
    </header>
  );
}
