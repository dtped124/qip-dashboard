'use client';

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Download } from 'lucide-react';
import type { MonthlyCardSlideData } from '@/lib/export/buildMonthlyCards';
import { svgToPngDataUrl } from '@/lib/export/exportSlide';
import { MonthlyCardSlide, MONTHLY_SLIDE_W, MONTHLY_SLIDE_H } from './MonthlyCardSlide';

interface Props {
  slides: MonthlyCardSlideData[];
  disabled?: boolean;
}

export function ExportMonthlyCardsButton({ slides, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);

    try {
      if (slides.length === 0) throw new Error('無可匯出的指標資料');

      const container = containerRef.current;
      if (!container) throw new Error('渲染容器不存在');

      const { default: PptxGen } = await import('pptxgenjs');
      const pres = new PptxGen();
      pres.layout = 'LAYOUT_WIDE';

      for (const slideData of slides) {
        const root = createRoot(container);
        try {
          flushSync(() => {
            root.render(
              <MonthlyCardSlide slide={slideData} width={MONTHLY_SLIDE_W} height={MONTHLY_SLIDE_H} />,
            );
          });

          const svg = container.querySelector('svg');
          if (!svg) throw new Error('找不到投影片 SVG');

          const pngDataUrl = await svgToPngDataUrl(svg as SVGSVGElement, MONTHLY_SLIDE_W, MONTHLY_SLIDE_H);
          const pptxSlide = pres.addSlide();
          pptxSlide.addImage({ data: pngDataUrl, x: 0, y: 0, w: 13.333, h: 7.5 });
        } finally {
          root.unmount();
        }
      }

      const { year, month } = slides[0];
      const fileName = `月報指標卡_${year}${String(month).padStart(2, '0')}_三院區`;
      await pres.writeFile({ fileName: `${fileName}.pptx` });
    } catch (e) {
      console.error('Export monthly cards PPTX failed:', e);
      setError(e instanceof Error ? e.message : '匯出失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy || disabled || slides.length === 0}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        title="匯出三頁月報指標卡投影片 (.pptx)"
      >
        <Download size={14} />
        {busy ? '匯出中…' : '匯出投影片 (.pptx)'}
      </button>
      {error && <span className="text-xs text-red-600 ml-2">{error}</span>}

      <div
        ref={containerRef}
        aria-hidden
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          width: MONTHLY_SLIDE_W,
          height: MONTHLY_SLIDE_H,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}
