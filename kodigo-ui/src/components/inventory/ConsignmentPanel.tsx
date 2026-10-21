import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Eye,
  Info,
  PackageCheck,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { fetchConsignmentLedger } from '@/lib/consignment';
import type {
  ConsignmentLedger,
  ConsignmentPaymentRecord,
  ConsignmentSupplierBalanceRecord,
} from '@/lib/consignment';
import {
  buildConsignmentMetrics,
  buildConsignmentSalesTrend,
  calculateConsignmentReorder,
} from '@/lib/consignment-calculations';
import type {
  ConsignmentProductMetrics,
  ConsignmentReorderResult,
  ConsignmentScope,
} from '@/lib/consignment-calculations';
import { fetchSalesVelocity, getDateRangeForDays } from '@/lib/reporting';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useProductStore } from '@/stores/productStore';
import { useSupplierStore } from '@/stores/supplierStore';
import type { Product, Supplier } from '@/types';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { useToast } from '@/components/shared/Toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type PeriodPreset = 'all' | '30d' | '90d' | 'custom';
type SortKey = 'product' | 'revenue' | 'profit' | 'coverage' | 'velocity' | 'remaining';
type RecommendationStatus = 'reorder' | 'sufficient' | 'slow' | 'profitability' | 'history';

interface ConsignmentRow {
  metrics: ConsignmentProductMetrics;
  product?: Product;
  supplier?: Supplier;
  storeOwnedBaseUnits: number;
  totalSaleableBaseUnits: number;
  velocityUnits: number;
  dailyVelocity: number;
  reorder: ConsignmentReorderResult;
  status: RecommendationStatus;
  paymentStatus: PaymentStatus;
}

interface PaymentStatus {
  label: string;
  detail: string;
  variant: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

const emptyLedger: ConsignmentLedger = {
  lots: [],
  storeOwnedLots: [],
  allocations: [],
  saleItems: [],
  sales: [],
  supplierBalances: [],
  payments: [],
};

const numberFormatter = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 });

const statusConfig: Record<RecommendationStatus, { label: string; detail: string; variant: PaymentStatus['variant']; icon: typeof TrendingUp }> = {
  reorder: {
    label: 'Reorder suggested',
    detail: 'Total saleable stock is below the replenishment target.',
    variant: 'warning',
    icon: ArrowUpRight,
  },
  sufficient: {
    label: 'Stock sufficient',
    detail: 'Total saleable stock covers the selected demand horizon.',
    variant: 'success',
    icon: CheckCircle2,
  },
  slow: {
    label: 'Low sales velocity',
    detail: 'Demand is weak compared with total saleable stock.',
    variant: 'info',
    icon: TrendingDown,
  },
  profitability: {
    label: 'Review profitability',
    detail: 'Historical consignment sales have not covered their allocated cost.',
    variant: 'danger',
    icon: AlertTriangle,
  },
  history: {
    label: 'Insufficient sales history',
    detail: 'There is not enough recent demand to make a responsible reorder estimate.',
    variant: 'default',
    icon: Clock3,
  },
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQuantity(value: number, unit: string): string {
  const safeUnit = unit || 'unit';
  const label = Math.abs(value - 1) < 0.0001 ? safeUnit : pluralize(safeUnit);
  return `${numberFormatter.format(value)} ${label}`;
}

function pluralize(value: string): string {
  if (value.toLowerCase().endsWith('s')) return value;
  if (value.toLowerCase().endsWith('y')) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}

function formatPercent(value: number): string {
  return `${numberFormatter.format(value * 100)}%`;
}

function getPaymentStatus(balance: ConsignmentSupplierBalanceRecord | undefined): PaymentStatus {
  if (!balance) return { label: 'No payment record', detail: 'No supplier-level payable record found.', variant: 'default' };
  const outstanding = toNumber(balance.outstanding_balance);
  const credit = toNumber(balance.supplier_credit);
  if (credit > 0) return { label: 'Credit available', detail: `${formatCurrency(credit)} supplier credit`, variant: 'info' };
  if (outstanding <= 0.005) return { label: 'Fully paid', detail: 'Supplier payable is settled.', variant: 'success' };
  return { label: 'Outstanding', detail: `${formatCurrency(outstanding)} still owed`, variant: 'warning' };
}

function getPeriodScope(period: PeriodPreset, customStart: string, customEnd: string): ConsignmentScope {
  if (period === 'all') return {};
  if (period === 'custom') return { startDate: customStart, endDate: customEnd };
  return getDateRangeForDays(period === '30d' ? 30 : 90);
}

function getPeriodLabel(period: PeriodPreset, customStart: string, customEnd: string): string {
  if (period === 'all') return 'All time';
  if (period === 'custom') return `${customStart} to ${customEnd}`;
  return period === '30d' ? 'Last 30 days' : 'Last 90 days';
}

function getRecommendationStatus(
  metrics: ConsignmentProductMetrics,
  reorder: ConsignmentReorderResult,
  dailyVelocity: number,
  velocityUnits: number,
): RecommendationStatus {
  if (velocityUnits <= 0) return 'history';
  if (metrics.salesRevenue > 0 && metrics.grossProfit < 0) return 'profitability';
  if (reorder.suggestedBaseUnits > 0) return 'reorder';
  if (dailyVelocity > 0 && (reorder.estimatedDaysUntilDepletion ?? 0) > 90) return 'slow';
  return 'sufficient';
}

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--muted-foreground)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
  tooltip,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof CircleDollarSign;
  tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'red';
  tooltip?: string;
}) {
  const toneClasses = {
    neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    green: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  };
  return (
    <article className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        {tooltip && <span title={tooltip} aria-label={tooltip} className="text-[var(--muted-foreground)]"><Info className="h-4 w-4" aria-hidden="true" /></span>}
      </div>
      <p className="mt-3 text-xs font-medium text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums text-[var(--foreground)]" title={value}>{value}</p>
      <p className="mt-1 text-xs leading-4 text-[var(--muted-foreground)]">{detail}</p>
    </article>
  );
}

