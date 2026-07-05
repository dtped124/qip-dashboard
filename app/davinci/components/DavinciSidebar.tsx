'use client';

/**
 * 達文西模式側欄（/davinci 路徑下取代 QIP Sidebar，版型鏡射）
 * - 標題：達文西儀表板（點擊回 /davinci 總覽）
 * - 院區選擇：直接控制達文西 store（竹東反白停用）
 * - 中段：七項指標清單（點擊進指標詳情頁）
 * - 底部：切回 QIP 儀表板
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronLeft, ChevronRight, LayoutDashboard } from 'lucide-react';
import { fetchDavinciMeta } from '../lib/api';
import { useDavinciStore } from '../lib/store';
import { CAMPUS_OPTIONS } from '../lib/ui';
import type { DavinciCampus, DavinciIndicatorMeta } from '../lib/types';

export function DavinciSidebar() {
  const campus = useDavinciStore(s => s.campus);
  const setCampus = useDavinciStore(s => s.setCampus);
  const [collapsed, setCollapsed] = useState(false);
  const [indicators, setIndicators] = useState<DavinciIndicatorMeta[]>([]);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetchDavinciMeta()
      .then(m => setIndicators(m.indicators))
      .catch(() => setIndicators([]));
  }, []);

  return (
    <aside
      className={`bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo（達文西模式標題） */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        {!collapsed && (
          <button
            onClick={() => router.push('/davinci')}
            className="text-lg font-bold text-gray-800 hover:text-blue-600"
          >
            達文西儀表板
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-gray-100"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* 院區切換（竹東無達文西 → 反白） */}
      <div className={`p-3 border-b border-gray-200 ${collapsed ? 'px-2' : ''}`}>
        {!collapsed && (
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <Building2 size={14} />
            院區選擇
          </div>
        )}
        <div className={`flex ${collapsed ? 'flex-col' : ''} gap-1`}>
          {CAMPUS_OPTIONS.map(c => (
            <button
              key={c.name}
              disabled={!c.enabled}
              onClick={() => c.enabled && setCampus(c.name as DavinciCampus)}
              title={c.enabled ? undefined : '達文西無竹東院區'}
              className={`flex-1 py-1.5 px-2 rounded text-sm font-medium transition-colors ${
                !c.enabled
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : campus === c.name
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {collapsed ? c.name[0] : c.name}
            </button>
          ))}
        </div>
      </div>

      {/* 指標導航 */}
      <nav className="flex-1 overflow-y-auto py-2">
        <button
          onClick={() => { if (pathname !== '/davinci') router.push('/davinci'); }}
          className={`w-full text-left px-4 py-2 text-sm transition-colors ${
            pathname === '/davinci'
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {collapsed ? '全' : '全部指標'}
        </button>
        {indicators.map(ind => {
          const href = `/davinci/${ind.code}`;
          const isActive = pathname.toUpperCase() === href.toUpperCase();
          return (
            <button
              key={ind.code}
              onClick={() => router.push(href)}
              title={ind.name}
              className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="text-[10px] text-gray-400 shrink-0 w-9">{ind.code}</span>
              {!collapsed && <span className="flex-1 truncate">{ind.name}</span>}
            </button>
          );
        })}
      </nav>

      {/* 底部：切回 QIP */}
      <div className="border-t border-gray-200 py-2">
        <Link
          href="/"
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <LayoutDashboard size={16} className="shrink-0" />
          {!collapsed && 'QIP 儀表板'}
        </Link>
      </div>
    </aside>
  );
}
