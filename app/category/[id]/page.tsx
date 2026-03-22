'use client';

import { useDashboardStore } from '@/lib/store/dashboardStore';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CATEGORY_ORDER, CATEGORY_COLORS } from '@/lib/constants';
import { OverviewStats } from '@/components/dashboard/OverviewStats';
import { IndicatorCard } from '@/components/dashboard/IndicatorCard';
import { StatusMatrix } from '@/components/dashboard/StatusMatrix';
import type { Category } from '@/lib/types';

export default function CategoryPage() {
  const params = useParams();
  const store = useDashboardStore();
  const categoryId = decodeURIComponent(params.id as string);

  // 驗證類別名稱
  const category = CATEGORY_ORDER.find(c => c === categoryId) as Category | undefined;
  const color = category ? CATEGORY_COLORS[category] : '#6B7280';

  // 篩選該類別 + 該院區的指標
  const indicators = store.indicators.filter(
    i => i.campus === store.campus && i.meta.category === categoryId
  );

  if (!category) {
    return (
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2 text-sm text-blue-600 hover:underline mb-4">
          <ArrowLeft size={16} /> 返回儀表板
        </Link>
        <div className="text-center py-12 text-gray-400">找不到該類別</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* 標題 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/"
          className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft size={20} />
        </Link>
        <div
          className="w-3 h-8 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{category}</h1>
          <p className="text-sm text-gray-500">{store.campus}院區 — {indicators.length} 項指標</p>
        </div>
      </div>

      {indicators.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          此類別在 {store.campus} 院區無指標資料
        </div>
      ) : (
        <>
          {/* 該類別的統計摘要 */}
          <OverviewStats indicators={indicators} />

          {/* 狀態矩陣 */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">狀態矩陣</h2>
            <StatusMatrix indicators={indicators} year={store.selectedYear} />
          </div>

          {/* 指標卡片 */}
          <h2 className="text-lg font-semibold text-gray-700 mb-3">個別指標</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {indicators.map(ind => (
              <IndicatorCard key={`${ind.meta.code}_${ind.campus}`} indicator={ind} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
