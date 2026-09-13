import { cn } from '@/lib/utils';
import type { StockStatus } from '@/types';
import { getStockStatus } from '@/types';
import type { Product } from '@/types';
import { Badge as ShadcnBadge } from '@/components/ui/badge';

const statusConfig: Record<StockStatus, { label: string; className: string }> = {
  'in-stock': { label: 'In Stock', className: 'bg-[var(--success-soft)] text-[var(--success-foreground)]' },
  low: { label: 'Low Stock', className: 'bg-[var(--warning-soft)] text-[var(--warning-foreground)]' },
  critical: { label: 'Critical', className: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
  'out-of-stock': { label: 'Out of Stock', className: 'bg-[var(--destructive-soft)] text-[var(--destructive)]' },
  overstock: { label: 'Overstock', className: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
};

interface StockStatusBadgeProps {
  product: Product;
  className?: string;
}

export function StockStatusBadge({ product, className }: StockStatusBadgeProps) {
  const status = getStockStatus(product);
  const config = statusConfig[status];
  return (
    <ShadcnBadge variant="outline" className={cn('border-transparent', config.className, className)}>
      {config.label}
    </ShadcnBadge>
  );
}

// Generic badge
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

const badgeVariants: Record<string, 'secondary' | 'success' | 'warning' | 'destructive' | 'default'> = {
  default: 'secondary',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
  info: 'default',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return <ShadcnBadge variant={badgeVariants[variant]} className={className}>{children}</ShadcnBadge>;
}
