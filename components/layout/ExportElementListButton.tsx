'use client';

/**
 * 「匯出要素清單」按鈕
 *
 * 觸發 GET /api/v1/indicators/export/element-list/?campus=<當前院區>
 * 後端回傳 .xlsx 二進位，瀏覽器直接下載。檔名由 Content-Disposition 帶出。
 *
 * 按鈕跟著 store.campus 走 — 切到哪個院區，匯的就是那個院區。
 */
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { downloadFile } from '@/lib/http';

export function ExportElementListButton() {
  const campus = useDashboardStore(s => s.campus);
  const [downloading, setDownloading] = useState(false);

  async function handleClick() {
    setDownloading(true);
    try {
      const { blob, filename: serverFilename } = await downloadFile(
        `/api/v1/indicators/export/element-list/?campus=${encodeURIComponent(campus)}`,
      );

      // Build sensible default filename (used if the response carries no
      // usable Content-Disposition). Format mirrors backend:
      //   YYYYMMDDHHMMSS_要素清單匯出-<prefix>.xlsx
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts =
        now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds());
      const filenamePrefix =
        campus === '竹北' ? '生醫竹北' :
        campus === '竹東' ? '生醫竹東' :
        '新竹';
      // Prefer the backend's actual filename
      const filename = serverFilename ?? `${ts}_要素清單匯出-${filenamePrefix}.xlsx`;

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      alert(`匯出失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={downloading}
      title={`匯出 ${campus}院區 最近 6 個月要素清單`}
      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
    >
      {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      匯出要素清單
      <span className="text-xs opacity-80">({campus})</span>
    </button>
  );
}
