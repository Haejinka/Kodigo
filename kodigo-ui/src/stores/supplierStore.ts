import { create } from 'zustand';
import type { Supplier, PurchaseOrder, Product } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useProductStore } from '@/stores/productStore';
import { executeOrQueueMutation } from '@/lib/offline-sync';

export type SupplierFormData = Omit<
  Supplier,
  'id' | 'overallScore' | 'reliabilityScore' | 'priceScore' | 'totalOrders' | 'onTimeDeliveries' | 'createdAt'
>;

interface SupplierStore {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  isLoading: boolean;

  fetchSuppliers: () => Promise<void>;
  fetchPurchaseOrders: () => Promise<void>;

  addSupplier: (data: SupplierFormData) => Promise<Supplier | undefined>;
  updateSupplier: (id: string, data: SupplierFormData) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;

  createPurchaseOrder: (
    storeId: string,
    supplierId: string,
    supplierName: string,
    items: PurchaseOrder['items'],
  ) => Promise<PurchaseOrder | undefined>;
  receivePurchaseOrder: (poId: string, onTime: boolean, products: Product[]) => Promise<void>;
  cancelPurchaseOrder: (poId: string) => Promise<void>;
  recalculatePriceScores: (products: Product[]) => void;
}

export const useSupplierStore = create<SupplierStore>((set, get) => ({
  suppliers: [],
  purchaseOrders: [],
  isLoading: false,

  fetchSuppliers: async () => {
    const storeId = useAuthStore.getState().activeStoreId;

    set({ isLoading: true });
    try {
      if (!navigator.onLine) throw new Error("Offline mode: cannot fetch initial suppliers");
      let query = supabase.from('suppliers').select('*');
      // If a specific store is selected, scope to it. Otherwise fetch globally.
      if (storeId && storeId !== 'all') {
        query = query.eq('store_id', storeId);
      }
      const { data, error } = await query;
      if (error) throw error;

      const mapped: Supplier[] = (data || []).map(s => ({
        id: s.id,
        storeId: s.store_id,
        name: s.name,
        contact: s.contact,
        email: s.email,
        phone: s.phone,
        address: s.address,
        leadTimeDays: s.lead_time_days,
        reliabilityScore: s.reliability_score || 0,
        priceScore: s.price_score || 0,
        overallScore: s.overall_score || 0,
        totalOrders: s.total_orders || 0,
        onTimeDeliveries: s.on_time_deliveries || 0,
        createdAt: s.created_at,
      }));

      set({ suppliers: mapped, isLoading: false });
    } catch (err) {
      console.warn("Using previously cached suppliers (cache mechanism TBD)", err);
      set({ isLoading: false });
    }
  },

  fetchPurchaseOrders: async () => {
    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId) return;

    try {
      if (!navigator.onLine) return;
      let query = supabase.from('purchase_orders').select(`
        *,
        purchase_order_items (*)
      `).order('created_at', { ascending: false });
      
      if (storeId !== 'all') {
        query = query.eq('store_id', storeId);
      }
      
      const { data, error } = await query;
      if (error) throw error;

      const mapped: PurchaseOrder[] = (data || []).map(po => ({
        id: po.id,
        storeId: po.store_id,
        supplierId: po.supplier_id,
        supplierName: po.supplier_name,
        status: po.status,
        onTime: po.on_time ?? undefined,
        total: po.total,
        receivedAt: po.received_at,
        createdAt: po.created_at,
        items: po.purchase_order_items.map((i: any) => ({
          productId: i.product_id,
          productName: i.product_name,
          quantity: i.quantity,
          unitCost: i.unit_cost,
        })),
      }));

      set({ purchaseOrders: mapped });
    } catch (err) {
      console.error(err);
    }
  },

  addSupplier: async (data) => {
    const storeId = data.storeId || useAuthStore.getState().activeStoreId;
    if (storeId === 'all') {
       console.warn("Please select a specific store first.");
       return undefined;
    }
    if (!storeId) return undefined;

    const newId = crypto.randomUUID();
    const newSupplier = {
      id: newId,
      store_id: storeId,
      name: data.name,
      contact: data.contact,
      email: data.email,
      phone: data.phone,
      address: data.address,
      lead_time_days: data.leadTimeDays,
    };

    const optimistic: Supplier = {
      ...data,
      id: newId,
      storeId,
      reliabilityScore: 100,
      priceScore: 50,
      overallScore: 80,
      totalOrders: 0,
      onTimeDeliveries: 0,
      createdAt: new Date().toISOString()
    };

    const currentActiveStore = useAuthStore.getState().activeStoreId;
    if (currentActiveStore === 'all' || currentActiveStore === storeId) {
      set(s => ({ suppliers: [...s.suppliers, optimistic] }));
    }

    try {
      await executeOrQueueMutation('suppliers', 'INSERT', newSupplier);
      return optimistic;
    } catch (err) {
      // Revert optimistic addition if the network/database call failed with an explicit data error
      if (currentActiveStore === 'all' || currentActiveStore === storeId) {
        set(s => ({ suppliers: s.suppliers.filter(sup => sup.id !== newId) }));
      }
      console.error('Failed to create supplier:', err);
      const code = (err as any)?.code || (err as any)?.status || '';
      if (code === '42501' || String(err).toLowerCase().includes('permission')) {
        throw new Error('Permission denied: cannot create supplier. Check your store mapping and RLS policies.');
      }
      if (code === '23505' || String(err).toLowerCase().includes('duplicate')) {
        throw new Error('Supplier already exists.');
      }
      throw err;
    }
  },

  updateSupplier: async (id, data) => {
    const changes = {
      name: data.name,
      contact: data.contact,
      email: data.email,
      phone: data.phone,
      address: data.address,
      lead_time_days: data.leadTimeDays
    };

    const previous = get().suppliers;
    set(s => ({
      suppliers: s.suppliers.map(sup => sup.id === id ? { ...sup, ...data } : sup)
    }));

    try {
      await executeOrQueueMutation('suppliers', 'UPDATE', changes, 'id', id);
    } catch (err: any) {
      // rollback on error
      set({ suppliers: previous });
      console.error('Failed to update supplier:', err);
      if (err?.code === '42501' || String(err).toLowerCase().includes('permission')) {
        throw new Error('Permission denied: cannot update supplier. Check your store mapping and RLS policies.');
      }
      throw err;
    }
  },

  deleteSupplier: async (id) => {
    const previousSuppliers = get().suppliers;
    const previousPurchaseOrders = get().purchaseOrders;

    // Check the database directly because local cache can be stale.
    const { count: linkedPoCount, error: linkedPoError } = await supabase
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', id);

    if (linkedPoError && linkedPoError.code) {
      throw linkedPoError;
    }

    const hasLinkedPurchaseOrders = (linkedPoCount ?? 0) > 0
      || previousPurchaseOrders.some((po) => po.supplierId === id);

    if (hasLinkedPurchaseOrders) {
      throw new Error('Cannot delete supplier with existing purchase orders. Remove or reassign linked orders first.');
    }

    set(s => ({
      suppliers: s.suppliers.filter(sup => sup.id !== id),
      purchaseOrders: s.purchaseOrders.filter(po => po.supplierId !== id)
    }));

    try {
      await Promise.race([
        executeOrQueueMutation('suppliers', 'DELETE', undefined, 'id', id),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Delete request timed out. Check your internet and try again.')), 15000);
        })
      ]);
    } catch (err: any) {
      // Revert optimistic state if backend rejects deletion.
      set({ suppliers: previousSuppliers, purchaseOrders: previousPurchaseOrders });

      if (err?.code === '23503') {
        throw new Error('Cannot delete supplier because it is referenced by other records.');
      }

      if (err?.code === '42501') {
        throw new Error('Delete blocked by permissions (RLS). Please make sure your account is mapped to this store as admin.');
      }

      throw err;
    }
  },

  createPurchaseOrder: async (storeId, supplierId, supplierName, items) => {
    const newId = crypto.randomUUID();
    const total = items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

    const newPO = {
      id: newId,
      store_id: storeId,
      supplier_id: supplierId,
      supplier_name: supplierName,
      total,
      status: 'sent',
    };

    const optimisticPO: PurchaseOrder = {
      id: newId,
      storeId,
      supplierId,
      supplierName,
      items,
      total,
      status: 'sent',
      createdAt: new Date().toISOString()
    };

    const previousPurchaseOrders = get().purchaseOrders;
    set(s => ({ purchaseOrders: [optimisticPO, ...s.purchaseOrders] }));

    try {
      // Insert PO
      await executeOrQueueMutation('purchase_orders', 'INSERT', newPO);

      await Promise.all(items.map((item) =>
        executeOrQueueMutation('purchase_order_items', 'INSERT', {
          id: crypto.randomUUID(),
          purchase_order_id: newId,
          product_id: item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          unit_cost: item.unitCost
        })
      ));
    } catch (err) {
      set({ purchaseOrders: previousPurchaseOrders });
      throw err;
    }

    return optimisticPO;
  },

  receivePurchaseOrder: async (poId, onTime) => {
    const po = get().purchaseOrders.find((p) => p.id === poId);
    if (!po) throw new Error('Purchase order not found.');

    const now = new Date().toISOString();
    const { error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: poId,
      p_on_time: onTime,
    });

    if (error) throw error;

    set(s => ({
      purchaseOrders: s.purchaseOrders.map(p => 
        p.id === poId ? { ...p, status: 'received', onTime, receivedAt: now } : p
      )
    }));

    useProductStore.setState((state) => ({
      products: state.products.map((product) => {
        const item = po.items.find((line) => line.productId === product.id);
        return item ? { ...product, currentStock: product.currentStock + item.quantity } : product;
      }),
    }));

    // Database triggers/RPC refresh supplier scores and product stock on the backend.
    if (navigator.onLine) {
        setTimeout(() => {
           get().fetchSuppliers();
           useProductStore.getState().fetchProducts();
        }, 1500); // 1.5s buffer for triggers
    }
  },

  cancelPurchaseOrder: async (poId) => {
    set(s => ({
      purchaseOrders: s.purchaseOrders.map(po =>
        po.id === poId ? { ...po, status: 'cancelled' as const } : po
      )
    }));
    
    await executeOrQueueMutation('purchase_orders', 'UPDATE', {
      status: 'cancelled',
      updated_at: new Date().toISOString()
    }, 'id', poId);
  },

  recalculatePriceScores: () => {
     // Intentionally left as a no-op / background-refresh prompt. 
     // The backend `recalc_all_price_scores()` already calculates this continuously.
     if (navigator.onLine) {
         get().fetchSuppliers();
     }
  }
}));
