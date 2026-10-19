import { useMemo, useState } from 'react';
import { BarChart2, DollarSign, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/shared/Button';
import { AlertBadge } from '@/components/shared/AlertBadge';
import { Card } from '@/components/ui/card';
import { RevenueChart } from '@/components/analytics/RevenueChart';
import { formatCurrency } from '@/lib/utils';
import { fetchSalesReport, toDateInput } from '@/lib/reporting';
import type { SalesReportData, SalesTransactionReportRow } from '@/lib/reporting';
import { getCalendarInterval, getMonthlyTopProducts } from '@/lib/reporting-calculations';
import type { DashboardReportingPeriod, MonthlyTopProduct } from '@/lib/reporting-calculations';
import { useAlertStore } from '@/stores/alertStore';
import { useAuthStore } from '@/stores/authStore';

const periodOptions: Array<{ value: DashboardReportingPeriod; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

interface DashboardPeriodData {
  transactions: SalesTransactionReportRow[];
  revenue: number;
  transactionCount: number;
  averageOrderValue: number;
  profit: number;
  chart: Array<{ date: string; revenue: number; profit: number; transactions: number }>;
}

function isDateWithin(value: string, startDate: string, endDate: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const localDate = toDateInput(date);
  return localDate >= startDate && localDate <= endDate;
}

function buildDashboardPeriodData(report: SalesReportData | undefined, startDate: string, endDate: string, period: DashboardReportingPeriod): DashboardPeriodData {
  const transactions = (report?.transactions ?? []).filter((transaction) => isDateWithin(transaction.dateTime, startDate, endDate));
  const lines = (report?.saleLines ?? []).filter((line) => isDateWithin(line.dateTime, startDate, endDate));
  const revenue = transactions.reduce((sum, transaction) => sum + transaction.netSales, 0);
  const transactionProfitBeforeCost = transactions.reduce(
    (sum, transaction) => sum + transaction.subtotal - transaction.discount - transaction.refunds,
    0,
  );
  const profit = transactionProfitBeforeCost - lines.reduce((sum, line) => sum + line.cogs, 0);
  const byBucket = new Map<string, { date: string; revenue: number; profit: number; transactions: number }>();

  for (const transaction of transactions) {
    const localDate = toDateInput(new Date(transaction.dateTime));
    const bucket = period === 'yearly' ? `${localDate.slice(0, 7)}-01` : localDate;
    const existing = byBucket.get(bucket) ?? { date: bucket, revenue: 0, profit: 0, transactions: 0 };
    existing.revenue += transaction.netSales;
    existing.profit += transaction.subtotal - transaction.discount - transaction.refunds;
    existing.transactions += 1;
    byBucket.set(bucket, existing);
  }

  for (const line of lines) {
    const localDate = toDateInput(new Date(line.dateTime));
    const bucket = period === 'yearly' ? `${localDate.slice(0, 7)}-01` : localDate;
    const existing = byBucket.get(bucket) ?? { date: bucket, revenue: 0, profit: 0, transactions: 0 };
    existing.profit -= line.cogs;
    byBucket.set(bucket, existing);
  }

  const chart = Array.from(byBucket.values()).sort((a, b) => a.date.localeCompare(b.date));
  return {
    transactions,
    revenue,
    transactionCount: transactions.length,
    averageOrderValue: transactions.length ? revenue / transactions.length : 0,
    profit,
    chart,
  };
}

function monthKeyFromDate(date: string) {
  return date.slice(0, 7);
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1));
}

