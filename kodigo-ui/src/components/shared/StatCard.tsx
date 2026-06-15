import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  change?: number;
  icon?: React.ComponentType<{ className?: string }>;
  color?: 'blue' | 'green' | 'amber' | 'purple';
  loading?: boolean;
}

const colorMap = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', ring: 'ring-blue-100' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', ring: 'ring-green-100' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600', ring: 'ring-amber-100' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', ring: 'ring-purple-100' },
};

export function StatCard({ label, value, change, icon: Icon, color = 'blue', loading }: StatCardProps) {
  const colors = colorMap[color];

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm animate-pulse">
        <div className="mb-4 h-4 w-24 rounded bg-gray-200" />
        <div className="mb-3 h-7 w-32 rounded bg-gray-200" />
        <div className="h-3 w-16 rounded bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center ring-4', colors.bg, colors.ring)}>
            <Icon className={cn('w-4 h-4', colors.icon)} />
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 font-mono">{value}</p>
      {change !== undefined && (
        <div className={cn('flex items-center gap-1 mt-2 text-xs font-medium', change >= 0 ? 'text-green-600' : 'text-red-600')}>
          {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{Math.abs(change).toFixed(1)}% vs yesterday</span>
        </div>
      )}
    </div>
  );
}
