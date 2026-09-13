interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-[var(--border)]/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-balance text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm leading-5 text-[var(--muted-foreground)] text-pretty">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