export function DashboardPage() {
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const alerts = useAlertStore((state) => state.alerts);
  const [referenceDate, setReferenceDate] = useState(() => toDateInput(new Date()));
  const [period, setPeriod] = useState<DashboardReportingPeriod>('monthly');

  const selectedInterval = useMemo(() => getCalendarInterval(referenceDate, period), [referenceDate, period]);
  const monthInterval = useMemo(() => getCalendarInterval(referenceDate, 'monthly'), [referenceDate]);
  const reportRange = useMemo(() => ({
    startDate: selectedInterval.startDate < monthInterval.startDate ? selectedInterval.startDate : monthInterval.startDate,
    endDate: selectedInterval.endDate > monthInterval.endDate ? selectedInterval.endDate : monthInterval.endDate,
  }), [monthInterval.endDate, monthInterval.startDate, selectedInterval.endDate, selectedInterval.startDate]);

  const dashboardQuery = useQuery({
    queryKey: ['reporting', 'dashboard', userId, activeStoreId, reportRange.startDate, reportRange.endDate],
    queryFn: () => fetchSalesReport(
      { ...reportRange, paymentMethod: 'all', status: 'all' },
      activeStoreId,
    ),
    enabled: Boolean(activeStoreId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const periodData = useMemo(
    () => buildDashboardPeriodData(dashboardQuery.data, selectedInterval.startDate, selectedInterval.endDate, period),
    [dashboardQuery.data, period, selectedInterval.endDate, selectedInterval.startDate],
  );
  const monthlyProducts = useMemo<MonthlyTopProduct[]>(
    () => getMonthlyTopProducts(dashboardQuery.data?.saleLines ?? [], monthKeyFromDate(referenceDate)),
    [dashboardQuery.data?.saleLines, referenceDate],
  );
  const selectedPeriodLabel = periodOptions.find((option) => option.value === period)?.label ?? 'Monthly';
  const monthLabel = formatMonthLabel(monthKeyFromDate(referenceDate));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Business performance for a selected reporting period"
        actions={(
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<RefreshCw className={dashboardQuery.isFetching ? 'animate-spin' : undefined} />}
            onClick={() => void dashboardQuery.refetch()}
            disabled={dashboardQuery.isFetching || !activeStoreId}
          >
            Refresh
          </Button>
        )}
      />

      <Card className="mb-6 grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto] sm:items-end">
        <label className="block text-sm font-medium text-[var(--foreground)]">
          Reference date
          <input
            type="date"
            value={referenceDate}
            onChange={(event) => event.target.value && setReferenceDate(event.target.value)}
            className="report-input mt-1"
            aria-describedby="dashboard-period-help"
          />
        </label>
        <label className="block text-sm font-medium text-[var(--foreground)]">
          Reporting period
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as DashboardReportingPeriod)}
            className="report-input mt-1"
          >
            {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <p id="dashboard-period-help" className="text-xs text-[var(--muted-foreground)] sm:max-w-56">
          {selectedPeriodLabel}: {selectedInterval.startDate} to {selectedInterval.endDate}
        </p>
      </Card>

      {dashboardQuery.isError && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load dashboard sales data. Check the connection and refresh to try again.
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sales Revenue" value={formatCurrency(periodData.revenue)} icon={DollarSign} color="blue" loading={dashboardQuery.isLoading} />
        <StatCard label="Transactions" value={String(periodData.transactionCount)} icon={ShoppingBag} color="green" loading={dashboardQuery.isLoading} />
        <StatCard label="Average Order Value" value={formatCurrency(periodData.averageOrderValue)} icon={TrendingUp} color="amber" loading={dashboardQuery.isLoading} />
        <StatCard label="Estimated Profit" value={formatCurrency(periodData.profit)} icon={BarChart2} color="purple" loading={dashboardQuery.isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="min-w-0 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Top 10 Best-Selling Products</h2>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{monthLabel} · ranked by base units sold</p>
            </div>
            <Link to="/rankings" className="text-xs font-medium text-[var(--primary)] hover:underline">View rankings</Link>
          </div>
          {dashboardQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Loading monthly product sales…</p>
          ) : monthlyProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No qualifying sales for {monthLabel}.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {monthlyProducts.map((row, index) => (
                <div key={row.key} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex size-7 items-center justify-center rounded-full bg-[var(--muted)] text-xs font-bold text-[var(--muted-foreground)]">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">{row.productName}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{row.quantitySold.toLocaleString('en-PH', { maximumFractionDigits: 3 })} {row.baseUnitLabel}</p>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums text-[var(--foreground)]">{formatCurrency(row.salesAmount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Stock alerts</h2>
            <Link to="/restocking" className="text-xs font-medium text-[var(--primary)] hover:underline">View restocking</Link>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No active alerts</p>
            ) : alerts.map((alert) => (
              <div key={alert.id} className="flex items-start gap-3">
                <AlertBadge type={alert.type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{alert.productName}</p>
                  {alert.sellingOptionLabel && <p className="truncate text-xs text-[var(--muted-foreground)]">{alert.sellingOptionLabel}</p>}
                  <p className="text-xs text-[var(--muted-foreground)]">Stock: {alert.currentStock}{alert.unitLabel ? ` ${alert.unitLabel}` : ''} / Min: {alert.minStockLevel}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        {periodData.chart.length === 0 ? (
          <Card className="p-5"><h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Sales trend</h2><p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No sales trend for this period.</p></Card>
        ) : <RevenueChart data={periodData.chart} />}
      </div>

      <Card className="mt-6 p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <span className="size-2 rounded-full bg-[var(--success)]" aria-hidden="true" />
            Transactions in this period
          </h2>
          <Link to="/analytics" className="text-xs font-medium text-[var(--primary)] hover:underline">View analytics</Link>
        </div>
        {dashboardQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">Loading transactions…</p>
        ) : periodData.transactions.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No sales transactions for this period.</p>
        ) : (
          <div className="space-y-3">
            {periodData.transactions.slice(0, 8).map((transaction) => (
              <div key={transaction.saleId} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm text-[var(--foreground)]">{new Date(transaction.dateTime).toLocaleString('en-PH')}</span>
                  <span className="truncate text-sm text-[var(--muted-foreground)]">{transaction.cashierName}</span>
                </div>
                <span className="font-mono text-sm font-medium tabular-nums text-[var(--foreground)]">{formatCurrency(transaction.netSales)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
