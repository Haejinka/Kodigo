import { Topbar } from './Topbar';
import { Sidebar, useSidebar } from './Sidebar';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { collapsed, toggleSidebar } = useSidebar();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 transition-colors">
      <Topbar />
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      </div>
      <main
        className={cn(
          'pt-16 min-h-screen transition-all duration-200',
          collapsed ? 'lg:pl-16' : 'lg:pl-60'
        )}
      >
        <div className="px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
