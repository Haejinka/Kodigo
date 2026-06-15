import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantStyles: Record<string, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 border border-blue-600',
  secondary: 'border text-gray-700 transition-colors',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 border border-red-600',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 active:bg-gray-200 border border-transparent',
  outline: 'bg-transparent text-blue-600 hover:bg-blue-50 border border-blue-600',
};

const sizeStyles: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs h-8',
  md: 'px-4 py-2 text-sm h-9',
  lg: 'px-5 py-2.5 text-sm h-11',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      data-variant={variant}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-[var(--app-surface-card)] disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px]',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
