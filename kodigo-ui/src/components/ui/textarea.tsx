import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn('flex min-h-20 w-full rounded-lg border border-[var(--input)] bg-[var(--background)] px-3 py-2 text-base text-[var(--foreground)] shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/20 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm', className)}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
