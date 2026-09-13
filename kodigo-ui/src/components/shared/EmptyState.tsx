import { PackageSearch } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  icon: Icon = PackageSearch,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--muted)]">
        <Icon className="size-5 text-[var(--muted-foreground)]" aria-hidden="true" />
      </div>
      <p className="mb-1 text-sm font-semibold text-[var(--foreground)]">{title}</p>
      {description && <p className="max-w-sm text-xs leading-5 text-[var(--muted-foreground)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