function RecommendationBadge({ status }: { status: RecommendationStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return <Badge variant={config.variant}><span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{config.label}</span></Badge>;
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={status.variant}><span className="inline-flex items-center gap-1"><CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />{status.label}</span></Badge>;
}

function ProgressMeter({ value, label }: { value: number; label: string }) {
  const displayValue = Math.max(0, value * 100);
  const barValue = Math.min(100, displayValue);
  return (
    <div className="min-w-[120px]">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono font-semibold tabular-nums text-[var(--foreground)]">{formatPercent(value)}</span>
        <span className="text-[var(--muted-foreground)]">{label}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={displayValue < 100 ? 100 : displayValue} aria-valuenow={displayValue}>
        <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-150" style={{ width: `${barValue}%` }} />
      </div>
    </div>
  );
}

function DetailItem({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
      <p className="text-xs text-[var(--muted-foreground)]">{label}{hint && <span title={hint} aria-label={hint} className="ml-1 inline-flex align-middle"><Info className="h-3 w-3" aria-hidden="true" /></span>}</p>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--foreground)]">{value}</div>
    </div>
  );
}

function ConsignmentAnalysisDialog({
  row,
  ledger,
  scope,
  velocityWindow,
  reviewPeriodDays,
  onClose,
}: {
  row: ConsignmentRow | null;
  ledger: ConsignmentLedger;
  scope: ConsignmentScope;
  velocityWindow: number;
  reviewPeriodDays: number;
  onClose: () => void;
}) {
  const trend = useMemo(() => {
    if (!row) return [];
    const lots = ledger.lots
      .filter((lot) => lot.store_id === row.metrics.storeId && lot.product_id === row.metrics.productId && lot.supplier_id === row.metrics.supplierId)
      .map((lot) => ({
        id: lot.id,
        storeId: lot.store_id,
        productId: lot.product_id,
        supplierId: lot.supplier_id,
        quantityReceived: toNumber(lot.quantity_received),
        quantityRemaining: toNumber(lot.quantity_remaining),
        unitCost: toNumber(lot.unit_cost),
        receivedAt: lot.received_at,
        receivedPurchaseQuantity: lot.received_purchase_quantity == null ? null : toNumber(lot.received_purchase_quantity),
        purchaseUnitLabel: lot.purchase_unit_label,
        piecesPerPurchaseUnit: lot.pieces_per_purchase_unit == null ? null : toNumber(lot.pieces_per_purchase_unit),
        supplierName: lot.supplier_name_snapshot,
      }));
    const lotIds = new Set(lots.map((lot) => lot.id));
    const saleItemsById = new Map(ledger.saleItems.map((item) => [item.id, item]));
    const salesById = new Map(ledger.sales.map((sale) => [sale.id, sale]));
    const saleLinesById = new Map(
      ledger.saleItems.flatMap((item) => {
        const sale = salesById.get(item.sale_id);
        return sale ? [[item.id, {
          id: item.id,
          saleId: item.sale_id,
          createdAt: sale.created_at,
          status: sale.status,
          lineTotal: toNumber(item.line_total),
          baseUnitQuantity: toNumber(item.base_unit_quantity),
        }] as const] : [];
      }),
    );
    const allocations = ledger.allocations
      .filter((allocation) => lotIds.has(allocation.lot_id) && saleItemsById.has(allocation.sale_item_id))
      .map((allocation) => ({
        saleItemId: allocation.sale_item_id,
        saleId: saleItemsById.get(allocation.sale_item_id)?.sale_id || '',
        lotId: allocation.lot_id,
        quantityBaseUnits: toNumber(allocation.quantity_base_units),
        quantityReturned: toNumber(allocation.quantity_returned),
        unitCost: toNumber(allocation.unit_cost),
      }));
    return buildConsignmentSalesTrend({
      lots,
      allocations,
      saleLinesById,
      productId: row.metrics.productId,
      supplierId: row.metrics.supplierId,
      storeId: row.metrics.storeId,
      scope,
    });
  }, [ledger, row, scope]);

  if (!row) return null;
  const { metrics, product, supplier, reorder, paymentStatus } = row;
  const leadTimeDays = supplier?.leadTimeDays ?? product?.leadTimeDays ?? 0;
  const safetyStock = product?.safetyStock ?? 0;
  const costPerBaseUnit = metrics.receivedBaseUnits > 0 ? metrics.supplierCost / metrics.receivedBaseUnits : 0;
  const hasHistoricalRecoveryPrice = metrics.soldBaseUnits > 0 && metrics.averageRealizedPrice > 0;
  const recoveryPrice = hasHistoricalRecoveryPrice ? metrics.averageRealizedPrice : (product?.sellingPrice ?? 0);
  const recoveryPriceSource = hasHistoricalRecoveryPrice ? 'historical average realized price' : 'current selling price';
  const additionalUnitsToRecover = metrics.remainingRevenueToRecover <= 0
    ? 0
    : recoveryPrice > 0 ? Math.ceil(metrics.remainingRevenueToRecover / recoveryPrice) : null;
  const trendMax = Math.max(...trend.map((point) => point.units), 1);
  const recommendation = statusConfig[row.status];
  const supplierBalance = ledger.supplierBalances.find((balance) => balance.store_id === metrics.storeId && balance.supplier_id === metrics.supplierId);
  const receivedInScope = formatQuantity(metrics.receivedBaseUnits, metrics.baseUnit);
  const relatedLots = ledger.lots
    .filter((lot) => lot.store_id === metrics.storeId && lot.product_id === metrics.productId && lot.supplier_id === metrics.supplierId)
    .sort((left, right) => right.received_at.localeCompare(left.received_at));
  const relatedPayments = ledger.payments
    .filter((payment) => payment.store_id === metrics.storeId && payment.supplier_id === metrics.supplierId)
    .slice(0, 8);

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] px-6 py-5">
          <div className="flex items-start gap-3 pr-8">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              <PackageCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-lg">{product?.name || 'Consigned product'}</DialogTitle>
                <RecommendationBadge status={row.status} />
              </div>
              <DialogDescription className="mt-1">{supplier?.name || metrics.supplierName} · {receivedInScope} received in the selected scope</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 px-6 py-6">
          <section aria-labelledby="consignment-financial-overview">
            <SectionHeading title="Financial overview" description="Profitability uses net attributed sales and the historical cost captured on each consignment lot. Supplier payments are shown separately." />
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <DetailItem label="Total received" value={formatQuantity(metrics.receivedBaseUnits, metrics.baseUnit)} />
              <DetailItem label="Units sold" value={formatQuantity(metrics.soldBaseUnits, metrics.baseUnit)} />
              <DetailItem label="Remaining" value={formatQuantity(metrics.remainingBaseUnits, metrics.baseUnit)} />
              <DetailItem label="Supplier cost" value={formatCurrency(metrics.supplierCost)} hint="The full agreed cost of consigned receipts in the selected scope." />
              <DetailItem label="Cost / base unit" value={formatCurrency(costPerBaseUnit)} hint="Weighted historical cost per base unit, not the current product cost." />
              <DetailItem label="Average realized price" value={formatCurrency(metrics.averageRealizedPrice)} hint="Net attributed revenue divided by consigned units sold." />
              <DetailItem label="Net sales revenue" value={formatCurrency(metrics.salesRevenue)} />
              <DetailItem label="Cost of goods sold" value={formatCurrency(metrics.cogs)} hint="Historical lot cost for the consigned units sold." />
              <DetailItem label="Gross profit" value={<span className={metrics.grossProfit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}>{formatCurrency(metrics.grossProfit)}</span>} />
              <DetailItem label="Gross margin" value={metrics.salesRevenue > 0 ? formatPercent(metrics.grossMargin) : '—'} />
              <DetailItem label="Sales cost recovery" value={<ProgressMeter value={metrics.costCoverage} label="of batch cost" />} />
              <DetailItem label="Revenue still required" value={formatCurrency(metrics.remainingRevenueToRecover)} />
              <DetailItem label="Additional units to recover" value={additionalUnitsToRecover == null ? 'Not estimated' : formatQuantity(additionalUnitsToRecover, metrics.baseUnit)} hint={additionalUnitsToRecover == null ? 'No positive historical or current selling price is available for a break-even estimate.' : additionalUnitsToRecover === 0 ? 'The selected consigned revenue already covers the received cost.' : `Uses ${recoveryPriceSource} of ${formatCurrency(recoveryPrice)} per ${metrics.baseUnit}.`} />
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">{additionalUnitsToRecover === 0 ? 'The selected consigned revenue already covers the received batch cost.' : additionalUnitsToRecover == null ? 'Break-even units are not estimated because a positive selling price is unavailable.' : `Break-even estimate uses ${recoveryPriceSource} of ${formatCurrency(recoveryPrice)} per ${metrics.baseUnit}; it is an estimate, not a guaranteed sale.`}</p>
          </section>

          <section aria-labelledby="consignment-sales-performance" className="border-t border-[var(--border)] pt-6">
            <SectionHeading title="Sales performance" description={`Velocity is product-level demand over the last ${velocityWindow} days and may include sales fulfilled from store-owned and consigned stock. Returned and voided units do not count; revenue and COGS below remain consignment-only.`} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailItem label="Sales velocity" value={`${numberFormatter.format(row.dailyVelocity)} ${metrics.baseUnit}/day`} />
              <DetailItem label="Sell-through rate" value={formatPercent(metrics.sellThroughRate)} />
              <DetailItem label="Days of stock remaining" value={reorder.estimatedDaysUntilDepletion == null ? 'No recent sales' : `${numberFormatter.format(reorder.estimatedDaysUntilDepletion)} days`} />
              <DetailItem label="Historical sales" value={formatQuantity(row.velocityUnits, metrics.baseUnit)} />
            </div>
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Attributed sales trend</h3>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{trend.length > 0 ? 'Net base units sold from consignment allocations.' : 'No attributed sales in the selected scope.'}</p>
                </div>
                <Activity className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden="true" />
              </div>
              {trend.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Consignment sales trend">
                  {trend.map((point) => (
                    <div key={point.date} className="min-w-0">
                      <div className="flex h-20 items-end justify-center rounded-md bg-[var(--card)] px-2 py-2">
                        <div className="w-full rounded-sm bg-[var(--primary)]" style={{ height: `${Math.max(8, (point.units / trendMax) * 100)}%` }} title={`${point.label}: ${formatQuantity(point.units, metrics.baseUnit)}`} />
                      </div>
                      <p className="mt-1 truncate text-center text-[11px] text-[var(--muted-foreground)]" title={point.label}>{point.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="consignment-ownership-boundary" className="border-t border-[var(--border)] pt-6">
            <SectionHeading title="Inventory ownership" description="This product can have both store-owned and consigned units. The ownership boundary explains why the quantities can differ." />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailItem label="Store-owned stock" value={formatQuantity(row.storeOwnedBaseUnits, metrics.baseUnit)} hint="Purchased by the store owner; excluded from consignment payables and cost recovery." />
              <DetailItem label="Consigned stock" value={formatQuantity(metrics.remainingBaseUnits, metrics.baseUnit)} hint="Supplier-owned units remaining in consignment lots." />
              <DetailItem label="Total saleable stock" value={formatQuantity(row.totalSaleableBaseUnits, metrics.baseUnit)} hint="Store-owned plus consigned units currently on hand." />
              <DetailItem label="Payable basis" value="Consigned receipts only" hint="Supplier obligations are calculated from consigned receipts, not store-owned purchases." />
            </div>
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 text-sm leading-6 text-[var(--foreground)]">
              <h3 className="font-semibold">Why the recommendation uses different numbers</h3>
              <p className="mt-1">Sales velocity measures product demand across both ownership types. Inventory position uses total saleable stock so store-owned units are not ignored when deciding whether another consignment delivery is needed. Financial results and supplier balances use consigned lots only.</p>
            </div>
          </section>

          <section aria-labelledby="consignment-supplier-information" className="border-t border-[var(--border)] pt-6">
            <SectionHeading title="Supplier information" description="Payment records are kept at supplier level. This view does not fabricate payment allocations to individual receipts." />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailItem label="Supplier" value={supplier?.name || metrics.supplierName} />
              <DetailItem label="Payment terms" value="Payable on receipt" />
              <DetailItem label="Lead time" value={`${leadTimeDays} ${leadTimeDays === 1 ? 'day' : 'days'}`} />
              <DetailItem label="Original received cost" value={formatCurrency(metrics.supplierCost)} />
              <DetailItem label="Total supplier payments" value={formatCurrency(toNumber(supplierBalance?.amount_paid))} />
              <DetailItem label="Outstanding balance" value={formatCurrency(toNumber(supplierBalance?.outstanding_balance))} />
              <DetailItem label="Available credit" value={formatCurrency(toNumber(supplierBalance?.supplier_credit))} />
              <DetailItem label="Payment status" value={<PaymentBadge status={paymentStatus} />} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="border-b border-[var(--border)] bg-[var(--muted)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Related receipts</h3>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">Historical receipt costs remain attached to each consignment lot.</p>
                </div>
                {relatedLots.length === 0 ? <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">No receipts found.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[440px] text-left text-xs"><caption className="sr-only">Related consignment receipts</caption><thead className="text-[var(--muted-foreground)]"><tr><th scope="col" className="px-4 py-2.5">Received</th><th scope="col" className="px-3 py-2.5">Quantity</th><th scope="col" className="px-3 py-2.5 text-right">Remaining</th><th scope="col" className="px-4 py-2.5 text-right">Receipt cost</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{relatedLots.map((lot) => { const received = toNumber(lot.quantity_received); const packSize = Math.max(1, toNumber(lot.pieces_per_purchase_unit) || 1); const purchaseQuantity = lot.received_purchase_quantity == null ? received / packSize : toNumber(lot.received_purchase_quantity); return <tr key={lot.id}><td className="whitespace-nowrap px-4 py-2.5 text-[var(--muted-foreground)]">{formatDateTime(lot.received_at)}</td><td className="px-3 py-2.5 font-mono tabular-nums"><span className="block">{formatQuantity(received, metrics.baseUnit)}</span><span className="mt-0.5 block text-[var(--muted-foreground)]">{numberFormatter.format(purchaseQuantity)} {pluralize(lot.purchase_unit_label || metrics.purchaseUnit)}</span></td><td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatQuantity(toNumber(lot.quantity_remaining), metrics.baseUnit)}</td><td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(received * toNumber(lot.unit_cost))}</td></tr>; })}</tbody></table></div>}
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="border-b border-[var(--border)] bg-[var(--muted)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Payment history</h3>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">Supplier-level payments; no receipt allocation is assumed.</p>
                </div>
                {relatedPayments.length === 0 ? <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">No payments recorded for this supplier.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[360px] text-left text-xs"><caption className="sr-only">Supplier payment history</caption><thead className="text-[var(--muted-foreground)]"><tr><th scope="col" className="px-4 py-2.5">Date</th><th scope="col" className="px-3 py-2.5 text-right">Amount</th><th scope="col" className="px-4 py-2.5">Reference</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{relatedPayments.map((payment) => <tr key={payment.id}><td className="whitespace-nowrap px-4 py-2.5 text-[var(--muted-foreground)]">{formatDateTime(payment.paid_at)}</td><td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(toNumber(payment.amount))}</td><td className="px-4 py-2.5 text-[var(--muted-foreground)]">{payment.reference || payment.note || '—'}</td></tr>)}</tbody></table></div>}
              </div>
            </div>
          </section>

          <section aria-labelledby="consignment-reorder-recommendation" className="border-t border-[var(--border)] pt-6">
            <SectionHeading title="Inventory recommendation" description={recommendation.detail} action={<RecommendationBadge status={row.status} />} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailItem label="Product demand velocity" value={`${numberFormatter.format(row.dailyVelocity)} ${metrics.baseUnit}/day`} hint="Product-level sales demand; it can include sales fulfilled from store-owned and consigned stock." />
              <DetailItem label="Lead time" value={`${leadTimeDays} ${leadTimeDays === 1 ? 'day' : 'days'}`} />
              <DetailItem label="Review period" value={`${reviewPeriodDays} days`} />
              <DetailItem label="Safety stock" value={formatQuantity(safetyStock, metrics.baseUnit)} />
              <DetailItem label="Store-owned stock" value={formatQuantity(row.storeOwnedBaseUnits, metrics.baseUnit)} />
              <DetailItem label="Current consigned stock" value={formatQuantity(metrics.remainingBaseUnits, metrics.baseUnit)} />
              <DetailItem label="Total saleable stock" value={formatQuantity(row.totalSaleableBaseUnits, metrics.baseUnit)} />
              <DetailItem label="Target stock" value={formatQuantity(reorder.targetStock, metrics.baseUnit)} />
              <DetailItem label="Total inventory position" value={formatQuantity(reorder.inventoryPosition, metrics.baseUnit)} hint="Store-owned plus consigned stock, less committed stock when available." />
              <DetailItem label="Suggested order" value={row.status === 'history' ? 'Not estimated' : `${formatQuantity(reorder.suggestedBaseUnits, metrics.baseUnit)} · ${reorder.suggestedPackages} ${pluralize(metrics.purchaseUnit)}`} />
              <DetailItem label="Estimated acquisition cost" value={formatCurrency(reorder.estimatedAcquisitionCost)} />
              <DetailItem label="Estimated sales revenue" value={formatCurrency(reorder.estimatedRevenue)} />
              <DetailItem label="Estimated gross profit" value={<span className={reorder.estimatedGrossProfit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}>{formatCurrency(reorder.estimatedGrossProfit)}</span>} />
              <DetailItem label="Expected stock coverage" value={reorder.expectedStockCoverageDays == null ? 'Not estimated' : `${numberFormatter.format(reorder.expectedStockCoverageDays)} days`} />
            </div>
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 text-sm text-[var(--foreground)] shadow-sm sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--card)] text-[var(--primary)] shadow-sm" aria-hidden="true">
                  <Info className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">How this recommendation is calculated</h3>
                  <p className="mt-1 leading-5 text-[var(--muted-foreground)]">The calculation uses base units so store-owned and consigned stock can be compared consistently.</p>
                </div>
              </div>
              {row.status === 'history' ? (
                <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3 leading-6">No order quantity is suggested because the selected velocity window has no completed product sales. Review the product history before requesting another delivery.</p>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">1. Target stock</p>
                    <p className="mt-2 leading-6">{numberFormatter.format(row.dailyVelocity)} {metrics.baseUnit}/day × {leadTimeDays + reviewPeriodDays} days + {formatQuantity(safetyStock, metrics.baseUnit)} safety stock</p>
                    <p className="mt-2 border-t border-[var(--border)] pt-2 font-mono font-semibold tabular-nums">Result: {formatQuantity(reorder.targetStock, metrics.baseUnit)}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{leadTimeDays} {leadTimeDays === 1 ? 'day' : 'days'} lead time + {reviewPeriodDays} {reviewPeriodDays === 1 ? 'day' : 'days'} review period</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">2. Inventory position</p>
                    <p className="mt-2 leading-6">{formatQuantity(row.storeOwnedBaseUnits, metrics.baseUnit)} store-owned + {formatQuantity(metrics.remainingBaseUnits, metrics.baseUnit)} consigned</p>
                    <p className="mt-2 border-t border-[var(--border)] pt-2 font-mono font-semibold tabular-nums">Result: {formatQuantity(reorder.inventoryPosition, metrics.baseUnit)}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">Both ownership types count as saleable stock.</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">3. Suggested order</p>
                    <p className="mt-2 leading-6">Target stock minus inventory position, never below zero</p>
                    <p className="mt-2 border-t border-[var(--border)] pt-2 font-mono font-semibold tabular-nums">Result: {formatQuantity(reorder.suggestedBaseUnits, metrics.baseUnit)} · {reorder.suggestedPackages} {pluralize(metrics.purchaseUnit)}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">Full package: {formatQuantity(reorder.orderMultiple, metrics.baseUnit)} per {metrics.purchaseUnit}</p>
                  </div>
                </div>
              )}
              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3 leading-6">
                <p className="font-semibold">Ownership note</p>
                <p className="mt-1 text-[var(--muted-foreground)]">Store-owned stock is bought by the store and does not create a supplier payable. Consigned stock is supplier-owned and is the basis for consignment cost recovery and payment status.</p>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConsignmentPanel() {
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const role = useAuthStore((state) => state.role);
  const products = useProductStore((state) => state.products);
  const suppliers = useSupplierStore((state) => state.suppliers);
  const { toast } = useToast();
  const [ledger, setLedger] = useState<ConsignmentLedger>(emptyLedger);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [period, setPeriod] = useState<PeriodPreset>('all');
  const [customStart, setCustomStart] = useState(getDateRangeForDays(30).startDate);
  const [customEnd, setCustomEnd] = useState(getDateRangeForDays(30).endDate);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('product');
  const [velocityWindow, setVelocityWindow] = useState<7 | 14 | 30>(30);
  const [velocityByProduct, setVelocityByProduct] = useState<Map<string, number>>(new Map());
  const [velocityLoading, setVelocityLoading] = useState(false);
  const [velocityError, setVelocityError] = useState('');
  const [reviewPeriodDays, setReviewPeriodDays] = useState('7');
  const [selectedRow, setSelectedRow] = useState<ConsignmentRow | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<ConsignmentSupplierBalanceRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeStoreId) {
      setLedger(emptyLedger);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setLedger(await fetchConsignmentLedger(activeStoreId));
    } catch (loadError) {
      console.error('Failed to load consignment ledger', loadError);
      setLedger(emptyLedger);
      setError('Unable to load consignment records. Refresh to try again.');
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => { void refresh(); }, [refresh, reloadToken]);

  useEffect(() => {
    if (!activeStoreId || products.length === 0) {
      setVelocityByProduct(new Map());
      setVelocityLoading(false);
      return;
    }
    let cancelled = false;
    setVelocityLoading(true);
    setVelocityError('');
    const range = getDateRangeForDays(velocityWindow);
    void fetchSalesVelocity(velocityWindow, activeStoreId, products, range)
      .then((rows) => {
        if (cancelled) return;
        setVelocityByProduct(new Map(rows.map((row) => [row.productId, row.unitsSold])));
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Failed to load consignment sales velocity', loadError);
        setVelocityByProduct(new Map());
        setVelocityError('Sales velocity is unavailable. Recommendations will stay conservative until it loads.');
      })
      .finally(() => { if (!cancelled) setVelocityLoading(false); });
    return () => { cancelled = true; };
  }, [activeStoreId, products, velocityWindow]);

  const scope = useMemo(() => getPeriodScope(period, customStart, customEnd), [customEnd, customStart, period]);
  const baseUnitByProduct = useMemo(() => new Map(products.map((product) => [product.id, product.unit])), [products]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const supplierBalanceByKey = useMemo(() => new Map(ledger.supplierBalances.map((balance) => [`${balance.store_id}:${balance.supplier_id}`, balance])), [ledger.supplierBalances]);
  const saleById = useMemo(() => new Map(ledger.sales.map((sale) => [sale.id, sale])), [ledger.sales]);
  const saleLinesById = useMemo(() => new Map(
    ledger.saleItems.flatMap((item) => {
      const sale = saleById.get(item.sale_id);
      return sale ? [[item.id, {
        id: item.id,
        saleId: item.sale_id,
        createdAt: sale.created_at,
        status: sale.status,
        lineTotal: toNumber(item.line_total),
        baseUnitQuantity: toNumber(item.base_unit_quantity),
      }] as const] : [];
    }),
  ), [ledger.saleItems, saleById]);
  const lotInputs = useMemo(() => ledger.lots.map((lot) => ({
    id: lot.id,
    storeId: lot.store_id,
    productId: lot.product_id,
    supplierId: lot.supplier_id,
    quantityReceived: toNumber(lot.quantity_received),
    quantityRemaining: toNumber(lot.quantity_remaining),
    unitCost: toNumber(lot.unit_cost),
    receivedAt: lot.received_at,
    receivedPurchaseQuantity: lot.received_purchase_quantity == null ? null : toNumber(lot.received_purchase_quantity),
    purchaseUnitLabel: lot.purchase_unit_label,
    piecesPerPurchaseUnit: lot.pieces_per_purchase_unit == null ? null : toNumber(lot.pieces_per_purchase_unit),
    supplierName: lot.supplier_name_snapshot,
  })), [ledger.lots]);
  const allocationInputs = useMemo(() => ledger.allocations.map((allocation) => ({
    saleItemId: allocation.sale_item_id,
    saleId: saleLinesById.get(allocation.sale_item_id)?.saleId || '',
    lotId: allocation.lot_id,
    quantityBaseUnits: toNumber(allocation.quantity_base_units),
    quantityReturned: toNumber(allocation.quantity_returned),
    unitCost: toNumber(allocation.unit_cost),
  })), [ledger.allocations, saleLinesById]);

  const metrics = useMemo(() => buildConsignmentMetrics({
    lots: lotInputs,
    allocations: allocationInputs,
    saleLinesById,
    scope,
    supplierId: supplierFilter === 'all' ? undefined : supplierFilter,
    baseUnitByProduct,
  }), [allocationInputs, baseUnitByProduct, lotInputs, saleLinesById, scope, supplierFilter]);

  const storeOwnedBaseUnitsByKey = useMemo(() => {
    const totals = new Map<string, number>();
    for (const lot of ledger.storeOwnedLots) {
      const key = `${lot.store_id}:${lot.product_id}`;
      totals.set(key, (totals.get(key) ?? 0) + toNumber(lot.quantity_remaining));
    }
    return totals;
  }, [ledger.storeOwnedLots]);

  const rows = useMemo<ConsignmentRow[]>(() => {
    const reviewDays = Math.max(0, toNumber(reviewPeriodDays));
    return metrics.map((metric) => {
      const product = productById.get(metric.productId);
      const supplier = supplierById.get(metric.supplierId);
      const supplierBalance = supplierBalanceByKey.get(`${metric.storeId}:${metric.supplierId}`);
      const storeOwnedBaseUnits = storeOwnedBaseUnitsByKey.get(`${metric.storeId}:${metric.productId}`) ?? 0;
      const totalSaleableBaseUnits = storeOwnedBaseUnits + metric.remainingBaseUnits;
      const velocityUnits = Math.max(0, toNumber(velocityByProduct.get(metric.productId)));
      const dailyVelocity = velocityUnits / velocityWindow;
      const costPerBaseUnit = metric.receivedBaseUnits > 0 ? metric.supplierCost / metric.receivedBaseUnits : 0;
      const reorder = calculateConsignmentReorder({
        dailySales: dailyVelocity,
        leadTimeDays: supplier?.leadTimeDays ?? product?.leadTimeDays ?? 0,
        reviewPeriodDays: reviewDays,
        safetyStock: product?.safetyStock ?? 0,
        onHand: totalSaleableBaseUnits,
        orderMultiple: metric.packSize || product?.conversionFactor || 1,
        costPerBaseUnit,
        sellingPrice: product?.sellingPrice ?? 0,
      });
      return {
        metrics: metric,
        product,
        supplier,
        storeOwnedBaseUnits,
        totalSaleableBaseUnits,
        velocityUnits,
        dailyVelocity,
        reorder,
        status: getRecommendationStatus(metric, reorder, dailyVelocity, velocityUnits),
        paymentStatus: getPaymentStatus(supplierBalance),
      };
    });
  }, [metrics, productById, reviewPeriodDays, storeOwnedBaseUnitsByKey, supplierBalanceByKey, supplierById, velocityByProduct, velocityWindow]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const matchingRows = rows.filter((row) => {
      if (!normalizedSearch) return true;
      const productName = row.product?.name || '';
      const sku = row.product?.sku || '';
      return `${productName} ${sku} ${row.supplier?.name || row.metrics.supplierName}`.toLowerCase().includes(normalizedSearch);
    });
    return [...matchingRows].sort((left, right) => {
      if (sortBy === 'product') return (left.product?.name || '').localeCompare(right.product?.name || '') || left.metrics.supplierName.localeCompare(right.metrics.supplierName);
      if (sortBy === 'revenue') return right.metrics.salesRevenue - left.metrics.salesRevenue;
      if (sortBy === 'profit') return right.metrics.grossProfit - left.metrics.grossProfit;
      if (sortBy === 'coverage') return right.metrics.costCoverage - left.metrics.costCoverage;
      if (sortBy === 'velocity') return right.dailyVelocity - left.dailyVelocity;
      return right.metrics.remainingBaseUnits - left.metrics.remainingBaseUnits;
    });
  }, [rows, search, sortBy]);

  const supplierOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const lot of ledger.lots) seen.set(lot.supplier_id, lot.supplier_name_snapshot || supplierById.get(lot.supplier_id)?.name || 'Supplier');
    return Array.from(seen.entries()).sort((left, right) => left[1].localeCompare(right[1]));
  }, [ledger.lots, supplierById]);

  const summary = useMemo(() => {
    const receivedCost = rows.reduce((sum, row) => sum + row.metrics.supplierCost, 0);
    const salesRevenue = rows.reduce((sum, row) => sum + row.metrics.salesRevenue, 0);
    const cogs = rows.reduce((sum, row) => sum + row.metrics.cogs, 0);
    const receivedUnits = rows.reduce((sum, row) => sum + row.metrics.receivedBaseUnits, 0);
    const soldUnits = rows.reduce((sum, row) => sum + row.metrics.soldBaseUnits, 0);
    const outstanding = ledger.supplierBalances
      .filter((balance) => supplierFilter === 'all' || balance.supplier_id === supplierFilter)
      .reduce((sum, balance) => sum + toNumber(balance.outstanding_balance), 0);
    return {
      receivedCost,
      salesRevenue,
      grossProfit: salesRevenue - cogs,
      outstanding,
      costCoverage: receivedCost > 0 ? salesRevenue / receivedCost : 0,
      sellThrough: receivedUnits > 0 ? soldUnits / receivedUnits : 0,
      receivedUnits,
      soldUnits,
    };
  }, [ledger.supplierBalances, rows, supplierFilter]);

  const beginPayment = (balance: ConsignmentSupplierBalanceRecord) => {
    setPaymentTarget(balance);
    setPaymentAmount('');
    setPaymentReference('');
  };

  const submitPayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(paymentAmount);
    const outstanding = toNumber(paymentTarget.outstanding_balance);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('error', 'Enter a payment amount greater than zero.');
      return;
    }
    if (amount > outstanding + 0.005) {
      toast('error', `Enter no more than the outstanding balance of ${formatCurrency(outstanding)}.`);
      return;
    }
    setSavingPayment(true);
    try {
      const { error: paymentError } = await supabase.rpc('record_consignment_supplier_payment', {
        p_store_id: paymentTarget.store_id,
        p_supplier_id: paymentTarget.supplier_id,
        p_amount: amount,
        p_reference: paymentReference.trim() || null,
        p_note: null,
      });
      if (paymentError) throw paymentError;
      toast('success', `Supplier payment recorded: ${formatCurrency(amount)}.`);
      setPaymentTarget(null);
      await refresh();
    } catch (paymentError) {
      toast('error', paymentError instanceof Error ? paymentError.message : 'Unable to record payment. Check the outstanding balance and try again.');
    } finally {
      setSavingPayment(false);
    }
  };

  const paymentSupplierName = (payment: ConsignmentPaymentRecord) => {
    const balance = ledger.supplierBalances.find((item) => item.store_id === payment.store_id && item.supplier_id === payment.supplier_id);
    return balance?.supplier_name || supplierById.get(payment.supplier_id)?.name || 'Supplier';
  };

  if (loading) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]" role="status">Loading consignment insights…</div>;
  }

  if (!activeStoreId) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">Choose a store to view consignment insights.</div>;
  }

  return (
    <section className="space-y-6" aria-labelledby="consignment-title">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              <WalletCards className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 id="consignment-title" className="text-lg font-semibold text-[var(--foreground)]">Consignment overview</h1>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Payable on receipt</span>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-[var(--muted-foreground)]">Track supplier obligations separately from sales performance. This tab reports supplier-owned consigned lots; store-owned purchases remain in regular inventory and do not create a consignment payable.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[560px] xl:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Reporting period
              <select value={period} onChange={(event) => setPeriod(event.target.value as PeriodPreset)} className="report-input" aria-label="Consignment reporting period">
                <option value="all">All time</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="custom">Custom dates</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Supplier
              <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="report-input" aria-label="Filter consignment by supplier">
                <option value="all">All suppliers</option>
                {supplierOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Velocity window
              <select value={velocityWindow} onChange={(event) => setVelocityWindow(Number(event.target.value) as 7 | 14 | 30)} className="report-input" aria-label="Sales velocity window">
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted-foreground)]">
              Review period (days)
              <input type="number" min="0" step="1" value={reviewPeriodDays} onChange={(event) => setReviewPeriodDays(event.target.value)} className="report-input" aria-label="Reorder review period in days" />
            </label>
          </div>
        </div>
        {period === 'custom' && (
          <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted-foreground)]">From<input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="report-input" /></label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted-foreground)]">To<input type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} className="report-input" /></label>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--muted-foreground)]">
          <span>Financial scope: <strong className="font-medium text-[var(--foreground)]">{getPeriodLabel(period, customStart, customEnd)}</strong></span>
          <span className="inline-flex items-center gap-1"><Info className="h-3.5 w-3.5" aria-hidden="true" />Revenue and cost recovery use the same selected scope.</span>
          {velocityLoading && <span className="inline-flex items-center gap-1" role="status"><RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Updating velocity…</span>}
        </div>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{error}</span><Button type="button" variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setReloadToken((value) => value + 1)}>Refresh</Button></div>}
      {velocityError && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">{velocityError}</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard label="Total supplier cost" value={formatCurrency(summary.receivedCost)} detail={`${formatQuantity(summary.receivedUnits, 'base unit')} received`} icon={CircleDollarSign} tone="amber" tooltip="Full agreed cost of consignment receipts in the selected reporting scope." />
        <MetricCard label="Sales revenue" value={formatCurrency(summary.salesRevenue)} detail={`${formatQuantity(summary.soldUnits, 'base unit')} sold`} icon={TrendingUp} tone="blue" tooltip="Net revenue attributed to consignment lots after discounts, returns, and voids." />
        <MetricCard label="Gross profit" value={formatCurrency(summary.grossProfit)} detail="Revenue minus historical lot cost" icon={summary.grossProfit < 0 ? ArrowDownRight : ArrowUpRight} tone={summary.grossProfit < 0 ? 'red' : 'green'} tooltip="Gross profit is not net business profit because operating expenses are excluded." />
        <MetricCard label="Outstanding payables" value={formatCurrency(summary.outstanding)} detail="Current supplier balance" icon={CreditCard} tone={summary.outstanding > 0 ? 'amber' : 'green'} tooltip="Supplier-level obligations after recorded payments and credits; this is separate from profitability." />
        <MetricCard label="Cost recovery" value={formatPercent(summary.costCoverage)} detail="Sales revenue ÷ received cost" icon={Activity} tone="blue" tooltip="This can exceed 100% when sales revenue is higher than the received supplier cost." />
        <MetricCard label="Sell-through rate" value={formatPercent(summary.sellThrough)} detail="Units sold ÷ units received" icon={PackageCheck} tone="neutral" tooltip="Consignment units sold relative to units received in the selected scope." />
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm" aria-labelledby="consigned-products-title">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <SectionHeading title="Consigned products" description="Amounts use historical lot costs and attributed POS sales. Click View analysis for the reorder calculation and supplier context." action={<span className="text-xs text-[var(--muted-foreground)]">{filteredRows.length} product{filteredRows.length === 1 ? '' : 's'}</span>} />
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block w-full lg:max-w-sm">
              <span className="sr-only">Search consigned products</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU, or supplier…" className="report-input pl-9" />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted-foreground)]">
              <span className="whitespace-nowrap">Sort by</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)} className="report-input min-w-44" aria-label="Sort consigned products">
                <option value="product">Product name</option>
                <option value="revenue">Sales revenue</option>
                <option value="profit">Gross profit</option>
                <option value="coverage">Cost coverage</option>
                <option value="velocity">Sales velocity</option>
                <option value="remaining">Remaining stock</option>
              </select>
            </label>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <PackageCheck className="h-9 w-9 text-[var(--muted-foreground)]" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-[var(--foreground)]">No consigned stock in this scope</h3>
            <p className="mt-1 max-w-md text-sm leading-5 text-[var(--muted-foreground)]">Receive inventory as “Consigned by a supplier” to create an auditable lot, supplier payable, and future profitability analysis.</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Search className="h-8 w-8 text-[var(--muted-foreground)]" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-[var(--foreground)]">No products match “{search}”</h3>
            <button type="button" onClick={() => setSearch('')} className="mt-2 rounded-md px-3 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">Clear search</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] text-left text-sm">
              <caption className="sr-only">Consigned product profitability and inventory recommendations</caption>
              <thead className="bg-[var(--muted)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th scope="col" className="px-5 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Supplier</th>
                  <th scope="col" className="px-4 py-3 text-right">Received consigned</th>
                  <th scope="col" className="px-4 py-3 text-right">Sold from consignment</th>
                  <th scope="col" className="px-4 py-3 text-right">Remaining consigned</th>
                  <th scope="col" className="px-4 py-3 text-right">Sales revenue</th>
                  <th scope="col" className="px-4 py-3 text-right">Supplier cost</th>
                  <th scope="col" className="px-4 py-3 text-right">Gross profit</th>
                  <th scope="col" className="px-4 py-3">Cost coverage</th>
                  <th scope="col" className="px-4 py-3 text-right">Sales velocity</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredRows.map((row) => (
                  <tr key={row.metrics.key} className="align-top hover:bg-[var(--muted)]/50">
                    <td className="px-5 py-4"><p className="font-semibold text-[var(--foreground)]">{row.product?.name || 'Product'}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{row.product?.sku ? `${row.product.sku} · ` : ''}{row.metrics.baseUnit}</p></td>
                    <td className="px-4 py-4 text-[var(--foreground)]">{row.supplier?.name || row.metrics.supplierName}</td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums"><span className="block">{formatQuantity(row.metrics.receivedBaseUnits, row.metrics.baseUnit)}</span><span className="mt-1 block text-xs text-[var(--muted-foreground)]">{numberFormatter.format(row.metrics.receivedPurchaseUnits)} {pluralize(row.metrics.purchaseUnit)}</span></td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums">{formatQuantity(row.metrics.soldBaseUnits, row.metrics.baseUnit)}</td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums">{formatQuantity(row.metrics.remainingBaseUnits, row.metrics.baseUnit)}</td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums">{formatCurrency(row.metrics.salesRevenue)}</td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums">{formatCurrency(row.metrics.supplierCost)}</td>
                    <td className={`px-4 py-4 text-right font-mono font-semibold tabular-nums ${row.metrics.grossProfit < 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{formatCurrency(row.metrics.grossProfit)}</td>
                    <td className="px-4 py-4"><ProgressMeter value={row.metrics.costCoverage} label="recovered" /></td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums"><span className="block">{numberFormatter.format(row.dailyVelocity)} {row.metrics.baseUnit}/day</span><span className="mt-1 block text-xs text-[var(--muted-foreground)]">{velocityWindow}-day window</span></td>
                    <td className="px-4 py-4"><div className="flex min-w-[185px] flex-col items-start gap-1"><RecommendationBadge status={row.status} /><PaymentBadge status={row.paymentStatus} /></div></td>
                    <td className="px-5 py-4 text-right"><Button type="button" variant="outline" size="sm" icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setSelectedRow(row)}>View analysis</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3 text-xs leading-5 text-[var(--muted-foreground)] sm:px-6"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>These quantities come from consigned lots only. Store-owned stock is separate and is shown in View analysis when checking total saleable inventory.</span></div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm" aria-labelledby="supplier-payments-title">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6"><SectionHeading title="Supplier payments" description="Payments reduce supplier obligations only. They do not change sales revenue, cost of goods sold, or gross profit." action={<span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]"><CreditCard className="h-3.5 w-3.5" aria-hidden="true" />Supplier-level ledger</span>} /></div>
        {ledger.supplierBalances.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--muted-foreground)]">Supplier balances appear after consigned stock is received.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <caption className="sr-only">Supplier payables and payment status</caption>
              <thead className="bg-[var(--muted)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th scope="col" className="px-5 py-3">Supplier</th><th scope="col" className="px-4 py-3 text-right">Total received cost</th><th scope="col" className="px-4 py-3 text-right">Paid</th><th scope="col" className="px-4 py-3 text-right">Outstanding</th><th scope="col" className="px-4 py-3 text-right">Credit</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-5 py-3 text-right">Action</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {ledger.supplierBalances.filter((balance) => supplierFilter === 'all' || balance.supplier_id === supplierFilter).map((balance) => {
                  const paymentStatus = getPaymentStatus(balance);
                  return <tr key={`${balance.store_id}:${balance.supplier_id}`} className="hover:bg-[var(--muted)]/50"><td className="px-5 py-4 font-semibold text-[var(--foreground)]">{balance.supplier_name || 'Supplier'}</td><td className="px-4 py-4 text-right font-mono tabular-nums">{formatCurrency(toNumber(balance.amount_due))}</td><td className="px-4 py-4 text-right font-mono tabular-nums">{formatCurrency(toNumber(balance.amount_paid))}</td><td className="px-4 py-4 text-right font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-300">{formatCurrency(toNumber(balance.outstanding_balance))}</td><td className="px-4 py-4 text-right font-mono tabular-nums">{formatCurrency(toNumber(balance.supplier_credit))}</td><td className="px-4 py-4"><div className="flex flex-col items-start gap-1"><PaymentBadge status={paymentStatus} /><span className="text-xs text-[var(--muted-foreground)]">{paymentStatus.detail}</span></div></td><td className="px-5 py-4 text-right">{role === 'admin' && toNumber(balance.outstanding_balance) > 0 ? <Button type="button" variant="outline" size="sm" icon={<CreditCard className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => beginPayment(balance)}>Record payment</Button> : <span className="text-xs text-[var(--muted-foreground)]">No payment due</span>}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-[var(--border)] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-[var(--foreground)]">Recent supplier payments</h3><span className="text-xs text-[var(--muted-foreground)]">Showing the latest {ledger.payments.length}</span></div>
          {ledger.payments.length === 0 ? <p className="mt-3 text-sm text-[var(--muted-foreground)]">No supplier payments recorded yet.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-[var(--muted)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th scope="col" className="px-3 py-2.5">Date</th><th scope="col" className="px-3 py-2.5">Supplier</th><th scope="col" className="px-3 py-2.5 text-right">Amount</th><th scope="col" className="px-3 py-2.5">Reference / note</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{ledger.payments.slice(0, 8).map((payment) => <tr key={payment.id}><td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted-foreground)]">{formatDateTime(payment.paid_at)}</td><td className="px-3 py-2.5 font-medium text-[var(--foreground)]">{paymentSupplierName(payment)}</td><td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(toNumber(payment.amount))}</td><td className="px-3 py-2.5 text-[var(--muted-foreground)]">{payment.reference || payment.note || '—'}</td></tr>)}</tbody></table></div>}
        </div>
      </section>

      <ConsignmentAnalysisDialog row={selectedRow} ledger={ledger} scope={scope} velocityWindow={velocityWindow} reviewPeriodDays={Math.max(0, toNumber(reviewPeriodDays))} onClose={() => setSelectedRow(null)} />

      <Dialog open={Boolean(paymentTarget)} onOpenChange={(open) => { if (!open) setPaymentTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record supplier payment</DialogTitle><DialogDescription>Payments are posted against the supplier-level consignment balance and remain separate from product profitability.</DialogDescription></DialogHeader>
          {paymentTarget && <div className="space-y-4"><div className="rounded-lg bg-[var(--muted)] px-3 py-3"><p className="text-sm font-semibold text-[var(--foreground)]">{paymentTarget.supplier_name || 'Supplier'}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">Outstanding balance: <span className="font-mono font-semibold text-[var(--foreground)]">{formatCurrency(toNumber(paymentTarget.outstanding_balance))}</span></p></div><label className="block text-sm font-medium text-[var(--foreground)]">Amount<input id="consignment-payment-amount" type="number" min="0.01" max={toNumber(paymentTarget.outstanding_balance)} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="report-input mt-1.5" /></label><label className="block text-sm font-medium text-[var(--foreground)]">Reference (optional)<input id="consignment-payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="e.g. Receipt or transfer reference" className="report-input mt-1.5" /></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setPaymentTarget(null)}>Cancel</Button><Button type="button" variant="primary" loading={savingPayment} disabled={!paymentAmount} onClick={() => void submitPayment()}>Save payment</Button></div></div>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
