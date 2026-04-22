'use client';

import { useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, Legend,
} from 'recharts';
import type { ControlChartParams, AnomalyResult, MonthlyDataPoint, Direction, VariableLimit } from '@/lib/types';
import { formatValue, monthToQuarter } from '@/lib/constants';
import type { IndicatorUnit } from '@/lib/types';
import { CONTROL_CHART_COLORS } from '@/lib/constants';

interface Props {
  dataPoints: MonthlyDataPoint[];
  controlChart: ControlChartParams;
  anomalies: AnomalyResult[];
  direction: Direction;
  unit: IndicatorUnit;
  peerValue: number | null;
  isQuarterly?: boolean;
}

interface ChartDataPoint {
  label: string;
  value: number | null;
  year: number;
  month: number;
  isAnomaly: boolean;
  anomalyInfo?: AnomalyResult;
  // Variable limits (P/U charts)
  varUcl?: number;
  varLcl?: number;
  varUcl2?: number;
  varLcl2?: number;
}

const CHART_TYPE_LABELS: Record<string, string> = {
  'I-MR': 'I-MR Chart',
  'P': 'P Chart',
  'U': 'U Chart',
};

export function ControlChart({ dataPoints, controlChart, anomalies, direction, unit, peerValue, isQuarterly = false }: Props) {
  const { cl, ucl, lcl, ucl2, lcl2, sigma, chartType, variableLimits, targetMode } = controlChart;
  const hasVariableLimits = variableLimits && variableLimits.length > 0;
  const isTargetMode = !!targetMode;

  // 建立變動限查詢表
  const limitsMap = new Map<string, VariableLimit>();
  if (variableLimits) {
    for (const vl of variableLimits) {
      limitsMap.set(`${vl.year}_${vl.month}`, vl);
    }
  }

  // 組裝圖表數據
  const sorted = [...dataPoints]
    .filter(dp => dp.value !== null)
    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

  const chartData: ChartDataPoint[] = sorted.map(dp => {
    const anomaly = anomalies.find(a => a.year === dp.year && a.month === dp.month && a.direction === 'unfavorable');
    const vl = limitsMap.get(`${dp.year}_${dp.month}`);

    return {
      label: isQuarterly ? `${dp.year}.Q${monthToQuarter(dp.month)}` : `${dp.year}.${String(dp.month).padStart(2, '0')}`,
      value: dp.value,
      year: dp.year,
      month: dp.month,
      isAnomaly: !!anomaly,
      anomalyInfo: anomaly,
      // P/U chart：有變動限用變動限，否則 fallback 到平均管制限
      varUcl: hasVariableLimits ? (vl?.ucl ?? ucl) : undefined,
      varLcl: hasVariableLimits ? (vl?.lcl ?? lcl) : undefined,
      varUcl2: hasVariableLimits ? (vl?.ucl2 ?? ucl2) : undefined,
      varLcl2: hasVariableLimits ? (vl?.lcl2 ?? lcl2) : undefined,
    };
  });

  // 預設顯示最後 25 個月（與後端管制限計算視窗一致），可切換顯示全部
  const VISIBLE_WINDOW = 25;
  const totalPoints = chartData.length;
  const canExpand = totalPoints > VISIBLE_WINDOW;
  const [showAll, setShowAll] = useState(false);
  const displayData = (canExpand && !showAll) ? chartData.slice(-VISIBLE_WINDOW) : chartData;

  // Y 軸範圍
  const allValues = sorted.map(dp => dp.value as number);
  const allUcls = hasVariableLimits
    ? variableLimits.map(vl => vl.ucl)
    : [ucl];
  const allLcls = hasVariableLimits
    ? variableLimits.map(vl => vl.lcl)
    : [lcl];

  const minVal = Math.min(...allValues, ...allLcls, peerValue ?? Infinity);
  const maxVal = Math.max(...allValues, ...allUcls, peerValue ?? -Infinity);
  const padding = (maxVal - minVal) * 0.15 || 1;
  const yMin = Math.max(0, minVal - padding);
  const yMax = maxVal + padding;

  // 自訂數據點渲染
  const renderDot = (props: { cx?: number; cy?: number; payload?: ChartDataPoint; index?: number }) => {
    const { cx, cy, payload } = props;
    if (!cx || !cy || !payload) return <></>;

    if (payload.isAnomaly && payload.anomalyInfo) {
      const severity = payload.anomalyInfo.severity;
      const colorMap: Record<string, string> = {
        alert: '#DC2626',
        warning: '#EA580C',
        watch: '#CA8A04',
      };
      const color = colorMap[severity] || '#9CA3AF';
      return (
        <g>
          <circle cx={cx} cy={cy} r={8} fill={color} opacity={0.25} />
          <circle cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
        </g>
      );
    }

    return <circle cx={cx} cy={cy} r={3} fill="#16A34A" stroke="#fff" strokeWidth={1} />;
  };

  // 自訂 Tooltip
  const CustomTooltip = ({ active, payload: tooltipPayload }: { active?: boolean; payload?: Array<{ payload: ChartDataPoint }> }) => {
    if (!active || !tooltipPayload || tooltipPayload.length === 0) return null;
    const data = tooltipPayload[0].payload;

    // 使用此點的限（變動或固定）
    const pointUcl = data.varUcl ?? ucl;
    const pointLcl = data.varLcl ?? lcl;

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
        <div className="font-medium text-gray-800 mb-1">
          民國 {data.year} 年 {isQuarterly ? `Q${monthToQuarter(data.month)}` : `${data.month} 月`}
        </div>
        <div className="space-y-0.5">
          <div>數值：<span className="font-medium">{formatValue(data.value, unit)}</span></div>
          <div className="text-gray-500">CL：{formatValue(cl, unit)}</div>
          <div className="text-gray-500">UCL：{formatValue(pointUcl, unit)}</div>
          <div className="text-gray-500">LCL：{formatValue(pointLcl, unit)}</div>
          {peerValue !== null && (
            <div className="text-blue-600">同儕值：{formatValue(peerValue, unit)}</div>
          )}
        </div>
        {data.isAnomaly && data.anomalyInfo && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="text-red-600 font-medium">{data.anomalyInfo.message}</div>
          </div>
        )}
      </div>
    );
  };

  const directionLabel = direction === 'lower' ? '↓ 越低越好' : direction === 'higher' ? '↑ 越高越好' : '→ 持續監測';
  const chartLabel = CHART_TYPE_LABELS[chartType] || `管制圖 (${chartType})`;

  // 對 I-MR chart，sigma 資訊；對 P/U chart，不顯示 sigma
  const statsLabel = chartType === 'I-MR'
    ? `n = ${controlChart.n} | σ = ${sigma.toFixed(3)}`
    : `n = ${controlChart.n}${hasVariableLimits ? ' | 變動管制限' : ''}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <span>{chartLabel} | {statsLabel}</span>
          {isTargetMode && (
            <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded font-medium">
              挑戰目標模式
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {canExpand && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium"
            >
              {showAll ? `最近 ${VISIBLE_WINDOW} 個月` : `顯示全部 ${totalPoints} 個月`}
            </button>
          )}
          <div className="text-xs text-gray-400">{directionLabel}</div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={displayData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />

          {/* 背景色帶 — 僅 I-MR（固定限）*/}
          {!hasVariableLimits && sigma > 0 && (
            <>
              {/* 1σ 正常區（綠） */}
              <ReferenceArea
                y1={Math.max(0, cl - sigma)}
                y2={cl + sigma}
                fill={CONTROL_CHART_COLORS.zoneNormal}
                ifOverflow="hidden"
              />
              {/* 1σ-2σ 警戒區（黃） */}
              <ReferenceArea
                y1={cl + sigma}
                y2={ucl2}
                fill={CONTROL_CHART_COLORS.zoneCaution}
                ifOverflow="hidden"
              />
              <ReferenceArea
                y1={Math.max(0, lcl2)}
                y2={Math.max(0, cl - sigma)}
                fill={CONTROL_CHART_COLORS.zoneCaution}
                ifOverflow="hidden"
              />
              {/* 2σ-3σ 危險區（紅） */}
              <ReferenceArea
                y1={ucl2}
                y2={ucl}
                fill={CONTROL_CHART_COLORS.zoneDanger}
                ifOverflow="hidden"
              />
              <ReferenceArea
                y1={lcl}
                y2={Math.max(0, lcl2)}
                fill={CONTROL_CHART_COLORS.zoneDanger}
                ifOverflow="hidden"
              />
            </>
          )}

          {/* 管制線 — CL 始終為固定水平線（挑戰目標模式以紫色標示） */}
          <ReferenceLine
            y={cl}
            stroke={isTargetMode ? '#9333EA' : CONTROL_CHART_COLORS.cl}
            strokeDasharray="5 5"
            label={{
              value: isTargetMode ? `目標 ${cl.toFixed(2)}` : `CL ${cl.toFixed(2)}`,
              position: 'right',
              fontSize: 10,
              fill: isTargetMode ? '#9333EA' : '#6B7280',
            }}
          />

          {/* 固定管制限（I-MR）*/}
          {!hasVariableLimits && (
            <>
              <ReferenceLine
                y={ucl}
                stroke={CONTROL_CHART_COLORS.ucl}
                strokeDasharray="8 4"
                label={{ value: `UCL ${ucl.toFixed(2)}`, position: 'right', fontSize: 10, fill: '#DC2626' }}
              />
              {lcl > 0 && (
                <ReferenceLine
                  y={lcl}
                  stroke={CONTROL_CHART_COLORS.lcl}
                  strokeDasharray="8 4"
                  label={{ value: `LCL ${lcl.toFixed(2)}`, position: 'right', fontSize: 10, fill: '#DC2626' }}
                />
              )}

              {/* 2σ 線 */}
              <ReferenceLine y={ucl2} stroke={CONTROL_CHART_COLORS.sigma2} strokeDasharray="4 4" opacity={0.5} />
              {lcl2 > 0 && (
                <ReferenceLine y={lcl2} stroke={CONTROL_CHART_COLORS.sigma2} strokeDasharray="4 4" opacity={0.5} />
              )}
            </>
          )}

          {/* 同儕值 */}
          {peerValue !== null && (
            <ReferenceLine
              y={peerValue}
              stroke={CONTROL_CHART_COLORS.peer}
              strokeDasharray="3 3"
              label={{ value: `同儕 ${peerValue.toFixed(2)}`, position: 'left', fontSize: 10, fill: '#2563EB' }}
            />
          )}

          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            interval={Math.max(0, Math.floor(chartData.length / 12) - 1)}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* 變動管制限線（P/U Chart）*/}
          {hasVariableLimits && (
            <>
              <Line
                type="stepAfter"
                dataKey="varUcl"
                stroke={CONTROL_CHART_COLORS.ucl}
                strokeDasharray="8 4"
                dot={false}
                activeDot={false}
                connectNulls
                name="UCL"
                legendType="none"
              />
              <Line
                type="stepAfter"
                dataKey="varLcl"
                stroke={CONTROL_CHART_COLORS.lcl}
                strokeDasharray="8 4"
                dot={false}
                activeDot={false}
                connectNulls
                name="LCL"
                legendType="none"
              />
              <Line
                type="stepAfter"
                dataKey="varUcl2"
                stroke={CONTROL_CHART_COLORS.sigma2}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                connectNulls
                opacity={0.5}
                name="2σ上"
                legendType="none"
              />
              <Line
                type="stepAfter"
                dataKey="varLcl2"
                stroke={CONTROL_CHART_COLORS.sigma2}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                connectNulls
                opacity={0.5}
                name="2σ下"
                legendType="none"
              />
            </>
          )}

          {/* 數據線 */}
          <Line
            type="monotone"
            dataKey="value"
            stroke={CONTROL_CHART_COLORS.dataLine}
            strokeWidth={2}
            dot={renderDot as never}
            activeDot={{ r: 6, fill: '#3B82F6' }}
            connectNulls
          />

          {/* Brush removed — using slice-based windowing instead */}

          <Legend wrapperStyle={{ fontSize: 11 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
