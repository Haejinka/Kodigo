import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { DollarSign, ShoppingBag, TrendingUp, BarChart2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { RevenueChart } from '@/components/analytics/RevenueChart';
import { HourlySalesChart } from '@/components/analytics/HourlySalesChart';
import { CategorySalesChart } from '@/components/analytics/CategorySalesChart';
import type { CategorySalesPoint, DashboardStats, HourlySalesPoint, PaymentMethod, RevenueDataPoint, SaleStatus } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import {
  describeSellingUnit,
  fetchSalesReport,
  getDateRangeForDays,
} from '@/lib/reporting';
import type { SalesGroupReportRow, SalesReportData, SalesTransactionReportRow } from '@/lib/reporting';

const periods = ['Today', '7 days', '30 days', '90 days', 'Custom'] as const;
type Period = typeof periods[number];

const initialRange = getDateRangeForDays(30);

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

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30 days');
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'all'>('all');
  const [status, setStatus] = useState<SaleStatus | 'all'>('all');
  const { activeStoreId } = useAuthStore();
  const [report, setReport] = useState<SalesReportData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPeriod('30 days');
    const range = getDateRangeForDays(30);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setPaymentMethod('all');
    setStatus('all');
  }, [activeStoreId]);

  const selectPeriod = (nextPeriod: Period) => {
    setPeriod(nextPeriod);
    if (nextPeriod === 'Custom') return;
    const days = nextPeriod === 'Today' ? 1 : nextPeriod === '7 days' ? 7 : nextPeriod === '90 days' ? 90 : 30;
    const range = getDateRangeForDays(days);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  useEffect(() => {
    let mounted = true;
    const loadReport = async () => {
      if (!activeStoreId) return;
      setLoading(true);
      try {
        const nextReport = await fetchSalesReport(
          { startDate, endDate, paymentMethod, status },
          activeStoreId,
        );
        if (mounted) setReport(nextReport);
      } catch (err) {
        console.error('Failed to load analytics report:', err);
        if (mounted) setReport(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadReport();
    return () => { mounted = false; };
  }, [activeStoreId, endDate, paymentMethod, startDate, status]);

  const stats = useMemo<DashboardStats>(() => {
    if (!report) return emptyStats;
    return {
      todayRevenue: report.summary.netSales,
      todayTransactions: report.summary.totalTransactions,
      avgOrderValue: report.summary.averageTransactionValue,
      todayProfit: report.summary.grossProfit,
      revenueChange: 0,
      transactionsChange: 0,
      avgOrderChange: 0,
      profitChange: 0,
    };
  }, [report]);

  const revenueData = useMemo<RevenueDataPoint[]>(() => {
    return (report?.salesByDate ?? []).map((row) => ({
      date: row.date,
      revenue: row.netSales,
      profit: row.grossProfit,
      transactions: row.transactions,
    }));
  }, [report]);

  const hourlyData = useMemo<HourlySalesPoint[]>(() => {
    const map = new Map<string, number>();
    for (let hour = 0; hour < 24; hour++) map.set(`${String(hour).padStart(2, '0')}:00`, 0);
    for (const transaction of report?.transactions ?? []) {
      const date = new Date(transaction.dateTime);
      const label = `${String(date.getHours()).padStart(2, '0')}:00`;
      map.set(label, (map.get(label) || 0) + transaction.netSales);
    }
    return Array.from(map.entries()).map(([hour, sales]) => ({ hour, sales }));
  }, [report]);

  const categoryData = useMemo<CategorySalesPoint[]>(() => {
    const rows = report?.salesByCategory ?? [];
    const total = rows.reduce((sum, row) => sum + row.netRevenue, 0) || 1;
    return rows.slice(0, 8).map((row) => ({
      category: row.label,
      revenue: row.netRevenue,
      percentage: Math.round((row.netRevenue / total) * 100),
    }));
  }, [report]);

  const optionSales = report?.salesBySellingUnit.slice(0, 10) ?? [];

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={loading ? 'Loading sales data...' : 'Revenue, sales trends, and transaction history'}
        actions={
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => selectPeriod(p)}
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

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs font-medium text-gray-600">
            Start date
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(event) => { setStartDate(event.target.value); setPeriod('Custom'); }}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            End date
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => { setEndDate(event.target.value); setPeriod('Custom'); }}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Payment method
            <select
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod | 'all')}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All payment methods</option>
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-600">
            Transaction status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as SaleStatus | 'all')}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="voided">Voided</option>
              <option value="partially_refunded">Partially refunded</option>
              <option value="refunded">Refunded</option>
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Net Sales" value={formatCurrency(stats.todayRevenue)} change={stats.revenueChange} icon={DollarSign} color="blue" />
        <StatCard label="Transactions" value={String(stats.todayTransactions)} change={stats.transactionsChange} icon={ShoppingBag} color="green" />
        <StatCard label="Avg Order Value" value={formatCurrency(stats.avgOrderValue)} change={stats.avgOrderChange} icon={TrendingUp} color="amber" />
        <StatCard label="Gross Profit" value={formatCurrency(stats.todayProfit)} change={stats.profitChange} icon={BarChart2} color="purple" />
      </div>

      <div className="mb-6">
        <RevenueChart data={revenueData.length ? revenueData : [{ date: new Date().toISOString(), revenue: 0, profit: 0, transactions: 0 }]} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <HourlySalesChart data={hourlyData} />
        <CategorySalesChart data={categoryData} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Sales by Selling Option</h2>
        {optionSales.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No option-level sales recorded for this period.</p>
        ) : (
          <div className="space-y-3">
            {optionSales.map((row) => (
              <SellingOptionRow key={row.key} row={row} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Transactions</h2>
        <RecentTransactions rows={report?.transactions ?? []} />
      </div>
    </div>
  );
}

function SellingOptionRow({ row }: { row: SalesGroupReportRow }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{row.productName}</p>
        <p className="text-xs text-gray-400">
          {row.netQuantity} sold - {describeSellingUnit(row)}
        </p>
      </div>
      <div className="font-mono text-sm font-semibold text-gray-900">{formatCurrency(row.netRevenue)}</div>
    </div>
  );
}

function RecentTransactions({ rows }: { rows: SalesTransactionReportRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
        <p className="text-sm text-gray-400">No transactions recorded yet. Complete a sale in POS to see data here.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="space-y-3">
        {rows.slice(0, 20).map((row) => (
          <div key={row.saleId} className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-700">{new Date(row.dateTime).toLocaleString()}</div>
              <div className="text-xs text-gray-400">{row.cashierName} - {row.paymentMethod}</div>
            </div>
            <div className="text-sm font-mono text-gray-900">{formatCurrency(row.netSales)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
