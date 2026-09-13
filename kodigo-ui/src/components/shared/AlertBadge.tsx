import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type AlertType = 'low' | 'critical' | 'out-of-stock' | 'overstock';

interface AlertBadgeProps {
  type: AlertType;
  count?: number;
  className?: string;
}

const styles: Record<AlertType, string> = {
  low: 'border-transparent bg-[var(--warning-soft)] text-[var(--warning-foreground)]',
  critical: 'border-transparent bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'out-of-stock': 'border-transparent bg-[var(--destructive-soft)] text-[var(--destructive)]',
  overstock: 'border-transparent bg-[var(--primary-soft)] text-[var(--primary)]',
};

const labels: Record<AlertType, string> = {
  low: 'Low Stock',
  critical: 'Critical',
  'out-of-stock': 'Out of Stock',
  overstock: 'Overstock',
};

export function AlertBadge({ type, count, className }: AlertBadgeProps) {
  return (
    <Badge variant="outline" className={cn('gap-1', styles[type], className)}>
      {labels[type]}
      {count !== undefined && <span>({count})</span>}
    </Badge>
  );
}
