/**
 * 投影片匯出工具
 *
 * 流程：
 * 1. SlideLayout 元件已渲染至隱藏 DOM 容器（caller 提供 svgElement）
 * 2. SVG → 序列化 → Image → Canvas → PNG
 * 3. 透過 pptxgenjs 嵌入單張 16:9 投影片
 * 4. 觸發下載
 *
 * 注意：呼叫端負責先把 <SlideLayout> render 到一個隱藏的 ref 中，再傳 svgElement 進來
 */

import type pptxgen from 'pptxgenjs';

export interface ExportSlideArgs {
  svgElement: SVGSVGElement;
  fileName: string; // 不含副檔名
  /** 投影片像素寬高（與 svg viewBox 一致） */
  pixelWidth?: number;
  pixelHeight?: number;
}

/** SVG 轉 PNG dataURL */
async function svgToPngDataUrl(
  svg: SVGSVGElement,
  width: number,
  height: number
): Promise<string> {
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

    // 用 2x scale 提升匯出畫質
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法建立 canvas context');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportSlideAsPptx(args: ExportSlideArgs): Promise<void> {
  const { svgElement, fileName, pixelWidth = 1280, pixelHeight = 720 } = args;
  const pngDataUrl = await svgToPngDataUrl(svgElement, pixelWidth, pixelHeight);

  // 動態載入 pptxgenjs（避免 SSR 問題、減少初始 bundle）
  const PptxGen: typeof pptxgen = (await import('pptxgenjs')).default;
  const pres = new PptxGen();
  pres.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5 inches，16:9

  const slide = pres.addSlide();
  slide.addImage({
    data: pngDataUrl,
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
  });

  await pres.writeFile({ fileName: `${fileName}.pptx` });
}

/**
 * 組合檔名：{code}_{name}_{campus}院區_{latestPeriod}
 * 移除作業系統不允許的字元
 */
export function buildSlideFileName(args: {
  code: string;
  name: string;
  campus: string;
  latestPeriod: string; // 如 "115.03" 或 "115.Q1"
}): string {
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();
  return [
    sanitize(args.code),
    sanitize(args.name),
    `${sanitize(args.campus)}院區`,
    sanitize(args.latestPeriod),
  ].join('_');
}
