import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Store, Hash, LogOut } from 'lucide-react';
import { ProductSearchPanel } from '@/components/pos/ProductSearchPanel';
import { Cart } from '@/components/pos/Cart';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import type { Product } from '@/types';

function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function POSPage() {
  const { addItem } = useCartStore();
  const { user, logout, activeStoreId, stores } = useAuthStore();
  const activeStoreName = stores.find(s => s.id === activeStoreId)?.name || 'Unknown Store';
  const navigate = useNavigate();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const clock = useClock();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  // ── Pending quantity (keyboard number pre-entry) ───────────────────────────
  const [pendingQtyStr, setPendingQtyStr] = useState('');
  const pendingQtyRef = useRef(''); // Ref for synchronous updates to prevent closure staleness
  const pendingQty = Math.max(1, parseInt(pendingQtyStr) || 1);

  const resetPendingQty = useCallback(() => {
    pendingQtyRef.current = '';
    setPendingQtyStr('');
  }, []);

  const handleScanStart = useCallback(() => {
    // When a rapid scanner sequence starts, exactly one character will have leaked
    // into the global keydown listener before the event was cancelled.
    // We strictly pop off the last character added to preserve the multiplier.
    pendingQtyRef.current = pendingQtyRef.current.slice(0, -1);
    setPendingQtyStr(pendingQtyRef.current);
  }, []);

  // Capture digit keypresses anywhere on the POS (when not focused in an input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Keyboard shortcuts that work regardless of focus
      if (e.key === 'F9') {
        e.preventDefault();
        const items = useCartStore.getState().items;
        if (items.length > 0 && !paymentOpen) {
          setPaymentOpen(true);
        }
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        document.getElementById('pos-search')?.focus();
        return;
      }

      // Don't capture if focus is inside an input, textarea, select
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Don't fire on modifier combos
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key >= '0' && e.key <= '9') {
        const next = pendingQtyRef.current + e.key;
        if (parseInt(next) <= 999) {
          pendingQtyRef.current = next;
          setPendingQtyStr(next);
        }
        return;
      }
      if (e.key === 'Backspace') {
        pendingQtyRef.current = pendingQtyRef.current.slice(0, -1);
        setPendingQtyStr(pendingQtyRef.current);
        return;
      }
      if (e.key === 'Escape') {
        pendingQtyRef.current = '';
        setPendingQtyStr('');
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paymentOpen]);

  const handleAddProduct = (product: Product) => {
    // Read the safe value from the synchronous ref directly in the event this is called
    // fast due to a barcode scan ending, avoiding stale state issues.
    const safeQty = Math.max(1, parseInt(pendingQtyRef.current) || 1);
    addItem(product, safeQty);
    resetPendingQty();
  };

  if (activeStoreId === 'all') {
    return (
      <div className="flex flex-col h-screen items-center justify-center p-6 bg-gray-50 text-center">
        <Store className="w-16 h-16 text-gray-400 mb-6" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Select a Specific Store</h2>
        <p className="text-gray-500 max-w-md mx-auto mb-8">
          The POS terminal requires a specific store to process transactions correctly. 
          Please use the navigation menu or dashboard to select your active branch.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* POS Topbar */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5 text-blue-600" />
          <span className="font-bold text-gray-900 text-sm">KodiGo POS</span>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <span className="text-sm font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">
          {activeStoreName}
        </span>
        <div className="w-px h-5 bg-gray-200" />
        <span className="text-sm text-gray-500">
          Cashier: <span className="font-medium text-gray-800">{user?.name ?? '—'}</span>
        </span>
        <div className="flex-1" />

        {/* Qty multiplier indicator in topbar */}
        {pendingQtyStr && (
          <div className="flex items-center gap-1.5 bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-semibold animate-pulse">
            <Hash className="w-3.5 h-3.5" />
            <span className="font-mono">{pendingQtyStr}</span>
            <span className="opacity-70 text-xs font-normal ml-0.5">pending</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-sm font-mono font-medium text-gray-700">
          <Clock className="w-4 h-4 text-gray-400" />
          {clock}
        </div>

        <div className="w-px h-5 bg-gray-200" />

        <button
          onClick={() => setLogoutOpen(true)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </header>

      {/* Main Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Product Search Panel */}
        <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden">
          <ProductSearchPanel
            onAddProduct={handleAddProduct}
            pendingQty={pendingQty}
            pendingQtyStr={pendingQtyStr}
            onResetQty={resetPendingQty}
            onScanStart={handleScanStart}
          />
        </div>

        {/* Right: Cart */}
        <div className="w-80 xl:w-96 shrink-0 flex flex-col bg-white overflow-hidden">
          <Cart onCharge={() => setPaymentOpen(true)} />
        </div>
      </div>

      {/* Payment Modal */}
      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSuccess={() => setPaymentOpen(false)}
      />

      {/* Logout Confirm */}
      <ConfirmDialog
        open={logoutOpen}
        title="Log out of POS?"
        description="Any unsaved cart items will be lost. Make sure all transactions are complete before logging out."
        confirmLabel="Log Out"
        danger
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />
    </div>
  );
}
