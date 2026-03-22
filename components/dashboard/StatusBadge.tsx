'use client';

import { IndicatorStatus } from '@/lib/types';
import { STATUS_CONFIG } from '@/lib/constants';
import { AlertCircle } from 'lucide-react';

interface Props {
  status: IndicatorStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: Props) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      } ${config.bgLight} ${config.textColor}`}
    >
      {status === 'alert' ? (
        <AlertCircle size={size === 'sm' ? 12 : 14} className="shrink-0" />
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 ${config.color}`} />
      )}
      {config.text}
    </span>
  );
}
