'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AuthGuard } from './AuthGuard';
import { DavinciSidebar } from '@/app/davinci/components/DavinciSidebar';
import { DavinciHeader } from '@/app/davinci/components/DavinciHeader';

/** 不顯示 Sidebar/Header 的頁面 */
const BARE_PATHS = ['/entry/login'];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBare = BARE_PATHS.includes(pathname) || pathname.startsWith('/mock/');
  // 達文西模式：外框（側欄/標題列）換成達文西版，QIP 路徑行為完全不變
  const isDavinci = pathname.startsWith('/davinci');

  if (isBare) {
    return <AuthGuard>{children}</AuthGuard>;
  }

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
