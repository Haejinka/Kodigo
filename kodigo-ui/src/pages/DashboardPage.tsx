import { DollarSign, ShoppingBag, TrendingUp, BarChart2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { AlertBadge } from '@/components/shared/AlertBadge';
import { formatCurrency } from '@/lib/utils';
import { useAlertStore } from '@/stores/alertStore';
import { useAuthStore } from '@/stores/authStore';
import type { DashboardStats } from '@/types';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchSalesReport,
  getDateRangeForDays,
  toDateInput,
} from '@/lib/reporting';
import type { DateSalesReportRow, SalesGroupReportRow, SalesTransactionReportRow } from '@/lib/reporting';

const emptyStats: DashboardStats = {
  todayRevenue: 0,
  todayTransactions: 0,
  avgOrderValue: 0,
  todayProfit: 0,
  revenueChange: 0,
  transactionsChange: 0,
  avgOrderChange: 0,
  profitChange: 0,
};

export function DashboardPage() {
  const [s, setS] = useState<DashboardStats>(emptyStats);
  const activeStoreId = useAuthStore((st) => st.activeStoreId);
  const [bestSellers, setBestSellers] = useState<SalesGroupReportRow[]>([]);
  const [trend, setTrend] = useState<DateSalesReportRow[]>([]);
  const [recent, setRecent] = useState<SalesTransactionReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      if (!activeStoreId) return;
      setLoading(true);
      const today = toDateInput(new Date());
      const todayReport = await fetchSalesReport(
        { startDate: today, endDate: today, paymentMethod: 'all', status: 'all' },
        activeStoreId,
      );
      const trendRange = getDateRangeForDays(7);
      const trendReport = await fetchSalesReport(
        { ...trendRange, paymentMethod: 'all', status: 'all' },
        activeStoreId,
      );

      setS({
        todayRevenue: todayReport.summary.netSales,
        todayTransactions: todayReport.summary.totalTransactions,
        avgOrderValue: todayReport.summary.averageTransactionValue,
        todayProfit: todayReport.summary.grossProfit,
        revenueChange: 0,
        transactionsChange: 0,
        avgOrderChange: 0,
        profitChange: 0,
      });
      setBestSellers(trendReport.salesByProduct.slice(0, 5));
      setTrend(trendReport.salesByDate);
      setRecent(trendReport.transactions.slice(0, 8));
    } catch (err) {
      console.error('Error computing dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);
  const alerts = useAlertStore((state) => state.alerts);
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={today}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchStats()}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Today's Revenue"
          value={formatCurrency(s.todayRevenue)}
          change={s.revenueChange}
          icon={DollarSign}
          color="blue"
        />
        <StatCard
          label="Transactions"
          value={String(s.todayTransactions)}
          change={s.transactionsChange}
          icon={ShoppingBag}
          color="green"
        />
        <StatCard
          label="Avg Order Value"
          value={formatCurrency(s.avgOrderValue)}
          change={s.avgOrderChange}
          icon={TrendingUp}
          color="amber"
        />
        <StatCard
          label="Today's Profit"
          value={formatCurrency(s.todayProfit)}
          change={s.profitChange}
          icon={BarChart2}
          color="purple"
        />
      </div>

      {/* Bottom row */}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Best-selling products */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Best-selling Products</h3>
            <a href="/rankings" className="text-xs text-blue-600 hover:underline font-medium">View all</a>
          </div>
          <div className="space-y-3">
            {bestSellers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No completed sales in the last 7 days</p>
            ) : (
              bestSellers.map((row, i) => (
                <div key={row.key} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                    {i + 1}
                  </span>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{row.productName}</p>
                      </div>
                    <p className="text-xs text-gray-400">
                      {row.netQuantity} sold - {row.sellingOptionLabel || row.unitLabel}
                    </p>
                  </div>
                  <span className="text-sm font-semibold font-mono text-gray-900">
                    {formatCurrency(row.netRevenue)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Stock Alerts</h3>
            <a href="/restocking" className="text-xs text-blue-600 hover:underline font-medium">View restocking</a>
          </div>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No active alerts</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="flex items-start gap-3">
                  <AlertBadge type={alert.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{alert.productName}</p>
                    {alert.sellingOptionLabel && (
                      <p className="text-xs text-gray-400 truncate">{alert.sellingOptionLabel}</p>
                    )}
                    <p className="text-xs text-gray-400">
                      Stock: {alert.currentStock}{alert.unitLabel ? ` ${alert.unitLabel}` : ''} / Min: {alert.minStockLevel}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Sales Trend */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">7-Day Sales Trend</h3>
          <a href="/reports" className="text-xs text-blue-600 hover:underline font-medium">Open reports</a>
        </div>
        {trend.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No sales trend available yet</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {trend.map((row) => (
              <div key={row.date} className="rounded-lg border border-gray-100 px-3 py-2">
                <p className="text-xs text-gray-400">{new Date(row.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
                <p className="font-mono text-sm font-bold text-gray-900 mt-1">{formatCurrency(row.netSales)}</p>
                <p className="text-[11px] text-gray-400">{row.transactions} txns</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Recent Transactions
          </h3>
          <a href="/analytics" className="text-xs text-blue-600 hover:underline font-medium">View all</a>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No transactions recorded yet</p>
        ) : (
          <div className="space-y-3">
            {recent.map((r) => (
              <div key={r.saleId} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-700">{new Date(r.dateTime).toLocaleString()}</div>
                  <div className="text-sm text-gray-500">{r.cashierName}</div>
                </div>
                <div className="text-sm font-mono text-gray-900">{formatCurrency(r.netSales)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
