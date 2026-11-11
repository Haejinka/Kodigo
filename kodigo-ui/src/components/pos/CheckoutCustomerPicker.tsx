import { useEffect, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { searchCustomers } from '@/lib/customers';
import type { CustomerSummary } from '@/types/customers';

export interface PickedCustomer { id: string; name: string }

/** Optional: attach a tracked regular to this sale. Guest checkout stays the default. */
export function CheckoutCustomerPicker({ storeId, value, onChange, disabled }: {
  storeId: string; value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSummary[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    let current = true;
    const t = window.setTimeout(() => {
      searchCustomers(storeId, q, 6).then((r) => { if (current) setResults(r); }).catch(() => { if (current) setResults([]); });
    }, 250);
    return () => { current = false; window.clearTimeout(t); };
  }, [query, storeId]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
        <span className="flex items-center gap-2"><UserRound className="w-4 h-4" /> {value.name}</span>
        {!disabled && <button type="button" onClick={() => onChange(null)} aria-label="Remove customer"><X className="w-4 h-4" /></button>}
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        placeholder="Regular customer? Search name or phone (optional)"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                onClick={() => { onChange({ id: c.id, name: c.display_name }); setQuery(''); setResults([]); }}>
                {c.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
