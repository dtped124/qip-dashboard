'use client';

/**
 * 達文西 SPC 趨勢圖（I-MR 基線 + WER 著色 + P Chart 變動限疊加）
 * - CL 實線、±2σ 淡虛線、±3σ 虛線
 * - 點色 = 該期評級（紅警示/橘注意/黃留意/藍正常）
 * - 比率型且該期人次 ≥ 門檻時，疊加 P chart 變動 UCL/LCL（階梯線）
 * - 資料不足（< 6 點）只畫值線並示警，不畫管制界限
 */

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DavinciRating, DavinciSeries } from '../lib/types';
import { RATING_DOT_COLORS } from './RatingBadge';
import { unitLabel as fmtUnit } from '../lib/ui';

export function SpcChart({ series }: { series: DavinciSeries }) {
  const { spc, points, kind, unit } = series;
  const unitLabel = fmtUnit(unit);

  const pLimitByPeriod = new Map(spc.p_limits.map(pl => [String(pl.period), pl]));
  const data = points.map(p => ({
    label: p.label,
    value: p.value,
    rating: p.rating,
    numerator: p.numerator,
    denominator: p.denominator,
    pUcl: pLimitByPeriod.get(String(p.period))?.ucl ?? null,
    pLcl: pLimitByPeriod.get(String(p.period))?.lcl ?? null,
  }));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">
          SPC 趨勢圖（{kind === 'rate' ? 'I-MR，P Chart 補充' : 'I-MR'}）
        </h3>
        {spc.has_chart ? (
          <span className="text-xs text-gray-400">
            CL={spc.cl} · UCL={spc.ucl} · LCL={spc.lcl}
            {spc.baseline_warning && `（基線 ${spc.baseline_n} 點 < 24，僅供參考）`}
          </span>
        ) : (
          <span className="text-xs text-amber-600">
            資料不足（{spc.baseline_n} 點 &lt; 6）：不畫管制界限，僅呈現趨勢
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#F3F4F6" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={48} domain={['auto', 'auto']}
                 label={{ value: unitLabel, angle: -90, position: 'insideLeft', fontSize: 10 }} />
          <Tooltip
            formatter={(v: number | undefined, name: string | undefined) => {
              if (v == null) return ['—', name ?? ''];
              if (name === 'value') return [`${v} ${unitLabel}`, '值'];
              if (name === 'pUcl') return [`${v}%`, 'P-UCL（變動）'];
              if (name === 'pLcl') return [`${v}%`, 'P-LCL（變動）'];
              return [v, name ?? ''];
            }}
            labelFormatter={(label, payload) => {
              const p = (payload as { payload?: { numerator: number | null; denominator: number | null } }[] | undefined)?.[0]?.payload;
              return p && p.numerator !== null
                ? `${String(label)}（${p.numerator}/${p.denominator}）`
                : String(label ?? '');
            }}
          />
          {spc.has_chart && spc.cl !== null && (
            <>
              <ReferenceLine y={spc.cl} stroke="#6B7280" strokeWidth={1.5}
                             label={{ value: 'CL', fontSize: 10, position: 'right' }} />
              <ReferenceLine y={spc.ucl!} stroke="#DC2626" strokeDasharray="6 4"
                             label={{ value: 'UCL', fontSize: 10, position: 'right' }} />
              {spc.lcl! > 0 && (
                <ReferenceLine y={spc.lcl!} stroke="#DC2626" strokeDasharray="6 4"
                               label={{ value: 'LCL', fontSize: 10, position: 'right' }} />
              )}
              <ReferenceLine y={spc.ucl2!} stroke="#F59E0B" strokeDasharray="3 5" strokeOpacity={0.6} />
              {spc.lcl2! > 0 && (
                <ReferenceLine y={spc.lcl2!} stroke="#F59E0B" strokeDasharray="3 5" strokeOpacity={0.6} />
              )}
            </>
          )}
          {/* P chart 變動限（僅人次達門檻的期別有值） */}
          <Line dataKey="pUcl" stroke="#7C3AED" strokeDasharray="4 3" strokeWidth={1}
                dot={false} connectNulls={false} type="stepAfter" />
          <Line dataKey="pLcl" stroke="#7C3AED" strokeDasharray="4 3" strokeWidth={1}
                dot={false} connectNulls={false} type="stepAfter" />
          <Line
            dataKey="value"
            stroke="#2563EB"
            strokeWidth={2}
            connectNulls
            dot={(props: { cx?: number; cy?: number; payload?: { rating?: DavinciRating } }) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null) return <g key={`${cx}-${cy}`} />;
              const color = RATING_DOT_COLORS[payload?.rating ?? 'neutral'];
              return (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={4}
                        fill={color} stroke="#fff" strokeWidth={1.5} />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {spc.p_limits.length > 0 && (
        <p className="text-[10px] text-gray-400 mt-1">
          紫色階梯虛線 = P Chart 變動管制限（僅當期人次 ≥ 門檻時呈現；p̄={spc.p_cl}%）
        </p>
      )}
    </div>
  );
}
