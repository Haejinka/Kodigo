import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Package,
  SearchX,
  TrendingDown,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchSalesVelocity, getDateRangeForDays } from '@/lib/reporting';
import {
  buildSalesVelocityRows,
  formatDaysOfStock,
  formatVelocityNumber,
  sortSalesVelocityRows,
} from '@/lib/sales-velocity';
import type {
  InventoryStatus,
  SalesVelocityRow,
  VelocityClassification,
  VelocitySort,
} from '@/lib/sales-velocity';
import { useAuthStore } from '@/stores/authStore';
import type { Product } from '@/types';
import { Badge } from '@/components/shared/Badge';
import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { StatCard } from '@/components/shared/StatCard';

interface Props { products: Product[] }

const classificationVariant: Record<VelocityClassification, 'default' | 'success' | 'warning' | 'info'> = {
  'Fast Moving': 'success',
  Normal: 'info',
  'Slow Moving': 'warning',
  'No Sales': 'default',
};

const inventoryVariant: Record<InventoryStatus, 'default' | 'success' | 'warning' | 'info'> = {
  'Restock Soon': 'warning',
  Healthy: 'success',
  'Overstock / Slow Moving': 'info',
  'No Recent Sales': 'default',
};

function VelocityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: SalesVelocityRow; value?: number }>;
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="font-medium text-gray-900">{row.product.name}</p>
      <p className="mt-0.5 text-xs text-gray-500">
        {formatVelocityNumber(row.perDay)} {row.product.unit}/day · {formatVelocityNumber(row.unitsSold)} sold
      </p>
    </div>
  );
}

function statusBadge(label: VelocityClassification | InventoryStatus, variant: 'default' | 'success' | 'warning' | 'info') {
  return <Badge variant={variant}>{label}</Badge>;
}

