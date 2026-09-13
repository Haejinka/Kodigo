import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    }
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 text-green-600" />,
    error: <XCircle className="w-4 h-4 text-red-600" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-600" />,
    info: <Info className="w-4 h-4 text-blue-600" />,
  };

  const bgColors: Record<ToastType, string> = {
    success: 'border-green-200 bg-green-50',
    error: 'border-red-200 bg-red-50',
    warning: 'border-amber-200 bg-amber-50',
    info: 'border-blue-200 bg-blue-50',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={cn('flex items-start gap-3 rounded-xl border bg-[var(--card)] px-4 py-3 shadow-lg pointer-events-auto', bgColors[t.type])}
          >
            <span className="mt-0.5">{icons[t.type]}</span>
            <p className="text-sm font-medium text-gray-800 flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded p-1 text-gray-500 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
