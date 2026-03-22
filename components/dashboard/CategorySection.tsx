'use client';

import { Category, IndicatorData } from '@/lib/types';
import { CATEGORY_COLORS } from '@/lib/constants';
import { IndicatorCard } from './IndicatorCard';

interface Props {
  category: Category;
  indicators: IndicatorData[];
}

export function CategorySection({ category, indicators }: Props) {
  if (indicators.length === 0) return null;

  const color = CATEGORY_COLORS[category];

  return (
    <section className="mb-8" id={`category-${category}`}>
      <div className="flex items-center gap-3 mb-4">
        <span
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h2 className="text-lg font-bold text-gray-800">{category}</h2>
        <span className="text-sm text-gray-400">{indicators.length} 項指標</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {indicators.map(ind => (
          <IndicatorCard key={ind.meta.code} indicator={ind} />
        ))}
      </div>
    </section>
  );
}
