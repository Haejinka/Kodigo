import { DollarSign, ShoppingBag, TrendingUp, BarChart2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { RevenueChart } from '@/components/analytics/RevenueChart';
import { AlertBadge } from '@/components/shared/AlertBadge';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { mockDashboardStats, mockRevenueData, mockAlerts, mockRankings, mockRecentSales } from '@/lib/mock-data';

export function DashboardPage() {
  const s = mockDashboardStats;
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={today}
        actions={
          <button className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 border border-gray-200 rounded-lg bg-white hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
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

      {/* Revenue Chart */}
      <div className="mb-6">
        <RevenueChart data={mockRevenueData} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Top 5 Products Today</h3>
            <a href="/rankings" className="text-xs text-blue-600 hover:underline font-medium">View all</a>
          </div>
          <div className="space-y-3">
            {mockRankings.slice(0, 5).map((r) => (
              <div key={r.productId} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                  {r.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.productName}</p>
                  <p className="text-xs text-gray-400">{r.unitsSold} units</p>
                </div>
                <span className="text-sm font-semibold font-mono text-gray-900">
                  {formatCurrency(r.revenue)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Stock Alerts</h3>
            <a href="/restocking" className="text-xs text-blue-600 hover:underline font-medium">View restocking</a>
          </div>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {mockAlerts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No active alerts</p>
            ) : (
              mockAlerts.map((alert) => (
                <div key={alert.id} className="flex items-start gap-3">
                  <AlertBadge type={alert.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{alert.productName}</p>
                    <p className="text-xs text-gray-400">
                      Stock: {alert.currentStock} / Min: {alert.minStockLevel}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Live Sales Ticker */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Recent Transactions
          </h3>
          <a href="/analytics" className="text-xs text-blue-600 hover:underline font-medium">View all</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left pb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Time</th>
                <th className="text-left pb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Cashier</th>
                <th className="text-left pb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Items</th>
                <th className="text-right pb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mockRecentSales.map((sale) => (
                <tr key={sale.id}>
                  <td className="py-2.5 text-gray-500 text-xs">{formatDateTime(sale.createdAt)}</td>
                  <td className="py-2.5 text-gray-700">{sale.cashierName}</td>
                  <td className="py-2.5 text-gray-500 text-xs">{sale.items.length} item{sale.items.length !== 1 ? 's' : ''}</td>
                  <td className="py-2.5 text-right font-bold font-mono text-gray-900">{formatCurrency(sale.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
