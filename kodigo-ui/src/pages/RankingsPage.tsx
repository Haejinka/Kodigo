import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAuthStore } from '@/stores/authStore';
import { formatCurrency } from '@/lib/utils';
import {
  describeSellingUnit,
  fetchSalesReport,
  getDateRangeForDays,
} from '@/lib/reporting';
import type { SalesGroupReportRow } from '@/lib/reporting';

const periods = ['Daily', 'Weekly', 'Monthly'] as const;
type Period = typeof periods[number];

export function RankingsPage() {
  const [period, setPeriod] = useState<Period>('Weekly');
  const { activeStoreId } = useAuthStore();
  const [rankings, setRankings] = useState<SalesGroupReportRow[]>([]);

  useEffect(() => {
    setPeriod('Weekly');
  }, [activeStoreId]);

  useEffect(() => {
    let mounted = true;
    const fetchRankings = async () => {
      try {
        if (!activeStoreId) return;
        const days = period === 'Daily' ? 1 : period === 'Weekly' ? 7 : 30;
        const report = await fetchSalesReport(
          { ...getDateRangeForDays(days), paymentMethod: 'all', status: 'all' },
          activeStoreId,
        );
        if (mounted) setRankings(report.salesByProduct);
      } catch (err) {
        console.error('Error computing rankings:', err);
        if (mounted) setRankings([]);
      }
    };

    void fetchRankings();
    return () => { mounted = false; };
  }, [period, activeStoreId]);

  return (
    <div>
      <PageHeader
        title="Product Rankings"
        subtitle="Top selling products by revenue and units"
        actions={
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        }
      />

      {rankings.length > 0 && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[rankings[1], rankings[0], rankings[2]].map((row, index) => {
            const place = index === 0 ? 2 : index === 1 ? 1 : 3;
            const color = place === 1 ? 'bg-amber-500' : place === 2 ? 'bg-gray-500' : 'bg-amber-900';
            return (
              <div key={row?.key ?? place} className="flex flex-col">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center h-28 flex flex-col justify-center">
                  <div className="font-medium text-sm truncate mt-1">
                    {row ? `${row.productName} - ${describeSellingUnit(row)}` : '-'}
                  </div>
                  <div className="text-sm font-mono mt-1">{row ? formatCurrency(row.netRevenue) : ''}</div>
                </div>
                <div className={`mt-3 rounded-b-lg h-10 flex items-center justify-center text-sm font-semibold text-white ${color}`}>
                  #{place}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-gray-900">Full Rankings - {period}</h3>
        </div>

        {rankings.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="No sales data yet"
            description="Complete sales through the POS to see product rankings here."
          />
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-12 gap-3 text-xs text-gray-500 font-semibold border-b pb-2">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Product / Option</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-2 text-right">Units Sold</div>
              <div className="col-span-2 text-right">Revenue</div>
            </div>
            <div className="space-y-3 mt-3">
              {(() => {
                const totalRevenue = rankings.reduce((sum, row) => sum + row.netRevenue, 0) || 0.000001;
                return rankings.map((row, index) => (
                  <div key={row.key} className="grid grid-cols-12 gap-3 items-center text-sm">
                    <div className="col-span-1 text-gray-600">{index + 1}</div>
                    <div className="col-span-5 truncate">
                      <div>{row.productName}</div>
                      <div className="text-xs text-gray-400">
                        {row.sellingOptionLabel || row.unitLabel} - {describeSellingUnit(row)}
                      </div>
                    </div>
                    <div className="col-span-2 text-gray-500">{row.categoryName || '-'}</div>
                    <div className="col-span-2 text-right">{row.netQuantity}</div>
                    <div className="col-span-2 text-right font-mono">{formatCurrency(row.netRevenue)}</div>
                    <div className="col-span-12 mt-1">
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${Math.round((row.netRevenue / totalRevenue) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
