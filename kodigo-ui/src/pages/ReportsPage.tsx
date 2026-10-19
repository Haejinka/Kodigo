import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
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
  exportSalesReportPdf,
  exportReportsWorkbook,
  fetchPriceHistory,
  fetchRestockHistoryReport,
  fetchSalesReport,
  fetchStockMovementReport,
  formatSalesReportDate,
  getDefaultReportFilters,
  getSellingUnitFilterKey,
  getSellingUnitFilterLabel,
} from '@/lib/reporting';
import type { ReportFilters, SalesLineReportRow } from '@/lib/reporting';
import { getSalesReportBaseUnitPrice, getSalesReportPaidTotal } from '@/lib/reporting-calculations';
import type { SaleStatus } from '@/types';

const statuses: Array<SaleStatus | 'all'> = ['all', 'completed', 'partially_refunded', 'refunded'];
const pageSize = 25;
type ReportTab = 'sales' | 'inventory';

interface InventoryHistoryData {
  movements: Awaited<ReturnType<typeof fetchStockMovementReport>>;
  restocks: Awaited<ReturnType<typeof fetchRestockHistoryReport>>;
  prices: Awaited<ReturnType<typeof fetchPriceHistory>>;
}

function downloadCsv(fileName: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function salesCsvRows(lines: SalesLineReportRow[]) {
  return [
    ['Date', 'Product', 'Base Unit', 'Quantity', 'Unit Price', 'Amount Paid'],
    ...lines.map((line) => [
      formatSalesReportDate(line.dateTime),
      line.productName,
      line.baseUnitLabel,
      line.netBaseUnitQuantity,
      formatCurrency(getSalesReportBaseUnitPrice(line)),
      formatCurrency(line.amountPaid),
    ]),
    ['', '', '', '', 'Total Amount Paid:', formatCurrency(getSalesReportPaidTotal(lines))],
  ];
}

export function ReportsPage() {
  const { toast } = useToast();
  const { activeStoreId, role, user } = useAuthStore();
  const { products } = useProductStore();
  const fetchNotifications = useAlertStore((state) => state.fetchNotifications);
  const [tab, setTab] = useState<ReportTab>('sales');
  const [salesFilters, setSalesFilters] = useState<ReportFilters>(() => getDefaultReportFilters());
  const [inventoryFilters, setInventoryFilters] = useState<ReportFilters>(() => getDefaultReportFilters());
  const [page, setPage] = useState(1);
  const [exportingWorkbook, setExportingWorkbook] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const canExport = canAccessReports(role);
  const inventoryOnly = role === 'inventory';
  const currentTab: ReportTab = inventoryOnly ? 'inventory' : tab;

  const salesQuery = useQuery({
    queryKey: ['reporting', 'sales-list', user?.id ?? null, activeStoreId, salesFilters],
    enabled: Boolean(activeStoreId) && !inventoryOnly && currentTab === 'sales',
    queryFn: () => fetchSalesReport(salesFilters, activeStoreId),
  });
  const inventoryQuery = useQuery({
    queryKey: ['reporting', 'inventory-history', user?.id ?? null, activeStoreId, inventoryFilters],
    enabled: Boolean(activeStoreId) && currentTab === 'inventory',
    queryFn: async (): Promise<InventoryHistoryData> => {
      const [movements, restocks, prices] = await Promise.all([
        fetchStockMovementReport(inventoryFilters, activeStoreId),
        fetchRestockHistoryReport(inventoryFilters, activeStoreId),
        fetchPriceHistory(inventoryFilters, activeStoreId),
      ]);
      return { movements, restocks, prices };
    },
  });

  const report = salesQuery.data ?? null;
  const inventoryData = inventoryQuery.data;
  const loading = currentTab === 'sales' ? salesQuery.isFetching : inventoryQuery.isFetching;

  useEffect(() => {
    const error = currentTab === 'sales' ? salesQuery.error : inventoryQuery.error;
    if (!error) return;
    console.error('Failed to load reports:', error);
    toast('error', error instanceof Error ? error.message : 'Failed to load reports.');
  }, [currentTab, inventoryQuery.error, salesQuery.error, toast]);

  useEffect(() => setPage(1), [salesFilters]);

  const inventoryRows = useMemo(() => buildInventoryReport(products), [products]);
  const filteredInventoryRows = useMemo(() => inventoryRows.filter((row) => {
    if (inventoryFilters.productId && row.productId !== inventoryFilters.productId) return false;
    if (inventoryFilters.categoryName && row.categoryName !== inventoryFilters.categoryName) return false;
    if (inventoryFilters.sellingUnitKey && getSellingUnitFilterKey(row) !== inventoryFilters.sellingUnitKey) return false;
    return true;
  }), [inventoryFilters.categoryName, inventoryFilters.productId, inventoryFilters.sellingUnitKey, inventoryRows]);

  const categoryOptions = useMemo(() => Array.from(new Set(products.map((product) => product.categoryName).filter(Boolean))).sort(), [products]);
  const unitOptions = useMemo(() => {
    const units = new Map<string, string>();
    for (const row of inventoryRows) units.set(getSellingUnitFilterKey(row), getSellingUnitFilterLabel(row));
    return Array.from(units.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [inventoryRows]);

  const saleLines = report?.saleLines ?? [];
  const totalAmountPaid = getSalesReportPaidTotal(saleLines);
  const pageCount = Math.max(1, Math.ceil(saleLines.length / pageSize));
  const displayedPage = Math.min(page, pageCount);
  const visibleLines = saleLines.slice((displayedPage - 1) * pageSize, displayedPage * pageSize);

  const updateSalesFilter = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => {
    setSalesFilters((current) => {
      const next = { ...current, [key]: value || undefined };
      if (next.startDate > next.endDate) {
        if (key === 'startDate') next.endDate = next.startDate;
        else next.startDate = next.endDate;
      }
      return next;
    });
  };

  const updateInventoryFilter = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => {
    setInventoryFilters((current) => {
      const next = { ...current, [key]: value || undefined };
      if (next.startDate > next.endDate) {
        if (key === 'startDate') next.endDate = next.startDate;
        else next.startDate = next.endDate;
      }
      return next;
    });
  };

  const recordReportNotification = async (fileName: string, status: 'completed' | 'failed', filters: ReportFilters, message?: string) => {
    const storeId = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null;
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

  const handlePdfExport = async () => {
    if (!canExport || !report || loading) return;
    const fileName = `Kodigo-Sales-Report-${salesFilters.startDate}-to-${salesFilters.endDate}.pdf`;
    setExportingPdf(true);
    try {
      // The screen total and PDF are built from this same fully fetched line set.
      await exportSalesReportPdf(report, fileName);
      await recordReportNotification(fileName, 'completed', salesFilters);
      toast('success', 'Filtered sales report PDF exported.');
    } catch (error) {
      console.error('Failed to export PDF report:', error);
      const message = error instanceof Error ? error.message : 'Failed to export PDF report.';
      await recordReportNotification(fileName, 'failed', salesFilters, message);
      toast('error', message);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleCsvExport = async () => {
    if (!canExport || !report || loading) return;
    const fileName = `Kodigo-Sales-Report-${salesFilters.startDate}-to-${salesFilters.endDate}.csv`;
    try {
      downloadCsv(fileName, salesCsvRows(saleLines));
      await recordReportNotification(fileName, 'completed', salesFilters);
      toast('success', 'Filtered sales report CSV exported.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export CSV sales report.';
      await recordReportNotification(fileName, 'failed', salesFilters, message);
      toast('error', message);
    }
  };

  const handleWorkbookExport = async () => {
    if (!canExport || !activeStoreId) return;
    if (inventoryOnly) {
      const rows = [
        ['Product', 'Category', 'Unit', 'Stock', 'Low Stock Threshold', 'Status'],
        ...filteredInventoryRows.map((row) => [row.productName, row.categoryName, describeSellingUnit(row), row.stockQuantity, row.lowStockThreshold, row.stockStatus]),
      ];
      const fileName = `Inventory-Report-${inventoryFilters.startDate}-to-${inventoryFilters.endDate}.csv`;
      downloadCsv(fileName, rows);
      toast('success', 'Inventory report exported.');
      return;
    }
    setExportingWorkbook(true);
    const fileName = `Kodigo-Reports-${inventoryFilters.startDate}-to-${inventoryFilters.endDate}.xlsx`;
    try {
      const [salesReport, history] = await Promise.all([
        fetchSalesReport(salesFilters, activeStoreId),
        inventoryData ? Promise.resolve(inventoryData) : Promise.all([
          fetchStockMovementReport(inventoryFilters, activeStoreId),
          fetchRestockHistoryReport(inventoryFilters, activeStoreId),
          fetchPriceHistory(inventoryFilters, activeStoreId),
        ]).then(([movements, restocks, prices]) => ({ movements, restocks, prices })),
      ]);
      await exportReportsWorkbook({
        salesReport,
        inventoryRows: filteredInventoryRows,
        stockMovements: history.movements,
        restockRows: history.restocks,
        priceHistory: history.prices,
        fileName,
      });
      await recordReportNotification(fileName, 'completed', inventoryFilters);
      toast('success', 'Reports workbook exported.');
    } catch (error) {
      console.error('Failed to export reports workbook:', error);
      const message = error instanceof Error ? error.message : 'Failed to export reports workbook.';
      await recordReportNotification(fileName, 'failed', inventoryFilters, message);
      toast('error', message);
    } finally {
      setExportingWorkbook(false);
    }
  };

  const refresh = () => currentTab === 'sales' ? salesQuery.refetch() : inventoryQuery.refetch();

  return (
    <div>
      <PageHeader
        title={currentTab === 'sales' ? 'Sales Report' : 'Inventory & Stock Reports'}
        subtitle={loading ? 'Loading report data…' : currentTab === 'sales'
          ? `${salesFilters.startDate} to ${salesFilters.endDate}`
          : `${inventoryFilters.startDate} to ${inventoryFilters.endDate}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()} loading={loading}>
              Refresh
            </Button>
            {currentTab === 'sales' && !inventoryOnly && (
              <>
                <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void handleCsvExport()} disabled={!report || !canExport || loading}>
                  Export CSV
                </Button>
                <Button
                  variant="primary"
                  icon={<FileDown className="h-4 w-4" />}
                  onClick={() => void handlePdfExport()}
                  loading={exportingPdf}
                  disabled={!report || !canExport || loading}
                >
                  Export PDF
                </Button>
              </>
            )}
            {currentTab === 'inventory' && (
              <Button
                variant="primary"
                icon={<FileSpreadsheet className="h-4 w-4" />}
                onClick={() => void handleWorkbookExport()}
                loading={exportingWorkbook}
                disabled={!canExport || loading}
              >
                {inventoryOnly ? 'Export Inventory CSV' : 'Export Reports Workbook'}
              </Button>
            )}
          </div>
        )}
      />

      {!inventoryOnly && (
        <div className="mb-5 flex gap-2 border-b border-[var(--app-border)]" role="group" aria-label="Report type">
          <button type="button" aria-pressed={currentTab === 'sales'} onClick={() => setTab('sales')} className={`border-b-2 px-3 py-2 text-sm font-medium ${currentTab === 'sales' ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}>
            Sales Report
          </button>
          <button type="button" aria-pressed={currentTab === 'inventory'} onClick={() => setTab('inventory')} className={`border-b-2 px-3 py-2 text-sm font-medium ${currentTab === 'inventory' ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}>
            Inventory & Stock Reports
          </button>
        </div>
      )}

      {currentTab === 'sales' ? (
        <>
          <div className="mb-5 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-card)] p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FilterField label="Start date">
                <input type="date" value={salesFilters.startDate} max={salesFilters.endDate} onChange={(event) => updateSalesFilter('startDate', event.target.value)} className="report-input" />
              </FilterField>
              <FilterField label="End date">
                <input type="date" value={salesFilters.endDate} min={salesFilters.startDate} onChange={(event) => updateSalesFilter('endDate', event.target.value)} className="report-input" />
              </FilterField>
              <FilterField label="Product">
                <select value={salesFilters.productId || ''} onChange={(event) => updateSalesFilter('productId', event.target.value || undefined)} className="report-input">
                  <option value="">All products</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </FilterField>
              <FilterField label="Transaction status">
                <select value={salesFilters.status || 'all'} onChange={(event) => updateSalesFilter('status', event.target.value as SaleStatus | 'all')} className="report-input">
                  {statuses.map((status) => <option key={status} value={status}>{status === 'all' ? 'All valid sales' : status.replace('_', ' ')}</option>)}
                </select>
              </FilterField>
            </div>
          </div>

          {!activeStoreId ? (
            <ReportMessage>Choose a store to view its sales report.</ReportMessage>
          ) : salesQuery.error ? (
            <ReportMessage error>Could not load matching sales. Refresh to try again.</ReportMessage>
          ) : loading && !report ? (
            <ReportMessage>Loading filtered sales…</ReportMessage>
          ) : saleLines.length === 0 ? (
            <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-card)] px-5 py-10 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">No sales match these filters.</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Adjust the dates, product, or transaction status.</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => setSalesFilters(getDefaultReportFilters())}>Reset filters</Button>
            </div>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-card)] shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border-subtle)] px-4 py-3">
                <p className="text-sm text-[var(--muted-foreground)]">{saleLines.length.toLocaleString('en-PH')} matching product lines</p>
                <p className="text-xs text-[var(--muted-foreground)]">Historical prices and base-unit quantities</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="bg-[var(--app-surface-elevated)] text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3">Base Unit</th>
                      <th className="px-4 py-3 text-right">Quantity</th>
                      <th className="px-4 py-3 text-right">Unit Price</th>
                      <th className="px-4 py-3 text-right">Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--app-border-subtle)]">
                    {visibleLines.map((line) => (
                      <tr key={line.saleItemId} className="hover:bg-[var(--app-surface-elevated)]">
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--foreground)]">{formatSalesReportDate(line.dateTime)}</td>
                        <td className="max-w-[24rem] whitespace-normal break-words px-4 py-3 font-medium text-[var(--foreground)]">{line.productName}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--muted-foreground)]">{line.baseUnitLabel}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{Number(line.netBaseUnitQuantity).toLocaleString('en-PH', { maximumFractionDigits: 3 })}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(getSalesReportBaseUnitPrice(line))}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium tabular-nums">{formatCurrency(line.amountPaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--app-border)] bg-[var(--app-surface-elevated)] font-semibold text-[var(--foreground)]">
                      <td colSpan={5} className="px-4 py-3 text-right">Total Amount Paid:</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(totalAmountPaid)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border-subtle)] px-4 py-3">
                <p className="text-xs text-[var(--muted-foreground)]">Page {displayedPage} of {pageCount} · total covers all matching rows</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" disabled={displayedPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
                  <Button type="button" size="sm" variant="secondary" disabled={displayedPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button>
                </div>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="mb-5 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-card)] p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <FilterField label="Start date">
                <input type="date" value={inventoryFilters.startDate} max={inventoryFilters.endDate} onChange={(event) => updateInventoryFilter('startDate', event.target.value)} className="report-input" />
              </FilterField>
              <FilterField label="End date">
                <input type="date" value={inventoryFilters.endDate} min={inventoryFilters.startDate} onChange={(event) => updateInventoryFilter('endDate', event.target.value)} className="report-input" />
              </FilterField>
              <FilterField label="Product">
                <select value={inventoryFilters.productId || ''} onChange={(event) => updateInventoryFilter('productId', event.target.value || undefined)} className="report-input">
                  <option value="">All products</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </FilterField>
              <FilterField label="Category">
                <select value={inventoryFilters.categoryName || ''} onChange={(event) => updateInventoryFilter('categoryName', event.target.value || undefined)} className="report-input">
                  <option value="">All categories</option>
                  {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </FilterField>
              <FilterField label="Unit">
                <select value={inventoryFilters.sellingUnitKey || ''} onChange={(event) => updateInventoryFilter('sellingUnitKey', event.target.value || undefined)} className="report-input">
                  <option value="">All units</option>
                  {unitOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </FilterField>
            </div>
          </div>

          {!activeStoreId ? (
            <ReportMessage>Choose a store to view its inventory reports.</ReportMessage>
          ) : inventoryQuery.error ? (
            <ReportMessage error>Could not load inventory history. Refresh to try again.</ReportMessage>
          ) : loading && !inventoryData ? (
            <ReportMessage>Loading inventory history…</ReportMessage>
          ) : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <ReportSection title="Inventory Report">
                <SimpleTable
                  headers={['Product', 'Unit', 'Stock', 'Low Stock', 'Status']}
                  rows={filteredInventoryRows.map((row) => [row.productName, describeSellingUnit(row), row.stockQuantity, row.lowStockThreshold, row.stockStatus])}
                />
              </ReportSection>
              <ReportSection title="Stock Movement Report">
                <SimpleTable
                  headers={['Date', 'Product', 'Base Unit', 'Type', 'Base Units Changed', 'Base Units After']}
                  rows={(inventoryData?.movements ?? []).map((row) => [new Date(row.dateTime).toLocaleString('en-PH'), row.productName, row.unitLabel, row.movementType, row.quantityDelta, row.stockAfter])}
                />
              </ReportSection>
              <ReportSection title="Restocking History">
                <SimpleTable
                  headers={['Date', 'Product', 'Received as', 'Base Units', 'Supplier Cost', 'Cost / Unit', 'New Cost / Base']}
                  rows={(inventoryData?.restocks ?? []).map((row) => [new Date(row.dateTime).toLocaleString('en-PH'), row.productName, `${row.quantityReceived} ${row.restockingUnit}`, row.baseUnitsAdded, formatCurrency(row.totalSupplierCost), formatCurrency(row.supplierCostPerUnit), formatCurrency(row.newCostPerBaseUnit)])}
                />
              </ReportSection>
              <ReportSection title="Price History">
                <SimpleTable
                  headers={['Date', 'Product', 'Type', 'Previous', 'New', 'Reason']}
                  rows={(inventoryData?.prices ?? []).map((row) => [new Date(row.createdAt).toLocaleString('en-PH'), row.productName, row.changeType === 'supplier_cost' ? 'Supplier cost' : 'Selling price', formatCurrency(row.previousValue), formatCurrency(row.newValue), row.reason])}
                />
              </ReportSection>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-card)] p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-[var(--foreground)]">{title}</h2>
      {children}
    </section>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No matching records.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)]">
            {headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--app-border-subtle)]">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-[var(--app-surface-elevated)]">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-3 py-2 text-[var(--foreground)]">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportMessage({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : undefined} className={`rounded-xl border px-5 py-10 text-center text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-[var(--app-border)] bg-[var(--app-surface-card)] text-[var(--muted-foreground)]'}`}>{children}</div>;
}
