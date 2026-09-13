import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  toolbar?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  emptyTitle = 'No data found',
  emptyDescription,
  rowKey,
  onRowClick,
  pageSize = 15,
  toolbar,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const sorted = sortKey
    ? [...data].sort((left, right) => {
      const column = columns.find((candidate) => candidate.key === sortKey);
      if (!column?.sortValue) return 0;
      const leftValue = column.sortValue(left);
      const rightValue = column.sortValue(right);
      const result = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue));
      return sortDir === 'asc' ? result : -result;
    })
    : data;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Card className="overflow-hidden">
      {toolbar && <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">{toolbar}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]/60">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortable && sortKey === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : column.sortable ? 'none' : undefined}
                  className={cn(
                    'px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] whitespace-nowrap',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.width,
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column.key)}
                      className="inline-flex min-h-7 items-center gap-1 rounded px-1 text-start transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      {column.header}
                      {sortKey === column.key ? (
                        sortDir === 'asc' ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  ) : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]/70">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-16">
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              paged.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(event) => {
                    if (!onRowClick || (event.target instanceof HTMLElement && event.target.closest('button,a,input,select,textarea'))) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(
                    'transition-colors hover:bg-[var(--muted)]/60',
                    onRowClick && 'cursor-pointer focus-visible:bg-[var(--muted)] focus-visible:outline-none',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-4 py-3 text-[var(--foreground)]',
                        column.align === 'right' && 'text-right',
                        column.align === 'center' && 'text-center',
                      )}
                    >
                      {column.accessor(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && sorted.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
              aria-label="Previous page"
              className="inline-flex size-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span className="px-2 text-xs text-[var(--muted-foreground)]" aria-live="polite">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage((current) => current + 1)}
              aria-label="Next page"
              className="inline-flex size-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
