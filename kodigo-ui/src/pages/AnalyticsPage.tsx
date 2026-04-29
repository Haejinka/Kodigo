import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { DollarSign, ShoppingBag, TrendingUp, BarChart2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { RevenueChart } from '@/components/analytics/RevenueChart';
import { HourlySalesChart } from '@/components/analytics/HourlySalesChart';
import { CategorySalesChart } from '@/components/analytics/CategorySalesChart';
import type { RevenueDataPoint, HourlySalesPoint, CategorySalesPoint } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import type { DashboardStats } from '@/types';

const periods = ['Today', '7 days', '30 days', '90 days'] as const;
type Period = typeof periods[number];

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
  const { activeStoreId } = useAuthStore();
  const [s, setS] = useState<DashboardStats>(emptyStats);
  const [revenueData, setRevenueData] = useState<RevenueDataPoint[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlySalesPoint[]>([]);
  const [categoryData, setCategoryData] = useState<CategorySalesPoint[]>([]);
  

  // Clear local UI state when switching stores
  useEffect(() => {
    setPeriod('30 days');
  }, [activeStoreId]);

  // Fetch aggregate stats for the selected period
  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const now = new Date();
        const days = period === 'Today' ? 1 : period === '7 days' ? 7 : period === '90 days' ? 90 : 30;
        const start = new Date(now);
        start.setDate(now.getDate() - (days - 1));
        start.setHours(0,0,0,0);

        let q = supabase.from('sales').select('total,created_at,store_id').gte('created_at', start.toISOString());
        if (activeStoreId && activeStoreId !== 'all') q = q.eq('store_id', activeStoreId);
        const { data, error } = await q;
        if (error) { console.error('Failed to fetch analytics sales:', error); return; }

        const totals = (data || []).map((r: any) => Number(r.total || 0));
        const revenue = totals.reduce((a,b) => a + b, 0);
        const transactions = totals.length;
        const avg = transactions ? revenue / transactions : 0;
        if (!mounted) return;
        setS({
          todayRevenue: revenue,
          todayTransactions: transactions,
          avgOrderValue: avg,
          todayProfit: 0,
          revenueChange: 0,
          transactionsChange: 0,
          avgOrderChange: 0,
          profitChange: 0,
        });
      } catch (err) {
        console.error('Error computing analytics stats:', err);
      }
    };
    void fetchStats();
    return () => { mounted = false; };
  }, [period, activeStoreId]);

  // Prepare chart datasets whenever stats / period change
  useEffect(() => {
    let mounted = true;
    const buildCharts = async () => {
      try {
        const now = new Date();
        const days = period === 'Today' ? 1 : period === '7 days' ? 7 : period === '90 days' ? 90 : 30;
        const start = new Date(now);
        start.setDate(now.getDate() - (days - 1));
        start.setHours(0,0,0,0);

        // Fetch sales rows for period
        let q = supabase.from('sales').select('id,total,created_at,store_id').gte('created_at', start.toISOString()).order('created_at', { ascending: true });
        if (activeStoreId && activeStoreId !== 'all') q = q.eq('store_id', activeStoreId);
        const { data: salesData, error: salesErr } = await q;
        let sales = salesData || [];
        if (salesErr) { console.error('Failed to fetch sales for charts:', salesErr); sales = []; }

        // Revenue chart: aggregate by date (also compute profit by fetching sale_items + product cost_price)
        const revMap = new Map<string, { revenue: number; transactions: number }>();
        const saleById = new Map<string, any>();
        const saleIds: string[] = [];
        for (const srow of sales as any[]) {
          if (!srow || !srow.created_at) continue;
          saleById.set(srow.id, srow);
          saleIds.push(srow.id);
          const d = new Date(srow.created_at).toISOString().slice(0,10);
          const cur = revMap.get(d) || { revenue: 0, transactions: 0 };
          cur.revenue += Number(srow.total || 0);
          cur.transactions += 1;
          revMap.set(d, cur);
        }

        // compute profit per-day by pulling sale_items for the sales in period
        const profitMap = new Map<string, number>();
        if (saleIds.length > 0) {
          try {
            const { data: itemsData, error: itemsErr } = await supabase.from('sale_items').select('sale_id,product_id,quantity,line_total').in('sale_id', saleIds);
            if (itemsErr) {
              console.warn('Failed to fetch sale_items for profit calculation:', itemsErr);
            } else if (itemsData && itemsData.length > 0) {
              const productIds = Array.from(new Set(itemsData.map((it: any) => it.product_id).filter(Boolean)));
              const costMap: Record<string, number> = {};
              if (productIds.length > 0) {
                const { data: prods, error: prodsErr } = await supabase.from('products').select('id,cost_price').in('id', productIds);
                if (prodsErr) console.warn('Failed to fetch products for profit calculation:', prodsErr);
                else if (prods) prods.forEach((p: any) => { costMap[p.id] = Number(p.cost_price || 0); });
              }

              for (const it of itemsData as any[]) {
                const sale = saleById.get(it.sale_id);
                if (!sale) continue;
                const date = new Date(sale.created_at).toISOString().slice(0,10);
                const line = Number(it.line_total || 0);
                const qty = Number(it.quantity || 0);
                const cost = Number(costMap[it.product_id] || 0) * qty;
                const profit = line - cost;
                profitMap.set(date, (profitMap.get(date) || 0) + profit);
              }
            }
          } catch (err) {
            console.warn('Error computing profit map:', err);
          }
        }

        const revList: RevenueDataPoint[] = Array.from(revMap.entries()).map(([date, v]) => ({ date, revenue: v.revenue, profit: profitMap.get(date) || 0, transactions: v.transactions }));

        // Hourly chart: aggregate by hour label (24h)
        const hourMap = new Map<string, number>();
        for (let h = 0; h < 24; h++) hourMap.set(String(h).padStart(2,'0') + ':00', 0);
        for (const srow of sales as any[]) {
          const d = new Date(srow.created_at);
          const label = `${String(d.getHours()).padStart(2,'0')}:00`;
          hourMap.set(label, (hourMap.get(label) || 0) + Number(srow.total || 0));
        }
        const hourlyList: HourlySalesPoint[] = Array.from(hourMap.entries()).map(([hour, sales]) => ({ hour, sales }));

        // Category chart: reliably fetch sale_items for the sales in this period, then resolve product -> category names.
        let categoryList: CategorySalesPoint[] = [];
        try {
          if (saleIds.length > 0) {
            // fetch sale_items by sale_id (safe and simple)
            const { data: items, error: itemsErr } = await supabase
              .from('sale_items')
              .select('sale_id,product_id,line_total,product_name')
              .in('sale_id', saleIds);
            if (itemsErr) {
              console.warn('Failed to fetch sale_items for categories:', itemsErr);
            } else {
              const productIds = Array.from(new Set((items || []).map((it: any) => it.product_id).filter(Boolean)));

              // fetch products to get category_id and product name
              const prodMap: Record<string, any> = {};
              if (productIds.length > 0) {
                const { data: prods, error: prodsErr } = await supabase
                  .from('products')
                  .select('id,name,category_id')
                  .in('id', productIds);
                if (prodsErr) console.warn('Failed to fetch products for categories:', prodsErr);
                else (prods || []).forEach((p: any) => { prodMap[p.id] = p; });
              }

              // fetch category names
              const categoryIds = Array.from(new Set(Object.values(prodMap).map((p: any) => p.category_id).filter(Boolean)));
              const catMap: Record<string, string> = {};
              if (categoryIds.length > 0) {
                const { data: cats, error: catsErr } = await supabase
                  .from('categories')
                  .select('id,name')
                  .in('id', categoryIds);
                if (catsErr) console.warn('Failed to fetch categories for analytics:', catsErr);
                else (cats || []).forEach((c: any) => { catMap[c.id] = c.name; });
              }

              const map = new Map<string, number>();
              for (const it of (items || []) as any[]) {
                const prod = it.product_id ? prodMap[it.product_id] : null;
                const categoryName = prod ? (catMap[prod.category_id] || prod.name || 'Uncategorized') : (it.product_name || 'Uncategorized');
                map.set(categoryName, (map.get(categoryName) || 0) + Number(it.line_total || 0));
              }

              const total = Array.from(map.values()).reduce((a,b) => a + b, 0) || 1;
              categoryList = Array.from(map.entries()).map(([category, revenue]) => ({ category, revenue, percentage: Math.round((revenue / total) * 100) }));
            }
          } else {
            categoryList = [];
          }
        } catch (err) {
          console.warn('Error building category totals:', err);
          categoryList = [];
        }

        if (!mounted) return;
        setRevenueData(revList);
        setHourlyData(hourlyList);
        setCategoryData(categoryList.slice(0,8));
      } catch (err) {
        console.error('Error building charts:', err);
      }
    };
    void buildCharts();
    return () => { mounted = false; };
  }, [period, activeStoreId]);

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

      {/* Charts */}
      <div className="mb-6">
        <RevenueChart data={revenueData.length ? revenueData : [{ date: new Date().toISOString(), revenue: 0, profit: 0, transactions: 0 }]} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <HourlySalesChart data={hourlyData} />
        <CategorySalesChart data={categoryData} />
      </div>

      {/* Transactions Table */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Transactions</h2>
        <RecentTransactions activeStoreId={activeStoreId ?? undefined} />
      </div>
    </div>
  );
}

function RecentTransactions({ activeStoreId }: { activeStoreId?: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let mounted = true;
    const fetchRecent = async () => {
      try {
        let q = supabase.from('sales').select('id,total,store_id,created_at').order('created_at', { ascending: false }).limit(20);
        if (activeStoreId && activeStoreId !== 'all') q = q.eq('store_id', activeStoreId);
        const { data, error } = await q;
        if (error) { console.error('Failed to fetch recent transactions (analytics):', error); return; }
        if (!mounted) return;
        setRows(data || []);
      } catch (err) { console.error('Error fetching analytics recent transactions:', err); }
    };
    void fetchRecent();
    return () => { mounted = false; };
  }, [activeStoreId]);

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
        {rows.map(r => (
          <div key={r.id} className="flex items-center justify-between">
            <div className="text-sm text-gray-700">{new Date(r.created_at).toLocaleString()}</div>
            <div className="text-sm font-mono text-gray-900">{formatCurrency(Number(r.total || 0))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
