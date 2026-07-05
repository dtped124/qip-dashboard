'use client';

/**
 * 達文西模組全域狀態（獨立於 QIP 的 dashboardStore）
 * 讓 DavinciSidebar / DavinciHeader / 頁面共用院區與模式 —
 * 側欄院區按鈕直接控制頁面資料（操作方式與 QIP 一致）。
 */

import { create } from 'zustand';
import type { DavinciCampus, DavinciMode } from './types';

interface DavinciState {
  campus: DavinciCampus;
  setCampus: (c: DavinciCampus) => void;
  mode: DavinciMode;
  setMode: (m: DavinciMode) => void;
  importOpen: boolean;              // 匯入對話框（Header 觸發與渲染）
  setImportOpen: (open: boolean) => void;
  dataVersion: number;              // 匯入完成後 +1 → 各頁面 reload
  bumpDataVersion: () => void;
}

export const useDavinciStore = create<DavinciState>(set => ({
  campus: '竹北',
  setCampus: campus => set({ campus }),
  mode: 'monthly',
  setMode: mode => set({ mode }),
  importOpen: false,
  setImportOpen: importOpen => set({ importOpen }),
  dataVersion: 0,
  bumpDataVersion: () => set(s => ({ dataVersion: s.dataVersion + 1 })),
}));
