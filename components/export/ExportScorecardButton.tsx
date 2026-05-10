'use client';

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Download } from 'lucide-react';
import type { IndicatorData } from '@/lib/types';
import { buildQuarterlyScorecard } from '@/lib/export/buildQuarterlyScorecard';
import { QuarterlyScorecardSlide } from './QuarterlyScorecardSlide';

interface Props {
  allData: Record<string, IndicatorData[]>;
}

const W = 1280;
const H = 720;

async function svgToPngDataUrl(svg: SVGSVGElement): Promise<string> {
  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 圖片載入失敗'));
      img.src = url;
    });

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法建立 canvas context');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, W, H);

    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ExportScorecardButton({ allData }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);

    try {
      const slides = buildQuarterlyScorecard(allData);
      if (slides.length === 0) throw new Error('無可匯出的指標資料');

      const container = containerRef.current;
      if (!container) throw new Error('渲染容器不存在');

      const { default: PptxGen } = await import('pptxgenjs');
      const pres = new PptxGen();
      pres.layout = 'LAYOUT_WIDE';

      for (const slideData of slides) {
        const root = createRoot(container);
        flushSync(() => {
          root.render(<QuarterlyScorecardSlide slide={slideData} />);
        });

        const svg = container.querySelector('svg');
        if (!svg) throw new Error('找不到投影片 SVG');

        const pngDataUrl = await svgToPngDataUrl(svg as SVGSVGElement);
        root.unmount();

        const pptxSlide = pres.addSlide();
        pptxSlide.addImage({ data: pngDataUrl, x: 0, y: 0, w: 13.333, h: 7.5 });
      }

      const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();
      const fileName = `季度分析_${sanitize(slides[0].quarterLabel)}_三院區`;
      await pres.writeFile({ fileName: `${fileName}.pptx` });
    } catch (e) {
      console.error('Export scorecard PPTX failed:', e);
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors ml-auto"
        title="匯出季度分析投影片 (.pptx)"
      >
        <Download size={14} />
        {busy ? '匯出中…' : '匯出 PPTX'}
      </button>
      {error && <span className="text-xs text-red-600 ml-2">{error}</span>}

      <div
        ref={containerRef}
        aria-hidden
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          width: W,
          height: H,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}
