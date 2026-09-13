import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface StatCardProps {
  label: string;
  value: string;
  change?: number | null;
  icon?: React.ComponentType<{ className?: string }>;
  color?: 'blue' | 'green' | 'amber' | 'purple';
  loading?: boolean;
}

const colorMap = {
  blue: { bg: 'bg-[var(--primary-soft)]', icon: 'text-[var(--primary)]', ring: 'ring-blue-100 dark:ring-blue-900/40' },
  green: { bg: 'bg-[var(--success-soft)]', icon: 'text-[var(--success-foreground)]', ring: 'ring-green-100 dark:ring-green-900/40' },
  amber: { bg: 'bg-[var(--warning-soft)]', icon: 'text-[var(--warning-foreground)]', ring: 'ring-amber-100 dark:ring-amber-900/40' },
  purple: { bg: 'bg-violet-50 dark:bg-violet-500/15', icon: 'text-violet-600 dark:text-violet-300', ring: 'ring-violet-100 dark:ring-violet-900/40' },
};

export function StatCard({ label, value, change, icon: Icon, color = 'blue', loading }: StatCardProps) {
  const colors = colorMap[color];

  if (loading) {
    return (
      <Card className="p-5">
        <Skeleton className="mb-4 h-4 w-24" />
        <Skeleton className="mb-3 h-8 w-32" />
        <Skeleton className="h-3 w-20" />
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-[var(--muted-foreground)]">{label}</span>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center ring-4', colors.bg, colors.ring)}>
            <Icon className={cn('w-4 h-4', colors.icon)} />
          </div>
        )}
      </div>
      <p className="font-mono text-2xl font-semibold tracking-tight text-[var(--foreground)] tabular-nums">{value}</p>
      {change !== undefined && change !== null && (
        <div className={cn('flex items-center gap-1 mt-2 text-xs font-medium', change >= 0 ? 'text-[var(--success-foreground)]' : 'text-[var(--destructive)]')}>
          {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{Math.abs(change).toFixed(1)}% vs yesterday</span>
        </div>
      )}
    </Card>
  );
}
