import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { RevenueChart } from '@/components/analytics/RevenueChart';
import { HourlySalesChart } from '@/components/analytics/HourlySalesChart';
import { CategorySalesChart } from '@/components/analytics/CategorySalesChart';
import { DataTable } from '@/components/shared/DataTable';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import {
  mockRevenueData, mockHourlySales, mockCategorySales,
  mockRecentSales, mockDashboardStats,
} from '@/lib/mock-data';
import { DollarSign, ShoppingBag, TrendingUp, BarChart2 } from 'lucide-react';
import type { Sale } from '@/types';
import type { Column } from '@/components/shared/DataTable';

const periods = ['Today', '7 days', '30 days', '90 days'] as const;
type Period = typeof periods[number];

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30 days');
  const s = mockDashboardStats;

  const txnColumns: Column<Sale>[] = [
    {
      key: 'createdAt',
      header: 'Date & Time',
      accessor: (sale) => <span className="text-xs text-gray-500">{formatDateTime(sale.createdAt)}</span>,
    },
    { key: 'cashier', header: 'Cashier', accessor: (sale) => <span className="text-gray-700">{sale.cashierName}</span> },
    {
      key: 'items',
      header: 'Items',
      accessor: (sale) => (
        <span className="text-xs text-gray-500 truncate max-w-xs block">
          {sale.items.map((i) => `${i.productName} ×${i.quantity}`).join(', ')}
        </span>
      ),
    },
    { key: 'subtotal', header: 'Subtotal', accessor: (sale) => <span className="font-mono text-gray-600">{formatCurrency(sale.subtotal)}</span>, align: 'right' },
    { key: 'discount', header: 'Discount', accessor: (sale) => <span className="font-mono text-gray-400">{formatCurrency(sale.discount)}</span>, align: 'right' },
    { key: 'total', header: 'Total', accessor: (sale) => <span className="font-mono font-bold text-gray-900">{formatCurrency(sale.total)}</span>, align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Revenue, sales trends, and transaction history"
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

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Revenue" value={formatCurrency(s.todayRevenue)} change={s.revenueChange} icon={DollarSign} color="blue" />
        <StatCard label="Transactions" value={String(s.todayTransactions)} change={s.transactionsChange} icon={ShoppingBag} color="green" />
        <StatCard label="Avg Order Value" value={formatCurrency(s.avgOrderValue)} change={s.avgOrderChange} icon={TrendingUp} color="amber" />
        <StatCard label="Profit" value={formatCurrency(s.todayProfit)} change={s.profitChange} icon={BarChart2} color="purple" />
      </div>

      {/* Revenue Chart */}
      <div className="mb-6">
        <RevenueChart data={mockRevenueData} showProfit />
      </div>

      {/* Hourly + Category Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <HourlySalesChart data={mockHourlySales} />
        <CategorySalesChart data={mockCategorySales} />
      </div>

      {/* Transactions Table */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Transactions</h2>
        <DataTable
          columns={txnColumns}
          data={mockRecentSales}
          rowKey={(s) => s.id}
          emptyTitle="No transactions found"
        />
      </div>
    </div>
  );
}
