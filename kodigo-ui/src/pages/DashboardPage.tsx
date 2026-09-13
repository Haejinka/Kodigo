import { DollarSign, ShoppingBag, TrendingUp, BarChart2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/shared/Button';
import { AlertBadge } from '@/components/shared/AlertBadge';
import { Card } from '@/components/ui/card';
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
import { Link } from 'react-router-dom';

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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={loading ? 'animate-spin' : undefined} />}
              onClick={() => void fetchStats()}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Today's Revenue"
          value={formatCurrency(s.todayRevenue)}
          icon={DollarSign}
          color="blue"
        />
        <StatCard
          label="Transactions"
          value={String(s.todayTransactions)}
          icon={ShoppingBag}
          color="green"
        />
        <StatCard
          label="Avg Order Value"
          value={formatCurrency(s.avgOrderValue)}
          icon={TrendingUp}
          color="amber"
        />
        <StatCard
          label="Today's Profit"
          value={formatCurrency(s.todayProfit)}
          icon={BarChart2}
          color="purple"
        />
      </div>

      {/* Bottom row */}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Best-selling products */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Best-selling products</h2>
            <Link to="/rankings" className="text-xs font-medium text-[var(--primary)] hover:underline">View rankings</Link>
          </div>
          <div className="space-y-3">
            {bestSellers.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No completed sales in the last 7 days</p>
            ) : (
              bestSellers.map((row, i) => (
                <div key={row.key} className="flex items-center gap-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-[var(--muted)] text-xs font-bold text-[var(--muted-foreground)]">
                    {i + 1}
                  </span>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">{row.productName}</p>
                      </div>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {row.netQuantity} sold - {row.sellingOptionLabel || row.unitLabel}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(row.netRevenue)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Low Stock Alerts */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Stock alerts</h2>
            <Link to="/restocking" className="text-xs font-medium text-[var(--primary)] hover:underline">View restocking</Link>
          </div>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No active alerts</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="flex items-start gap-3">
                  <AlertBadge type={alert.type} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">{alert.productName}</p>
                    {alert.sellingOptionLabel && (
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{alert.sellingOptionLabel}</p>
                    )}
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Stock: {alert.currentStock}{alert.unitLabel ? ` ${alert.unitLabel}` : ''} / Min: {alert.minStockLevel}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Sales Trend */}
      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">7-day sales trend</h2>
          <Link to="/reports" className="text-xs font-medium text-[var(--primary)] hover:underline">Open sales reports</Link>
        </div>
        {trend.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No sales trend available yet</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {trend.map((row) => (
              <div key={row.date} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <p className="text-xs text-[var(--muted-foreground)]">{new Date(row.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
                <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--foreground)]">{formatCurrency(row.netSales)}</p>
                <p className="text-[11px] text-[var(--muted-foreground)]">{row.transactions} txns</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent Transactions */}
      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <span className="size-2 rounded-full bg-[var(--success)]" aria-hidden="true" />
            Recent transactions
          </h2>
          <Link to="/analytics" className="text-xs font-medium text-[var(--primary)] hover:underline">View analytics</Link>
        </div>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No transactions recorded yet</p>
        ) : (
          <div className="space-y-3">
            {recent.map((r) => (
              <div key={r.saleId} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-[var(--foreground)]">{new Date(r.dateTime).toLocaleString()}</div>
                  <div className="text-sm text-[var(--muted-foreground)]">{r.cashierName}</div>
                </div>
                <div className="font-mono text-sm font-medium tabular-nums text-[var(--foreground)]">{formatCurrency(r.netSales)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
