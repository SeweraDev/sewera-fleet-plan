import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/shared/AppSidebar';
import { Topbar } from '@/components/shared/Topbar';
import { Outlet } from 'react-router-dom';

export function AppLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Topbar />
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
