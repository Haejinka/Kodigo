import { Search, X } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showBarcodeIcon?: boolean;
  className?: string;
  autoFocus?: boolean;
  id?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function SearchInput({ value, onChange, placeholder = 'Search...', className, autoFocus, id, onKeyDown }: SearchInputProps) {
  const [internal, setInternal] = useState(value ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync with external value changes (e.g. forced clearing from parent)
  useEffect(() => {
    if (value !== undefined && value !== internal) {
      setInternal(value);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInternal(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(val.trim()), 250);
  };

  const handleClear = () => {
    setInternal('');
    onChange('');
  };

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
      <input
        id={id}
        type="text"
        value={internal}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400"
      />
      {internal && (
        <button onClick={handleClear} className="absolute right-3 p-0.5 rounded hover:bg-gray-100">
          <X className="w-3.5 h-3.5 text-gray-400" />
        </button>
      )}
    </div>
  );
}
