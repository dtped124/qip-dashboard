'use client';

import { TrendDirection } from '@/lib/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
  trend: TrendDirection;
  isReverse?: boolean;
}

export function TrendArrow({ trend, isReverse = false }: Props) {
  if (trend === 'flat') {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
        <Minus size={14} /> 持平
      </span>
    );
  }

  // 判斷趨勢是好是壞
  const isGood = isReverse ? trend === 'up' : trend === 'down';

  if (trend === 'up') {
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${isGood ? 'text-green-600' : 'text-red-600'}`}>
        <TrendingUp size={14} /> 上升
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${isGood ? 'text-green-600' : 'text-red-600'}`}>
      <TrendingDown size={14} /> 下降
    </span>
  );
}
