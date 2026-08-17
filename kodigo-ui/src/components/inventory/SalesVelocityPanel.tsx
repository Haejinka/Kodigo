import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { fetchSalesReport, getDateRangeForDays } from '@/lib/reporting';
import { useAuthStore } from '@/stores/authStore';
import type { Product } from '@/types';

interface Props { products: Product[] }

interface VelocityRow {
  product: Product;
  units90: number;
  perDay: number;
  daysLeft: number | null;
  indicator: 'Fast-moving' | 'Steady' | 'Slow-moving';
}

const qty = (value: number) => value.toFixed(value >= 10 ? 1 : 2).replace(/\.00$/, '');

export function SalesVelocityPanel({ products }: Props) {
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const [soldByProduct, setSoldByProduct] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeStoreId) return;
    let cancelled = false;
    setLoading(true);
    void fetchSalesReport({ ...getDateRangeForDays(90), paymentMethod: 'all', status: 'completed' }, activeStoreId)
      .then((report) => {
        const next = new Map<string, number>();
        for (const line of report.saleLines) {
          if (!line.productId) continue;
          const product = products.find((item) => item.id === line.productId);
          const multiplier = line.packageSize && line.packageUnit === product?.unit ? line.packageSize : 1;
          next.set(line.productId, (next.get(line.productId) ?? 0) + line.netQuantity * multiplier);
        }
        if (!cancelled) setSoldByProduct(next);
      })
      .catch((error) => console.error('Failed to load sales velocity', error))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeStoreId, products]);

  const rows = useMemo<VelocityRow[]>(() => products.map((product) => {
    const units90 = soldByProduct.get(product.id) ?? 0;
    const perDay = units90 / 90;
    const daysLeft = perDay > 0 ? product.currentStock / perDay : null;
    const indicator: VelocityRow['indicator'] = perDay >= 1 ? 'Fast-moving' : perDay >= 0.15 ? 'Steady' : 'Slow-moving';
    return {
      product,
      units90,
      perDay,
      daysLeft,
      indicator,
    };
  }).sort((a, b) => b.perDay - a.perDay), [products, soldByProduct]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
        <Activity className="h-4 w-4 text-blue-600" />
        <div>
          <h3 className="font-semibold text-gray-900">Sales Velocity</h3>
          <p className="text-xs text-gray-500">Rolling 90-day demand and base-piece inventory forecast</p>
        </div>
      </div>
      {loading ? <p className="p-6 text-sm text-gray-500">Calculating sales velocity...</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>{['Product', 'Per day', 'Per week', 'Per month', 'Days left', 'Recommendation', 'Movement'].map((label) => <th key={label} className="px-4 py-3 text-left">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ product, perDay, daysLeft, indicator }) => {
                const reorderNow = daysLeft != null && daysLeft <= product.leadTimeDays + Math.max(1, product.safetyStock / Math.max(perDay, 0.001));
                return (
                  <tr key={product.id}>
                    <td className="px-4 py-3"><div className="font-medium text-gray-900">{product.name}</div><div className="text-xs text-gray-400">{product.currentStock} {product.unit}s on hand</div></td>
                    <td className="px-4 py-3 font-mono">{qty(perDay)}</td>
                    <td className="px-4 py-3 font-mono">{qty(perDay * 7)}</td>
                    <td className="px-4 py-3 font-mono">{qty(perDay * 30)}</td>
                    <td className="px-4 py-3 font-mono">{daysLeft == null ? 'No recent sales' : qty(daysLeft)}</td>
                    <td className="px-4 py-3">{reorderNow ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Reorder now</span> : daysLeft == null ? 'Review demand' : `Reorder in ${Math.max(0, Math.floor(daysLeft - product.leadTimeDays))} days`}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${indicator === 'Fast-moving' ? 'bg-green-50 text-green-700' : indicator === 'Slow-moving' ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-700'}`}>{indicator}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
