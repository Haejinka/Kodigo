import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-lg border border-[var(--input)] bg-[var(--background)] px-3 py-2 text-base text-[var(--foreground)] shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/20 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
