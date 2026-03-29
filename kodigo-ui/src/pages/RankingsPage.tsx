import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Trophy } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAuthStore } from '@/stores/authStore';
import { formatCurrency } from '@/lib/utils';

const periods = ['Daily', 'Weekly', 'Monthly'] as const;
type Period = typeof periods[number];

export function RankingsPage() {
  const [period, setPeriod] = useState<Period>('Weekly');
  const { activeStoreId } = useAuthStore();
  const [rankings, setRankings] = useState<Array<{ product_id: string; product_name: string; category?: string; units: number; revenue: number }>>([]);

  // Clear local UI state when switching stores
  useEffect(() => {
    setPeriod('Weekly');
  }, [activeStoreId]);

  

  // Fetch aggregated rankings from sale_items joined with sale (applies RLS via sale relation)
  useEffect(() => {
    let mounted = true;
    const fetchRankings = async () => {
      try {
        const now = new Date();
        const days = period === 'Daily' ? 1 : period === 'Weekly' ? 7 : 30;
        const start = new Date(now);
        start.setDate(now.getDate() - (days - 1));
        start.setHours(0,0,0,0);

        let q = supabase.from('sale_items').select('product_id,product_name,quantity,line_total,sale(created_at,store_id)').gte('sale.created_at', start.toISOString()).order('sale.created_at', { ascending: false }).limit(1000);
        if (activeStoreId && activeStoreId !== 'all') q = q.eq('sale.store_id', activeStoreId);
        const { data, error } = await q;
        let items = data || [];
        if (error) {
          console.error('Failed to fetch sale_items for rankings (joined query):', error);
          // Attempt fallback: fetch sale ids for the period (scoped) and then fetch sale_items by sale_id
          try {
            const { data: saleIdsData, error: saleIdsErr } = await supabase.from('sales').select('id').gte('created_at', start.toISOString()).eq('store_id', activeStoreId ?? '').limit(500);
            if (saleIdsErr) {
              console.warn('Failed to fetch sale ids for fallback:', saleIdsErr);
              if (mounted) setRankings([]);
              return;
            }
            const ids = (saleIdsData || []).map((s: any) => s.id);
            if (ids.length === 0) {
              console.info('No sale ids found for fallback (scoped).');
              if (mounted) setRankings([]);
              return;
            }
            const { data: itemsBySale, error: itemsBySaleErr } = await supabase.from('sale_items').select('product_id,product_name,quantity,line_total').in('sale_id', ids).limit(2000);
            if (itemsBySaleErr) {
              console.warn('Fallback fetch of sale_items by sale_id failed:', itemsBySaleErr);
              if (mounted) setRankings([]);
              return;
            }
            console.info('Fallback fetched sale_items by sale_id, count=', (itemsBySale || []).length);
            items = itemsBySale || [];
          } catch (fbErr) {
            console.warn('Error during rankings fallback:', fbErr);
            if (mounted) setRankings([]);
            return;
          }
        }
        console.info('Fetched sale_items for rankings, count=', (items || []).length);
        const map = new Map<string, { product_name: string; units: number; revenue: number }>();
        for (const it of items as any[]) {
          const pid = it.product_id || 'unknown';
          const pname = it.product_name || 'Unknown';
          const qty = Number(it.quantity || 0);
          const rev = Number(it.line_total || 0);
          const cur = map.get(pid) || { product_name: pname, units: 0, revenue: 0 };
          cur.units += qty;
          cur.revenue += rev;
          map.set(pid, cur);
        }
        let list = Array.from(map.entries()).map(([product_id, v]) => ({ product_id, product_name: v.product_name, units: v.units, revenue: v.revenue }));
        list.sort((a,b) => b.revenue - a.revenue);
        // Enrich with product category via products + categories lookup
        try {
          const productIds = list.map(l => l.product_id).filter(Boolean);
          if (productIds.length > 0) {
            const { data: prods } = await supabase.from('products').select('id,name,category_id').in('id', productIds).limit(1000);
            const prodMap = new Map((prods || []).map((p: any) => [p.id, p]));
            const categoryIds = Array.from(new Set((prods || []).map((p: any) => p.category_id).filter(Boolean)));
            let catMap = new Map();
            if (categoryIds.length > 0) {
              const { data: cats } = await supabase.from('categories').select('id,name').in('id', categoryIds).limit(1000);
              catMap = new Map((cats || []).map((c: any) => [c.id, c.name]));
            }
            list = list.map((it) => {
              const p = prodMap.get(it.product_id);
              return { ...it, product_name: p?.name || it.product_name, category: p?.category_id ? (catMap.get(p.category_id) || 'Unknown') : 'Unknown' };
            });
          }
        } catch (enrichErr) {
          console.warn('Failed to enrich rankings with product/category:', enrichErr);
        }
        if (mounted) setRankings(list);
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

      {/* Podium: top 3 separate from the rankings card */}
      {rankings.length > 0 && (() => {
        const totalRevenue = rankings.reduce((s, it) => s + (it.revenue || 0), 0) || 0.000001;
        const top3 = rankings.slice(0, 3);
        return (
          <div className="mb-6 grid grid-cols-3 gap-6">
            <div className="flex flex-col">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center h-28 flex flex-col justify-center">
                <div className="text-xs text-blue-600">🥈</div>
                <div className="font-medium text-sm truncate mt-1">{top3[1]?.product_name ?? '-'}</div>
                <div className="text-sm font-mono mt-1">{top3[1] ? formatCurrency(top3[1].revenue) : ''}</div>
              </div>
              <div className="mt-3 rounded-b-lg h-10 flex items-center justify-center text-sm font-semibold text-white bg-gray-500">#2</div>
            </div>

            <div className="flex flex-col">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 text-center h-36 flex flex-col justify-center transform -translate-y-6 z-10">
                <div className="text-xs text-amber-500">🥇</div>
                <div className="font-semibold text-base truncate mt-2">{top3[0]?.product_name ?? '-'}</div>
                <div className="text-sm font-mono mt-1 text-amber-700">{top3[0] ? formatCurrency(top3[0].revenue) : ''}</div>
              </div>
              <div className="mt-3 rounded-b-xl h-12 flex items-center justify-center text-sm font-semibold text-white bg-amber-500 transform -translate-y-6">#1</div>
            </div>

            <div className="flex flex-col">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center h-28 flex flex-col justify-center">
                <div className="text-xs text-yellow-700">🥉</div>
                <div className="font-medium text-sm truncate mt-1">{top3[2]?.product_name ?? '-'}</div>
                <div className="text-sm font-mono mt-1">{top3[2] ? formatCurrency(top3[2].revenue) : ''}</div>
              </div>
              <div className="mt-3 rounded-b-lg h-10 flex items-center justify-center text-sm font-semibold text-white bg-amber-900">#3</div>
            </div>
          </div>
        );
      })()}

      {/* Full Rankings Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-gray-900">Full Rankings — {period}</h3>
          <div className="ml-auto" />
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
              <div className="col-span-5">Product</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-2 text-right">Units Sold</div>
              <div className="col-span-2 text-right">Revenue</div>
            </div>
            <div className="space-y-2 mt-3">
              {(() => {
                const totalRevenue = rankings.reduce((s, it) => s + (it.revenue || 0), 0) || 0.000001;
                return rankings.map((r, i) => (
                  <div key={r.product_id} className="grid grid-cols-12 gap-3 items-center text-sm">
                    <div className="col-span-1 text-gray-600">{i < 3 ? (i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉') : i+1}</div>
                    <div className="col-span-5 truncate">{r.product_name}</div>
                    <div className="col-span-2 text-gray-500">{r.category || '—'}</div>
                    <div className="col-span-2 text-right">{r.units}</div>
                    <div className="col-span-2 text-right font-mono">{formatCurrency(r.revenue)}</div>
                    <div className="col-span-12 md:col-span-12 mt-1">
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.round((r.revenue / totalRevenue) * 100)}%` }} />
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