export function SalesVelocityPanel({ products }: Props) {
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const initialRange = getDateRangeForDays(30);
  const [dateFrom, setDateFrom] = useState(initialRange.startDate);
  const [dateTo, setDateTo] = useState(initialRange.endDate);
  const [categoryId, setCategoryId] = useState('all');
  const [soldByProduct, setSoldByProduct] = useState<Map<string, number>>(new Map());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<VelocitySort>('highest-velocity');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const periodDays = useMemo(() => {
    const start = Date.parse(`${dateFrom}T00:00:00Z`);
    const end = Date.parse(`${dateTo}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
    return Math.floor((end - start) / 86_400_000) + 1;
  }, [dateFrom, dateTo]);

  const categories = useMemo(() => {
    const byId = new Map<string, string>();
    for (const product of products) {
      if (product.categoryId && product.categoryName) byId.set(product.categoryId, product.categoryName);
    }
    return Array.from(byId.entries()).sort((left, right) => left[1].localeCompare(right[1]));
  }, [products]);

  useEffect(() => {
    const range = getDateRangeForDays(30);
    setDateFrom(range.startDate);
    setDateTo(range.endDate);
    setCategoryId('all');
    setSearch('');
    setSortBy('highest-velocity');
  }, [activeStoreId]);

  useEffect(() => {
    if (!activeStoreId) {
      setSoldByProduct(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchSalesVelocity(periodDays, activeStoreId, products, { startDate: dateFrom, endDate: dateTo })
      .then((rows) => {
        if (cancelled) return;
        setSoldByProduct(new Map(rows.map((row) => [row.productId, row.unitsSold])));
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Failed to load sales velocity', loadError);
        setSoldByProduct(new Map());
        setError('Unable to load sales velocity. Check your connection and try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeStoreId, dateFrom, dateTo, periodDays, products, reloadToken]);

  const rows = useMemo(
    () => buildSalesVelocityRows(products, soldByProduct, periodDays),
    [products, soldByProduct, periodDays],
  );

  const categoryRows = useMemo(
    () => categoryId === 'all' ? rows : rows.filter((row) => row.product.categoryId === categoryId),
    [categoryId, rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const matchingRows = normalizedSearch
      ? categoryRows.filter((row) => row.product.name.toLowerCase().includes(normalizedSearch) || row.product.sku.toLowerCase().includes(normalizedSearch))
      : categoryRows;
    return sortSalesVelocityRows(matchingRows, sortBy);
  }, [categoryRows, search, sortBy]);

  const chartRows = useMemo(() => {
    return sortSalesVelocityRows(categoryRows.filter((row) => row.perDay > 0), 'highest-velocity')
      .slice(0, 10)
      .map((row) => ({
        ...row,
        name: row.product.name.length > 24 ? `${row.product.name.slice(0, 23)}…` : row.product.name,
      }));
  }, [categoryRows]);

  const summary = useMemo(() => {
    const activeRows = categoryRows.filter((row) => row.perDay > 0);
    const averagePerDay = activeRows.length > 0
      ? activeRows.reduce((total, row) => total + row.perDay, 0) / activeRows.length
      : 0;
    return {
      fastMoving: categoryRows.filter((row) => row.classification === 'Fast Moving').length,
      slowMoving: categoryRows.filter((row) => row.classification === 'Slow Moving').length,
      restockSoon: categoryRows.filter((row) => row.inventoryStatus === 'Restock Soon').length,
      averagePerDay,
    };
  }, [categoryRows]);

  const columns = useMemo<Column<SalesVelocityRow>[]>(() => [
    {
      key: 'product',
      header: 'Product',
      accessor: (row) => (
        <div className="min-w-[170px]">
          <p className="font-medium text-gray-900">{row.product.name}</p>
          <p className="mt-0.5 text-xs text-gray-400">{formatVelocityNumber(row.unitsSold)} {row.product.unit} sold</p>
        </div>
      ),
    },
    {
      key: 'units-sold',
      header: 'Units sold',
      align: 'right',
      accessor: (row) => <span className="font-mono tabular-nums">{formatVelocityNumber(row.unitsSold)} {row.product.unit}</span>,
    },
    {
      key: 'velocity',
      header: 'Sales velocity',
      align: 'right',
      accessor: (row) => (
        <div className="whitespace-nowrap text-right">
          <p className="font-mono font-semibold tabular-nums text-gray-900">{formatVelocityNumber(row.perDay)} {row.product.unit}/day</p>
          <p className="mt-0.5 text-xs text-gray-400">{formatVelocityNumber(row.perWeek)} {row.product.unit}/week</p>
        </div>
      ),
    },
    {
      key: 'qoh',
      header: 'QOH',
      align: 'right',
      accessor: (row) => <span className="font-mono tabular-nums">{formatVelocityNumber(row.product.currentStock)} {row.product.unit}</span>,
    },
    {
      key: 'coverage',
      header: 'Days of stock',
      align: 'right',
      accessor: (row) => <span className="font-mono tabular-nums">{formatDaysOfStock(row.daysOfStock)}</span>,
    },
    {
      key: 'classification',
      header: 'Velocity',
      accessor: (row) => statusBadge(row.classification, classificationVariant[row.classification]),
    },
    {
      key: 'inventory-status',
      header: 'Inventory status',
      accessor: (row) => statusBadge(row.inventoryStatus, inventoryVariant[row.inventoryStatus]),
    },
  ], []);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="sales-velocity-title">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="sales-velocity-title" className="font-semibold text-gray-900">Sales Velocity</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">
                Completed sales converted to base-unit demand. Choose a period to see what may run out next.
              </p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              Category
              <select
                aria-label="Filter sales velocity by category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="h-10 min-w-40 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All categories</option>
                {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              Date from
              <input type="date" value={dateFrom} max={dateTo} onChange={(event) => { if (event.target.value) setDateFrom(event.target.value); }} className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              Date to
              <input type="date" value={dateTo} min={dateFrom} onChange={(event) => { if (event.target.value) setDateTo(event.target.value); }} className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Fast-Moving Products" value={String(summary.fastMoving)} icon={Zap} color="green" loading={loading} />
        <StatCard label="Slow-Moving Products" value={String(summary.slowMoving)} icon={TrendingDown} color="amber" loading={loading} />
        <StatCard label="Products Requiring Restock" value={String(summary.restockSoon)} icon={AlertTriangle} color="amber" loading={loading} />
        <StatCard label="Average Sales Velocity" value={`${formatVelocityNumber(summary.averagePerDay)} units/day`} icon={Activity} color="blue" loading={loading} />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="top-velocity-title">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="top-velocity-title" className="font-semibold text-gray-900">Top 10 fastest-moving products</h3>
            <p className="mt-1 text-xs text-gray-500">Ranked by daily velocity for the selected period.</p>
          </div>
          <span className="text-xs font-medium text-gray-400">Units per day</span>
        </div>
        {loading ? (
          <div className="h-[280px] animate-pulse rounded-lg bg-gray-50" aria-label="Loading chart" />
        ) : chartRows.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg bg-gray-50 px-6 text-center">
            <SearchX className="mb-2 h-5 w-5 text-gray-400" aria-hidden="true" />
            <p className="text-sm font-medium text-gray-700">No completed sales in this period</p>
            <p className="mt-1 text-xs text-gray-500">Try a longer period or complete a sale in POS.</p>
          </div>
        ) : (
          <div className="min-w-0" style={{ height: Math.max(260, chartRows.length * 42) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 56, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => formatVelocityNumber(value)}
                  allowDecimals
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={128}
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<VelocityTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="perDay" name="Velocity" fill="#2563eb" radius={[0, 6, 6, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section aria-labelledby="velocity-table-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="velocity-table-title" className="font-semibold text-gray-900">Product velocity details</h3>
            <p className="mt-1 text-xs text-gray-500">QOH is current base-unit stock; coverage uses QOH ÷ units/day.</p>
          </div>
        </div>
        <DataTable
          key={`${dateFrom}-${dateTo}-${categoryId}-${sortBy}-${search}`}
          columns={columns}
          data={filteredRows}
          rowKey={(row) => row.product.id}
          loading={loading}
          pageSize={15}
          emptyTitle={search ? 'No matching products' : 'No products to analyze'}
          emptyDescription={search ? 'Try a different product name or SKU.' : 'Add products to see sales velocity here.'}
          toolbar={(
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchInput
                id="sales-velocity-search"
                value={search}
                onChange={setSearch}
                placeholder="Search products or SKU…"
                ariaLabel="Search sales velocity products"
                className="w-full sm:w-72"
              />
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <span className="whitespace-nowrap">Sort by</span>
                <select
                  aria-label="Sort sales velocity products"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as VelocitySort)}
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="highest-velocity">Highest velocity</option>
                  <option value="lowest-velocity">Lowest velocity</option>
                  <option value="highest-units-sold">Highest units sold</option>
                  <option value="lowest-stock-coverage">Lowest stock coverage</option>
                  <option value="product-name">Product name</option>
                </select>
              </label>
            </div>
          )}
        />
      </section>

      <p className="flex items-start gap-2 text-xs leading-5 text-gray-400">
        <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Velocity uses net sold quantity from completed transactions. Returned items are removed; cancelled, voided, restocked, and adjustment movements are excluded.</span>
      </p>
    </div>
  );
}
