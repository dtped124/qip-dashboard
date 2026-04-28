'use client';

import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { IndicatorMeta, MonthlyDataPoint, ControlChartParams, AnomalyResult, Campus } from '@/lib/types';
import { SlideLayout } from './SlideLayout';
import { exportSlideAsPptx, buildSlideFileName } from '@/lib/export/exportSlide';

interface Props {
  meta: IndicatorMeta;
  dataPoints: MonthlyDataPoint[];
  controlChart: ControlChartParams;
  anomalies: AnomalyResult[];
  peerValue: number | null;
  campus: Campus;
  isQuarterly: boolean;
}

export function ExportSlideButton(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      // 等待下一個 frame 確保 SVG 已掛上 DOM
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const svg = containerRef.current?.querySelector('svg');
      if (!svg) throw new Error('找不到投影片內容');

      // 推算最新期別（用於檔名）
      const sorted = [...props.dataPoints]
        .filter((d) => d.value !== null)
        .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
      const last = sorted[sorted.length - 1];
      const latestPeriod = last
        ? props.isQuarterly
          ? `${last.year}.Q${Math.ceil(last.month / 3)}`
          : `${last.year}.${String(last.month).padStart(2, '0')}`
        : 'unknown';

      const fileName = buildSlideFileName({
        code: props.meta.code,
        name: props.meta.name,
        campus: props.campus,
        latestPeriod,
      });

      await exportSlideAsPptx({
        svgElement: svg as SVGSVGElement,
        fileName,
      });
    } catch (e) {
      console.error('Export PPTX failed:', e);
      setError(e instanceof Error ? e.message : '匯出失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        title="匯出投影片 (.pptx)"
      >
        <Download size={14} />
        {busy ? '匯出中…' : '匯出 PPTX'}
      </button>
      {error && <span className="text-xs text-red-600 ml-2">{error}</span>}

      {/*
        隱藏的渲染容器：永遠掛載，html-to-image / canvas 才能讀取 SVG。
        透過 absolute + 移出畫面的方式隱藏，不用 display:none（會破壞 SVG 量測）。
      */}
      <div
        ref={containerRef}
        aria-hidden
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          width: 1280,
          height: 720,
          pointerEvents: 'none',
        }}
      >
        <SlideLayout
          meta={props.meta}
          dataPoints={props.dataPoints}
          controlChart={props.controlChart}
          anomalies={props.anomalies}
          peerValue={props.peerValue}
          campus={props.campus}
          isQuarterly={props.isQuarterly}
        />
      </div>
    </>
  );
}
