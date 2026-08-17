import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Printer, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { StatCard } from '@/components/shared/StatCard';
import { formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useProductStore } from '@/stores/productStore';
import { useAlertStore } from '@/stores/alertStore';
import { useToast } from '@/components/shared/Toast';
import { supabase } from '@/lib/supabase';
import {
  buildInventoryReport,
  canAccessReports,
  describeSellingUnit,
  exportReportsWorkbook,
  fetchSalesReport,
  fetchStockMovementReport,
  getDateRangeForDays,
} from '@/lib/reporting';
import type {
  ReportFilters,
  SalesGroupReportRow,
  SalesReportData,
  StockMovementReportRow,
} from '@/lib/reporting';
import type { PaymentMethod, SaleStatus } from '@/types';

const paymentMethods: Array<PaymentMethod | 'all'> = ['all', 'cash', 'gcash', 'card', 'bank_transfer', 'other'];
const statuses: Array<SaleStatus | 'all'> = ['all', 'completed', 'partially_refunded', 'refunded', 'voided'];

const range = getDateRangeForDays(30);
const defaultFilters: ReportFilters = {
  ...range,
  paymentMethod: 'all',
  status: 'all',
};

export function ReportsPage() {
  const { toast } = useToast();
  const { activeStoreId, role } = useAuthStore();
  const { products } = useProductStore();
  const fetchNotifications = useAlertStore((s) => s.fetchNotifications);
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [report, setReport] = useState<SalesReportData | null>(null);
  const [stockMovements, setStockMovements] = useState<StockMovementReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canExport = canAccessReports(role);
  const inventoryOnly = role === 'inventory';

  const inventoryRows = useMemo(() => buildInventoryReport(products), [products]);
  const filteredInventoryRows = useMemo(() => {
    return inventoryRows.filter((row) => {
      if (filters.productId && row.productId !== filters.productId) return false;
      if (filters.categoryName && row.categoryName !== filters.categoryName) return false;
      if (filters.sellingUnitKey && row.sellingUnitKey !== filters.sellingUnitKey) return false;
      return true;
    });
  }, [filters.categoryName, filters.productId, filters.sellingUnitKey, inventoryRows]);

  const categoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const product of products) if (product.categoryName) names.add(product.categoryName);
    for (const row of report?.salesByCategory ?? []) names.add(row.label);
    return Array.from(names).sort();
  }, [products, report]);

  const unitOptions = useMemo(() => {
    const units = new Map<string, string>();
    for (const row of inventoryRows) units.set(row.sellingUnitKey, `${row.productName} - ${describeSellingUnit(row)}`);
    for (const row of report?.salesBySellingUnit ?? []) units.set(row.sellingUnitKey || row.key, `${row.productName || row.label} - ${describeSellingUnit(row)}`);
    return Array.from(units.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [inventoryRows, report]);

  const cashierOptions = useMemo(() => {
    return (report?.salesByCashier ?? [])
      .map((row) => [row.cashierId || '', row.cashierName] as const)
      .filter(([id]) => id)
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [report]);

  const loadReports = async () => {
    if (!activeStoreId) return;
    setLoading(true);
    try {
      if (inventoryOnly) {
        setReport(null);
        setStockMovements(await fetchStockMovementReport(filters, activeStoreId));
      } else {
        const [salesReport, movements] = await Promise.all([
          fetchSalesReport(filters, activeStoreId),
          fetchStockMovementReport(filters, activeStoreId),
        ]);
        setReport(salesReport);
        setStockMovements(movements);
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
      toast('error', err instanceof Error ? err.message : 'Failed to load reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, [activeStoreId, filters]);

  const updateFilter = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  };

  const handleExport = async () => {
    if (!canExport) {
      toast('error', 'Only authorized reporting roles can export reports.');
      return;
    }
    if (inventoryOnly) {
      const header = ['Product', 'Category', 'Unit', 'Stock', 'Low Stock Threshold', 'Status'];
      const rows = filteredInventoryRows.map((row) => [
        row.productName,
        row.categoryName,
        describeSellingUnit(row),
        row.stockQuantity,
        row.lowStockThreshold,
        row.stockStatus,
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Inventory-Report-${filters.startDate}-to-${filters.endDate}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast('success', 'Inventory report exported.');
      return;
    }
    if (!report) return;
    const fileName = `Kodigo-Reports-${report.filters.startDate}-to-${report.filters.endDate}.xlsx`;
    const storeId = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null;

    const recordReportNotification = async (status: 'completed' | 'failed', message?: string) => {
      const { error } = await supabase.rpc('record_report_export_notification', {
        p_store_id: storeId,
        p_status: status,
        p_file_name: fileName,
        p_error: message ?? null,
        p_filters: filters,
      });
      if (error) {
        console.error('Failed to record report export notification:', error);
        return;
      }
      void fetchNotifications();
    };

    setExporting(true);
    try {
      await exportReportsWorkbook({
        salesReport: report,
        inventoryRows: filteredInventoryRows,
        stockMovements,
        fileName,
      });
      await recordReportNotification('completed');
      toast('success', 'Excel report exported.');
    } catch (err) {
      console.error('Failed to export report:', err);
      const message = err instanceof Error ? err.message : 'Failed to export Excel report.';
      await recordReportNotification('failed', message);
      toast('error', message);
    } finally {
      setExporting(false);
    }
  };

  const summary = report?.summary;

  return (
    <div>
      <PageHeader
        title="Sales Reports"
        subtitle={loading ? 'Loading report data...' : inventoryOnly ? 'Inventory history and stock reports' : `${filters.startDate} to ${filters.endDate}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Printer className="w-4 h-4" />} onClick={() => window.print()}>
              Print
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={() => void loadReports()}
              loading={loading}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<FileSpreadsheet className="w-4 h-4" />}
              onClick={handleExport}
              loading={exporting}
              disabled={(!report && !inventoryOnly) || !canExport}
            >
              Export Excel
            </Button>
          </div>
        }
      />

      <div className="mb-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-card)] p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
          <FilterField label="Start">
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => updateFilter('startDate', event.target.value)}
              className="report-input"
            />
          </FilterField>
          <FilterField label="End">
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => updateFilter('endDate', event.target.value)}
              className="report-input"
            />
          </FilterField>
          <FilterField label="Product">
            <select value={filters.productId || ''} onChange={(event) => updateFilter('productId', event.target.value || undefined)} className="report-input">
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Category">
            <select value={filters.categoryName || ''} onChange={(event) => updateFilter('categoryName', event.target.value || undefined)} className="report-input">
              <option value="">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </FilterField>
          {!inventoryOnly && <FilterField label="Payment">
            <select value={filters.paymentMethod || 'all'} onChange={(event) => updateFilter('paymentMethod', event.target.value as PaymentMethod | 'all')} className="report-input">
              {paymentMethods.map((method) => (
                <option key={method} value={method}>{method === 'all' ? 'All methods' : method}</option>
              ))}
            </select>
          </FilterField>}
          {!inventoryOnly && <FilterField label="Cashier">
            <select value={filters.cashierId || ''} onChange={(event) => updateFilter('cashierId', event.target.value || undefined)} className="report-input">
              <option value="">All cashiers</option>
              {cashierOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </FilterField>}
          <FilterField label="Unit">
            <select value={filters.sellingUnitKey || ''} onChange={(event) => updateFilter('sellingUnitKey', event.target.value || undefined)} className="report-input">
              <option value="">All units</option>
              {unitOptions.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </FilterField>
          {!inventoryOnly && <FilterField label="Status">
            <select value={filters.status || 'all'} onChange={(event) => updateFilter('status', event.target.value as SaleStatus | 'all')} className="report-input">
              {statuses.map((status) => (
                <option key={status} value={status}>{status === 'all' ? 'All statuses' : status.replace('_', ' ')}</option>
              ))}
            </select>
          </FilterField>}
          <div className="flex items-end">
            <Button
              variant="secondary"
              icon={<Download className="w-4 h-4" />}
              onClick={handleExport}
              loading={exporting}
              disabled={(!report && !inventoryOnly) || !canExport}
              className="w-full"
            >
              XLSX
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {inventoryOnly ? (
          <>
            <StatCard label="Products" value={String(products.length)} change={0} icon={FileSpreadsheet} color="blue" />
            <StatCard label="Stock Units" value={String(filteredInventoryRows.reduce((sum, row) => sum + Number(row.stockQuantity), 0))} change={0} icon={FileSpreadsheet} color="green" />
            <StatCard label="Low / Out of Stock" value={String(filteredInventoryRows.filter((row) => row.stockStatus !== 'in-stock').length)} change={0} icon={FileSpreadsheet} color="amber" />
            <StatCard label="Movements" value={String(stockMovements.length)} change={0} icon={FileSpreadsheet} color="purple" />
          </>
        ) : (
          <>
            <StatCard label="Net Sales" value={formatCurrency(summary?.netSales ?? 0)} change={0} icon={FileSpreadsheet} color="blue" />
            <StatCard label="Transactions" value={String(summary?.totalTransactions ?? 0)} change={0} icon={FileSpreadsheet} color="green" />
            <StatCard label="Items Sold" value={String(summary?.netItemsSold ?? 0)} change={0} icon={FileSpreadsheet} color="amber" />
            <StatCard label="Gross Profit" value={formatCurrency(summary?.grossProfit ?? 0)} change={0} icon={FileSpreadsheet} color="purple" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {!inventoryOnly && <ReportSection title="Sales by Date">
          <SimpleTable
            headers={['Date', 'Transactions', 'Items', 'Net Sales', 'Profit']}
            rows={(report?.salesByDate ?? []).map((row) => [
              row.date,
              row.transactions,
              row.itemsSold,
              formatCurrency(row.netSales),
              formatCurrency(row.grossProfit),
            ])}
          />
        </ReportSection>}

        {!inventoryOnly && <ReportSection title="Product Sales">
          <ProductGroupTable rows={report?.salesByProduct ?? []} />
        </ReportSection>}

        {!inventoryOnly && <ReportSection title="Sales by Category">
          <ProductGroupTable rows={report?.salesByCategory ?? []} compact />
        </ReportSection>}

        {!inventoryOnly && <ReportSection title="Sales by Payment Method">
          <SimpleTable
            headers={['Method', 'Transactions', 'Captured', 'Refunds', 'Net']}
            rows={(report?.salesByPaymentMethod ?? []).map((row) => [
              row.method,
              row.transactions,
              formatCurrency(row.captured),
              formatCurrency(row.refunds),
              formatCurrency(row.net),
            ])}
          />
        </ReportSection>}

        {!inventoryOnly && <ReportSection title="Cashier Sales">
          <SimpleTable
            headers={['Cashier', 'Transactions', 'Items', 'Net Sales']}
            rows={(report?.salesByCashier ?? []).map((row) => [
              row.cashierName,
              row.transactions,
              row.itemsSold,
              formatCurrency(row.netSales),
            ])}
          />
        </ReportSection>}

        {!inventoryOnly && <ReportSection title="Rice Unit Sales">
          <ProductGroupTable rows={report?.riceUnitSales ?? []} />
        </ReportSection>}

        <ReportSection title="Inventory Report">
          <SimpleTable
            headers={['Product', 'Unit', 'Stock', 'Low Stock', 'Status']}
            rows={filteredInventoryRows.slice(0, 12).map((row) => [
              row.productName,
              describeSellingUnit(row),
              row.stockQuantity,
              row.lowStockThreshold,
              row.stockStatus,
            ])}
          />
        </ReportSection>

        <ReportSection title="Stock Movement Report">
          <SimpleTable
            headers={['Date', 'Product', 'Unit', 'Type', 'Change', 'After']}
            rows={stockMovements.slice(0, 12).map((row) => [
              new Date(row.dateTime).toLocaleString(),
              row.productName,
              describeSellingUnit(row),
              row.movementType,
              row.quantityDelta,
              row.stockAfter,
            ])}
          />
        </ReportSection>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-card)] p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function ProductGroupTable({ rows, compact = false }: { rows: SalesGroupReportRow[]; compact?: boolean }) {
  return (
    <SimpleTable
      headers={compact ? ['Group', 'Qty', 'Net Sales'] : ['Product', 'Unit', 'Qty', 'Net Sales', 'Profit']}
      rows={rows.slice(0, 12).map((row) => compact
        ? [row.label, row.netQuantity, formatCurrency(row.netRevenue)]
        : [
          row.productName || row.label,
          describeSellingUnit(row),
          row.netQuantity,
          formatCurrency(row.netRevenue),
          formatCurrency(row.grossProfit),
        ]
      )}
    />
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No matching records.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)]">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--app-border-subtle)]">
          {rows.map((row, index) => (
            <tr key={index} className="transition-colors hover:bg-[var(--app-surface-elevated)]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
