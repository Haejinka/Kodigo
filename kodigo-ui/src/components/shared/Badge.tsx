import { cn } from '@/lib/utils';
import type { StockStatus } from '@/types';
import { getStockStatus } from '@/types';
import type { Product } from '@/types';

const statusConfig: Record<StockStatus, { label: string; className: string }> = {
  'in-stock': { label: 'In Stock', className: 'bg-green-100 text-green-700' },
  low: { label: 'Low Stock', className: 'bg-amber-100 text-amber-700' },
  critical: { label: 'Critical', className: 'bg-orange-100 text-orange-700' },
  'out-of-stock': { label: 'Out of Stock', className: 'bg-red-100 text-red-700' },
  overstock: { label: 'Overstock', className: 'bg-blue-100 text-blue-700' },
};

interface StockStatusBadgeProps {
  product: Product;
  className?: string;
}

export function StockStatusBadge({ product, className }: StockStatusBadgeProps) {
  const status = getStockStatus(product);
  const config = statusConfig[status];
  return (
    <span className={cn('inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full', config.className, className)}>
      {config.label}
    </span>
  );
}

// Generic badge
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

const badgeVariants: Record<string, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full', badgeVariants[variant], className)}>
      {children}
    </span>
  );
}
