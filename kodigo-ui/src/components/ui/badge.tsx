import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[var(--primary-soft)] text-[var(--primary)]',
        secondary: 'border-transparent bg-[var(--muted)] text-[var(--muted-foreground)]',
        outline: 'border-[var(--border)] bg-transparent text-[var(--foreground)]',
        success: 'border-transparent bg-[var(--success-soft)] text-[var(--success-foreground)]',
        warning: 'border-transparent bg-[var(--warning-soft)] text-[var(--warning-foreground)]',
        destructive: 'border-transparent bg-[var(--destructive-soft)] text-[var(--destructive)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
