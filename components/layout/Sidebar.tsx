'use client';

import { useDashboardStore } from '@/lib/store/dashboardStore';
import { CATEGORY_ORDER, CATEGORY_COLORS } from '@/lib/constants';
import { Campus } from '@/lib/types';
import { Building2, ChevronLeft, ChevronRight, Upload, Settings, BarChart3, CalendarRange, Bot } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export function Sidebar() {
  const campus = useDashboardStore(s => s.campus);
  const setCampus = useDashboardStore(s => s.setCampus);
  const indicators = useDashboardStore(s => s.indicators);
  const selectedCategory = useDashboardStore(s => s.selectedCategory);
  const setSelectedCategory = useDashboardStore(s => s.setSelectedCategory);
  const setStatusFilter = useDashboardStore(s => s.setStatusFilter);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const campusOptions: Campus[] = ['竹北', '竹東', '新竹'];

  const indicatorsByCampus = indicators.filter(i => i.campus === campus);
  const categoriesWithData = CATEGORY_ORDER.filter(cat =>
    indicatorsByCampus.some(i => i.meta.category === cat)
  );

  return (
    <aside
      className={`bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        {!collapsed && (
          <button
            onClick={() => { setSelectedCategory('all'); setStatusFilter('all'); router.push('/'); }}
            className="text-lg font-bold text-gray-800 hover:text-blue-600"
          >
            QIP 儀表板
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-gray-100"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* 儀表板切換（QIP / 達文西 並列；點達文西 → 整個外框切為達文西模式） */}
      <div className={`p-3 border-b border-gray-200 ${collapsed ? 'px-2' : ''}`}>
        {!collapsed && (
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <Bot size={14} />
            儀表板
          </div>
        )}
        <div className={`flex ${collapsed ? 'flex-col' : ''} gap-1`}>
          <button
            className="flex-1 py-1.5 px-2 rounded text-sm font-medium bg-blue-600 text-white"
          >
            {collapsed ? 'Q' : 'QIP'}
          </button>
          <Link
            href="/davinci"
            className="flex-1 py-1.5 px-2 rounded text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 text-center transition-colors"
          >
            {collapsed ? '達' : '達文西'}
          </Link>
        </div>
      </div>

      {/* 院區切換 */}
      <div className={`p-3 border-b border-gray-200 ${collapsed ? 'px-2' : ''}`}>
        {!collapsed && (
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <Building2 size={14} />
            院區選擇
          </div>
        )}
        <div className={`flex ${collapsed ? 'flex-col' : ''} gap-1`}>
          {campusOptions.map(c => (
            <button
              key={c}
              onClick={() => setCampus(c)}
              className={`flex-1 py-1.5 px-2 rounded text-sm font-medium transition-colors ${
                campus === c
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {collapsed ? c[0] : c}
            </button>
          ))}
        </div>
      </div>

      {/* 面向導航 */}
      <nav className="flex-1 overflow-y-auto py-2">
        <button
          onClick={() => { setSelectedCategory('all'); setStatusFilter('all'); if (pathname !== '/') router.push('/'); }}
          className={`w-full text-left px-4 py-2 text-sm transition-colors ${
            selectedCategory === 'all' && pathname === '/'
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {collapsed ? '全' : '全部指標'}
        </button>
        {categoriesWithData.map(cat => {
          const count = indicatorsByCampus.filter(i => i.meta.category === cat).length;
          const color = CATEGORY_COLORS[cat];
          const isActive = selectedCategory === cat && pathname === '/';
          return (
            <button
              key={cat}
              onClick={() => { setSelectedCategory(cat); setStatusFilter('all'); if (pathname !== '/') router.push('/'); }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{cat}</span>
                  <span className="text-xs text-gray-400">{count}</span>
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* 底部功能連結 */}
      <div className="border-t border-gray-200 py-2">
        <Link
          href="/cross-campus"
          className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            pathname === '/cross-campus'
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <CalendarRange size={16} className="shrink-0" />
          {!collapsed && '季度分析'}
        </Link>
        <Link
          href="/import"
          className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            pathname === '/import'
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Upload size={16} className="shrink-0" />
          {!collapsed && '匯入紀錄'}
        </Link>
        <Link
          href="/settings/tcpi"
          className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            pathname === '/settings/tcpi'
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <BarChart3 size={16} className="shrink-0" />
          {!collapsed && '標竿管理'}
        </Link>
        <Link
          href="/settings"
          className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            pathname.startsWith('/settings') && pathname !== '/settings/tcpi'
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Settings size={16} className="shrink-0" />
          {!collapsed && '設定'}
        </Link>
      </div>
    </aside>
  );
}
