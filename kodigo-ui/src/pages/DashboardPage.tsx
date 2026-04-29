import { DollarSign, ShoppingBag, TrendingUp, BarChart2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { AlertBadge } from '@/components/shared/AlertBadge';
import { formatCurrency } from '@/lib/utils';
import { useAlertStore } from '@/stores/alertStore';
import { useProductStore } from '@/stores/productStore';
import { useAuthStore } from '@/stores/authStore';
import type { DashboardStats } from '@/types';
import { getDefaultSellingOption } from '@/types';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';

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

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const start = new Date();
        start.setHours(0,0,0,0);
        const end = new Date(start);
        end.setDate(start.getDate() + 1);

        let query = supabase.from('sales').select('id,total,store_id,created_at').gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
        if (activeStoreId && activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
        const { data, error } = await query;
        if (error) {
          console.error('Failed to fetch dashboard sales:', error);
          return;
        }

        const salesRows = data || [];
        const totals = salesRows.map((r: any) => Number(r.total || 0));
        const todayRevenue = totals.reduce((a,b) => a + b, 0);
        const todayTransactions = totals.length;
        const avgOrderValue = todayTransactions ? todayRevenue / todayTransactions : 0;

        // Compute profit for today's sales using sale_items and product cost_price when available.
        let todayProfit = 0;
        try {
          const saleIds = salesRows.map((r: any) => r.id).filter(Boolean);
          if (saleIds.length > 0) {
            const { data: items, error: itemsErr } = await supabase.from('sale_items').select('product_id,quantity,line_total,sale_id').in('sale_id', saleIds);
            if (!itemsErr && items && items.length > 0) {
              const productIds = Array.from(new Set(items.map((it: any) => it.product_id).filter(Boolean)));
              const costMap: Record<string, number> = {};
              if (productIds.length > 0) {
                const { data: prods, error: prodsErr } = await supabase.from('products').select('id,cost_price').in('id', productIds);
                if (!prodsErr && prods) {
                  prods.forEach((p: any) => { costMap[p.id] = Number(p.cost_price || 0); });
                }
              }

              todayProfit = items.reduce((acc: number, it: any) => {
                const line = Number(it.line_total || 0);
                const qty = Number(it.quantity || 0);
                const cost = Number(costMap[it.product_id] || 0) * qty;
                return acc + (line - cost);
              }, 0);
            }
          }
        } catch (err) {
          console.warn('Error computing todayProfit:', err);
          todayProfit = 0;
        }

        if (!mounted) return;
        setS({
          todayRevenue,
          todayTransactions,
          avgOrderValue,
          todayProfit,
          revenueChange: 0,
          transactionsChange: 0,
          avgOrderChange: 0,
          profitChange: 0,
        });
      } catch (err) {
        console.error('Error computing dashboard stats:', err);
      }
    };
    void fetchStats();
    return () => { mounted = false; };
  }, [activeStoreId]);
  const alerts = useAlertStore((state) => state.alerts);
  const products = useProductStore((state) => state.products);
  const stores = useAuthStore((st) => st.stores);
  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || 'Unknown Store';
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    const fetchRecent = async () => {
      try {
        let q = supabase.from('sales').select('id,total,store_id,created_at').order('created_at', { ascending: false }).limit(12);
        if (activeStoreId && activeStoreId !== 'all') q = q.eq('store_id', activeStoreId);
        const { data, error } = await q;
        if (error) {
          console.error('Failed to fetch recent transactions:', error);
          return;
        }

        if (!mounted) return;
        setRecent(data || []);
      } catch (err) {
        console.error('Error fetching recent transactions:', err);
      }
    };
    void fetchRecent();
    return () => { mounted = false; };
  }, [activeStoreId]);

  // Derive top products by currentStock as a placeholder until real sales data is available
  const topProducts = [...products]
    .sort((a, b) => getDefaultSellingOption(b).stockQuantity - getDefaultSellingOption(a).stockQuantity)
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={today}
        actions={
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 border border-gray-200 rounded-lg bg-white hover:bg-gray-50">
              <RefreshCw className="w-3.5 h-3.5" />
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
        {/* Top Products */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Top Products by Stock</h3>
            <a href="/rankings" className="text-xs text-blue-600 hover:underline font-medium">View all</a>
          </div>
          <div className="space-y-3">
            {topProducts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No products yet</p>
            ) : (
              topProducts.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                    {i + 1}
                  </span>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                        {activeStoreId === 'all' && (
                          <span className="text-[10px] uppercase font-bold tracking-wider text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                            {getStoreName(p.storeId)}
                          </span>
                        )}
                      </div>
                    <p className="text-xs text-gray-400">
                      {getDefaultSellingOption(p).stockQuantity} {getDefaultSellingOption(p).unitLabel} in stock
                    </p>
                  </div>
                  <span className="text-sm font-semibold font-mono text-gray-900">
                    {formatCurrency(getDefaultSellingOption(p).sellingPrice)}
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
              <div key={r.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-700">{new Date(r.created_at).toLocaleString()}</div>
                  <div className="text-sm text-gray-500">{getStoreName(r.store_id)}</div>
                </div>
                <div className="text-sm font-mono text-gray-900">{formatCurrency(Number(r.total || 0))}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
