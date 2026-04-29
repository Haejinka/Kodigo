import { useState, useMemo } from 'react';
import { History, TrendingUp, TrendingDown, Search, X } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn, formatDateTime } from '@/lib/utils';
import type { StockAdjustment, AdjustmentReason } from '@/types';
import { getSaleItemUnitLabel } from '@/types';

interface StockAdjustmentLogProps {
  adjustments: StockAdjustment[];
}

const reasonLabels: Record<AdjustmentReason, string> = {
  damaged:       'Damaged',
  expired:       'Expired',
  lost:          'Lost / Missing',
  'manual-count':'Manual Count',
  restock:       'Restock',
  conversion:    'Conversion',
  other:         'Other',
};

const reasonVariants: Record<AdjustmentReason, string> = {
  damaged:       'bg-red-50 text-red-700 border-red-100',
  expired:       'bg-orange-50 text-orange-700 border-orange-100',
  lost:          'bg-yellow-50 text-yellow-700 border-yellow-100',
  'manual-count':'bg-blue-50 text-blue-700 border-blue-100',
  restock:       'bg-green-50 text-green-700 border-green-100',
  conversion:    'bg-purple-50 text-purple-700 border-purple-100',
  other:         'bg-gray-100 text-gray-600 border-gray-200',
};

export function StockAdjustmentLog({ adjustments }: StockAdjustmentLogProps) {
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState<AdjustmentReason | 'all'>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'increase' | 'decrease'>('all');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return adjustments.filter((a) => {
      const matchesSearch =
        !search ||
        a.productName.toLowerCase().includes(q) ||
        (a.sellingOptionLabel ?? '').toLowerCase().includes(q) ||
        a.note.toLowerCase().includes(q);
      const matchesReason = reasonFilter === 'all' || a.reason === reasonFilter;
      const matchesDir =
        directionFilter === 'all' ||
        (directionFilter === 'increase' && a.quantityDelta > 0) ||
        (directionFilter === 'decrease' && a.quantityDelta < 0);
      return matchesSearch && matchesReason && matchesDir;
    });
  }, [adjustments, search, reasonFilter, directionFilter]);

  const clearFilters = () => {
    setSearch('');
    setReasonFilter('all');
    setDirectionFilter('all');
  };

  const hasFilters = search || reasonFilter !== 'all' || directionFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or note…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Reason filter */}
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value as AdjustmentReason | 'all')}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Reasons</option>
          {(Object.keys(reasonLabels) as AdjustmentReason[]).map((r) => (
            <option key={r} value={r}>{reasonLabels[r]}</option>
          ))}
        </select>

        {/* Direction filter */}
        <select
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value as typeof directionFilter)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Changes</option>
          <option value="increase">Increases only</option>
          <option value="decrease">Decreases only</option>
        </select>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 px-2.5 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400">
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title={adjustments.length === 0 ? 'No adjustments yet' : 'No matching entries'}
          description={
            adjustments.length === 0
              ? 'Stock adjustments made from the inventory will appear here.'
              : 'Try clearing your filters.'
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Date & Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Product
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Change
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Before
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    After
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((adj) => {
                  const isIncrease = adj.quantityDelta > 0;
                  return (
                    <tr key={adj.id} className="hover:bg-gray-50 transition-colors">
                      {/* Date */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-gray-500 text-xs">
                          {formatDateTime(adj.createdAt)}
                        </span>
                      </td>

                      {/* Product */}
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{adj.productName}</span>
                        {adj.sellingOptionLabel && (
                          <span className="block text-xs text-gray-400 mt-0.5">
                            {adj.sellingOptionLabel} - {getSaleItemUnitLabel({
                              unitLabel: adj.unitLabel || 'unit',
                              packageSize: adj.packageSize,
                              packageUnit: adj.packageUnit,
                            })}
                          </span>
                        )}
                      </td>

                      {/* Reason */}
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
                            reasonVariants[adj.reason]
                          )}
                        >
                          {reasonLabels[adj.reason]}
                        </span>
                      </td>

                      {/* Delta */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 font-mono font-semibold text-sm',
                            isIncrease ? 'text-green-600' : 'text-red-600'
                          )}
                        >
                          {isIncrease ? (
                            <TrendingUp className="w-3.5 h-3.5" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5" />
                          )}
                          {isIncrease ? '+' : ''}{adj.quantityDelta}
                        </span>
                      </td>

                      {/* Before */}
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-gray-500">{adj.stockBefore}</span>
                      </td>

                      {/* After */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            'font-mono font-semibold',
                            isIncrease ? 'text-green-700' : 'text-red-700'
                          )}
                        >
                          {adj.stockAfter}
                        </span>
                      </td>

                      {/* Note */}
                      <td className="px-4 py-3 max-w-[200px]">
                        {adj.note ? (
                          <span className="text-gray-500 text-xs truncate block" title={adj.note}>
                            {adj.note}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
