import { cn } from '@/lib/utils';

type AlertType = 'low' | 'critical' | 'out-of-stock' | 'overstock';

interface AlertBadgeProps {
  type: AlertType;
  count?: number;
  className?: string;
}

const styles: Record<AlertType, string> = {
  low: 'bg-amber-100 text-amber-700',
  critical: 'bg-orange-100 text-orange-700',
  'out-of-stock': 'bg-red-100 text-red-700',
  overstock: 'bg-blue-100 text-blue-700',
};

const labels: Record<AlertType, string> = {
  low: 'Low Stock',
  critical: 'Critical',
  'out-of-stock': 'Out of Stock',
  overstock: 'Overstock',
};

export function AlertBadge({ type, count, className }: AlertBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full', styles[type], className)}>
      {labels[type]}
      {count !== undefined && <span>({count})</span>}
    </span>
  );
}
