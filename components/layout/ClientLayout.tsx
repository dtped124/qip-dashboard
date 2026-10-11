'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AuthGuard } from './AuthGuard';
import { EntryShell } from './EntryShell';
import { DavinciSidebar } from '@/app/davinci/components/DavinciSidebar';
import { DavinciHeader } from '@/app/davinci/components/DavinciHeader';
import { isEntryWorkspace, isPublicPath } from '@/lib/auth/roles';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 不顯示任何外框的頁面（登入頁；非 production 的 /mock/*）
  if (isPublicPath(pathname)) {
    return <AuthGuard>{children}</AuthGuard>;
  }

  // 填報者工作區（/entry 底下除了登入、審核、管理以外的所有路徑，與 canAccess 的填報者範圍同一個定義）：
  // 用極簡的 EntryShell（沒有儀表板側欄／匯入／匯出／設定）。/entry/review* 與 /entry/admin* 是審核者／管理員的
  // 頁面，維持儀表板外框。
  if (isEntryWorkspace(pathname)) {
    return (
      <AuthGuard>
        <EntryShell>{children}</EntryShell>
      </AuthGuard>
    );
  }

  // 達文西模式：外框（側欄/標題列）換成達文西版，QIP 路徑行為完全不變
  const isDavinci = pathname.startsWith('/davinci');

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        {isDavinci ? <DavinciSidebar /> : <Sidebar />}
        <div className="flex-1 flex flex-col overflow-hidden">
          {isDavinci ? <DavinciHeader /> : <Header />}
          <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
