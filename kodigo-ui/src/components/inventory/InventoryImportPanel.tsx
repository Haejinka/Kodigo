import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import { Button } from '@/components/shared/Button';
import type { Category, Product } from '@/types';

export interface InventoryImportRow {
  name: string;
  sku: string;
  barcode?: string;
  categoryName: string;
  categoryId: string;
  unit: string;
  purchaseUnit: string;
  conversionFactor: number;
  purchaseQuantity: number;
  totalPurchasePrice: number;
  currentStock: number;
  costPrice: number;
  sellingPrice: number;
  minStockLevel: number;
  safetyStock: number;
  reorderLevel: number;
  leadTimeDays: number;
}

interface PreviewRow {
  rowNumber: number;
  values: InventoryImportRow;
  errors: string[];
}

interface InventoryImportPanelProps {
  storeId: string | null;
  categories: Category[];
  products: Product[];
  onCreateCategory: (name: string) => Promise<Category>;
  onImport: (row: InventoryImportRow) => Promise<void>;
  onClose: () => void;
}

const columns = [
  'Product Name *',
  'SKU *',
  'Barcode',
  'Category *',
  'Base Unit *',
  'Purchase Unit *',
  'Base Units per Purchase Unit *',
  'Quantity Purchased *',
  'Total Purchase Price (PHP) *',
  'Selling Price per Base Unit *',
  'Low Stock Alert',
  'Safety Stock',
  'Reorder Level',
  'Lead Time Days',
];

const headerKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s*\*$/, '');
const numericValue = (value: unknown, fallback?: number) => {
  if (value == null || String(value).trim() === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function InventoryImportPanel({ storeId, categories, products, onCreateCategory, onImport, onClose }: InventoryImportPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null);

  const downloadTemplate = async () => {
    const instructionRows = [
      ['Inventory import template'],
      ['Fill the Products sheet. Keep the first row and column headers unchanged.'],
      ['Each data row creates a new product with its starting stock. Existing products are never overwritten.'],
      ['Required fields are marked with *. Use plain numbers for purchase quantities and prices.'],
      ['New category names in the Category column are created in the selected store during import.'],
      ['Base Unit is what customers buy, such as piece, bottle, or kg. Purchase Unit is how the vendor sells it, such as tie, tray, or sack.'],
      ['Enter the number of base units inside one purchase unit and how many purchase units were bought.'],
      ['Starting stock and cost per base unit are calculated from package quantity, units per package, and total purchase price.'],
      ['Leave optional stock thresholds blank to use 0. Lead Time Days defaults to 1.'],
      ['Existing SKUs in this store and duplicate SKUs in this file will be skipped.'],
      ['Categories available in this store:'],
      ...(categories.length > 0 ? categories.map((category) => [category.name]) : [['No categories found. Create a category before importing.']]),
    ];
    const workbook = await writeXlsxFile([
      { sheet: 'Products', data: [columns], stickyRowsCount: 1, columns: columns.map(() => ({ width: 24 })) },
      { sheet: 'Instructions', data: instructionRows, columns: [{ width: 105 }] },
    ]);
    const url = URL.createObjectURL(await workbook.toBlob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'inventory-import-template.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const parseFile = async (file: File) => {
    setReading(true);
    setPreview([]);
    setImportResult(null);
    setParseError('');
    setFileName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Choose an .xlsx workbook.');
      const sheets = await readXlsxFile(file);
      const rows = sheets[0]?.data as unknown as Array<Array<unknown>> | undefined;
      if (!rows || rows.length < 2) throw new Error('The Products sheet has no product rows.');
      const headerIndexes = new Map<string, number>(rows[0].map((heading, index) => [headerKey(heading), index]));
      const requiredHeaders = ['product name', 'sku', 'category', 'base unit', 'purchase unit', 'base units per purchase unit', 'quantity purchased', 'total purchase price (php)', 'selling price per base unit'];
      const missingHeaders = requiredHeaders.filter((header) => !headerIndexes.has(header));
      if (missingHeaders.length > 0) throw new Error(`Missing required template columns: ${missingHeaders.join(', ')}.`);

      const existingSkus = new Set(products.map((product) => product.sku.trim().toLowerCase()));
      const importedSkus = new Set<string>();
      const categoryByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category]));
      const valueAt = (row: unknown[], heading: string) => {
        const index = headerIndexes.get(heading);
        return index === undefined ? undefined : row[index];
      };
      const parsedRows: PreviewRow[] = rows.slice(1).flatMap((row, index) => {
        if (row.every((cell) => cell == null || String(cell).trim() === '')) return [];
        const errors: string[] = [];
        const name = String(valueAt(row, 'product name') ?? '').trim();
        const sku = String(valueAt(row, 'sku') ?? '').trim();
        const categoryName = String(valueAt(row, 'category') ?? '').trim();
        const unit = String(valueAt(row, 'base unit') ?? '').trim().toLowerCase();
        const barcode = String(valueAt(row, 'barcode') ?? '').trim();
        const purchaseUnit = String(valueAt(row, 'purchase unit') ?? '').trim().toLowerCase();
        const unitsPerPurchaseUnit = numericValue(valueAt(row, 'base units per purchase unit'));
        const purchaseQuantity = numericValue(valueAt(row, 'quantity purchased'));
        const totalPurchasePrice = numericValue(valueAt(row, 'total purchase price (php)'));
        const sellingPrice = numericValue(valueAt(row, 'selling price per base unit'));
        const minStock = numericValue(valueAt(row, 'low stock alert'), 0);
        const safetyStock = numericValue(valueAt(row, 'safety stock'), 0);
        const reorderLevel = numericValue(valueAt(row, 'reorder level'), 0);
        const leadTime = numericValue(valueAt(row, 'lead time days'), 1);
        const category = categoryByName.get(categoryName.toLowerCase());
        const baseStock = unitsPerPurchaseUnit !== undefined && purchaseQuantity !== undefined
          ? unitsPerPurchaseUnit * purchaseQuantity
          : undefined;
        const cost = baseStock && totalPurchasePrice !== undefined ? totalPurchasePrice / baseStock : totalPurchasePrice === 0 ? 0 : undefined;

        if (!name) errors.push('Product name is required.');
        if (!sku) errors.push('SKU is required.');
        else if (existingSkus.has(sku.toLowerCase())) errors.push('This SKU already exists in the selected store.');
        else if (importedSkus.has(sku.toLowerCase())) errors.push('This SKU is duplicated in the workbook.');
        else importedSkus.add(sku.toLowerCase());
        if (!categoryName) errors.push('Category is required.');
        if (!unit) errors.push('Base unit is required.');
        if (!purchaseUnit) errors.push('Purchase unit is required.');
        if (unitsPerPurchaseUnit === undefined || unitsPerPurchaseUnit < 1 || !Number.isInteger(unitsPerPurchaseUnit)) errors.push('Base units per purchase unit must be a whole number of at least 1.');
        if (purchaseQuantity === undefined || purchaseQuantity < 0 || !Number.isInteger(purchaseQuantity)) errors.push('Quantity purchased must be a whole number at least 0.');
        if (totalPurchasePrice === undefined || totalPurchasePrice < 0) errors.push('Total purchase price must be a number at least 0.');
        if (baseStock === undefined || !Number.isSafeInteger(baseStock)) errors.push('Calculated starting stock must be a whole number.');
        if (cost === undefined || !Number.isFinite(cost) || cost < 0) errors.push('Cost per base unit cannot be calculated from these purchase details.');
        if (sellingPrice === undefined || sellingPrice < 0) errors.push('Selling price per base unit must be a number at least 0.');
        for (const [label, value] of [['Low stock alert', minStock], ['Safety stock', safetyStock], ['Reorder level', reorderLevel]] as const) {
          if (value === undefined || value < 0) errors.push(`${label} must be a number at least 0.`);
        }
        if (leadTime === undefined || leadTime < 1 || !Number.isInteger(leadTime)) errors.push('Lead time must be a whole number of at least 1 day.');

        return [{
          rowNumber: index + 2,
          errors,
          values: {
            name,
            sku,
            barcode: barcode || undefined,
            categoryName,
            categoryId: category?.id ?? '',
            unit,
            purchaseUnit,
            conversionFactor: unitsPerPurchaseUnit ?? 1,
            purchaseQuantity: purchaseQuantity ?? 0,
            totalPurchasePrice: totalPurchasePrice ?? 0,
            currentStock: baseStock ?? 0,
            costPrice: cost ?? 0,
            sellingPrice: sellingPrice ?? 0,
            minStockLevel: minStock ?? 0,
            safetyStock: safetyStock ?? 0,
            reorderLevel: reorderLevel ?? 0,
            leadTimeDays: leadTime ?? 1,
          },
        }];
      });
      if (parsedRows.length === 0) throw new Error('The Products sheet has no product rows.');
      setPreview(parsedRows);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Could not read this workbook. Download a fresh template and try again.');
    } finally {
      setReading(false);
    }
  };

  const validCount = preview.filter((row) => row.errors.length === 0).length;
  const invalidCount = preview.length - validCount;

  const importValidRows = async () => {
    if (!storeId || validCount === 0) return;
    setImporting(true);
    const errors: string[] = [];
    let imported = 0;
    const validRows = preview.filter((item) => item.errors.length === 0);
    const categoryIds = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id]));
    setImportProgress({ done: 0, total: validRows.length });
    for (const [index, row] of validRows.entries()) {
      try {
        let categoryId = row.values.categoryId || categoryIds.get(row.values.categoryName.toLowerCase());
        if (!categoryId) {
          const category = await onCreateCategory(row.values.categoryName);
          categoryId = category.id;
          categoryIds.set(row.values.categoryName.toLowerCase(), categoryId);
        }
        await onImport({ ...row.values, categoryId });
        imported += 1;
      } catch (error) {
        errors.push(`Row ${row.rowNumber} (${row.values.name}): ${error instanceof Error ? error.message : 'Import failed.'}`);
      }
      setImportProgress({ done: index + 1, total: validRows.length });
    }
    setImportResult({ imported, errors });
    setImportProgress(null);
    setImporting(false);
  };

  return (
    <section className="mb-4 rounded-xl border border-blue-200 bg-[var(--card)] p-4 shadow-sm" aria-label="Import inventory from Excel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-green-50 p-2 text-green-700"><FileSpreadsheet className="size-5" /></span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Import inventory from Excel</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted-foreground)]">Download the template, fill one product per row, then upload it here. New category names in the file are created automatically. Existing products are never overwritten.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]" aria-label="Close import panel"><X className="size-4" /></button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void downloadTemplate()}>
          <Download className="mr-1.5 size-4" />Download .xlsx template
        </Button>
        <Button variant="primary" size="sm" disabled={!storeId || reading || importing} onClick={() => fileInput.current?.click()}>
          <Upload className="mr-1.5 size-4" />Choose completed workbook
        </Button>
        <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void parseFile(file);
        }} />
        {fileName && <span className="text-xs text-[var(--muted-foreground)]">{fileName}</span>}
      </div>
      {!storeId && <p className="mt-2 text-xs text-amber-700">Select one store in the main store switch before importing.</p>}
      {parseError && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-700"><AlertCircle className="size-4 shrink-0" />{parseError}</p>}
      {reading && <p className="mt-3 text-sm text-[var(--muted-foreground)]">Reading workbook…</p>}
      {importProgress && <p role="status" className="mt-3 text-sm text-blue-700">Importing product {importProgress.done} of {importProgress.total}…</p>}

      {preview.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold text-[var(--foreground)]">Preview: {preview.length} rows</span>
            <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="size-4" />{validCount} ready</span>
            {invalidCount > 0 && <span className="inline-flex items-center gap-1 text-red-700"><AlertCircle className="size-4" />{invalidCount} need correction</span>}
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 bg-[var(--muted)] text-[var(--muted-foreground)]"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Stock</th><th className="px-3 py-2">Cost / unit</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {preview.map((row) => <tr key={row.rowNumber} className={row.errors.length ? 'bg-red-50/70' : ''}>
                  <td className="px-3 py-2">{row.rowNumber}</td><td className="px-3 py-2 font-medium">{row.values.name || '—'}</td><td className="px-3 py-2 font-mono">{row.values.sku || '—'}</td><td className="px-3 py-2">{row.values.currentStock}</td><td className="px-3 py-2">{row.values.costPrice.toFixed(2)}</td>
                  <td className="px-3 py-2">{row.errors.length ? <span className="text-red-700">{row.errors.join(' ')}</span> : <span className="text-green-700">{row.values.categoryId ? 'Ready' : `Ready · creates “${row.values.categoryName}” category`}</span>}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--muted-foreground)]">Only valid rows will be imported. Invalid rows are skipped.</p>
            <Button variant="primary" size="sm" loading={importing} disabled={!storeId || validCount === 0 || importing} onClick={() => void importValidRows()}>
              Import {validCount} product{validCount === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}

      {importResult && <div role="status" className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm">
        <p className="font-medium">Imported {importResult.imported} product{importResult.imported === 1 ? '' : 's'}.</p>
        {importResult.errors.length > 0 && <ul className="mt-1 list-inside list-disc text-xs text-red-700">{importResult.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      </div>}
    </section>
  );
}
