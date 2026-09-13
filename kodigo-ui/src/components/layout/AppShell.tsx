import { Topbar } from './Topbar';
import { Sidebar, useSidebar } from './Sidebar';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { collapsed, toggleSidebar } = useSidebar();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-[100] rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Skip to content
      </a>
      <Topbar />
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      </div>
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'min-h-screen pt-16 transition-[padding] duration-200',
          collapsed ? 'lg:pl-16' : 'lg:pl-60'
        )}
      >
        <div className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 sm:py-6 xl:px-8">{children}</div>
      </main>
    </div>
  );
}
