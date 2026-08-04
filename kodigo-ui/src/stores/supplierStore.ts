import { create } from 'zustand';
import type { Supplier, PurchaseOrder, Product } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useProductStore } from '@/stores/productStore';
import { executeOrQueueMutation } from '@/lib/offline-sync';

export type SupplierFormData = Omit<
  Supplier,
  'id' | 'storeId' | 'storeNames' | 'overallScore' | 'reliabilityScore' | 'priceScore' | 'totalOrders' | 'onTimeDeliveries' | 'createdAt'
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

const mapSupplierRows = (rows: any[] = []): Supplier[] => {
  return rows
    .map((s) => ({
      id: s.id,
      storeId: s.store_ids?.[0] || '',
      storeIds: s.store_ids || [],
      storeNames: s.store_names || [],
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
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchSuppliersForStore = async (storeId?: string): Promise<Supplier[]> => {
  let supplierStoreQuery = supabase
    .from('supplier_stores')
    .select('supplier_id, store_id, stores(id,name)');

  if (storeId && storeId !== 'all') {
    supplierStoreQuery = supplierStoreQuery.eq('store_id', storeId);
  }

  const { data: supplierStoreRows, error: supplierStoreError } = await supplierStoreQuery;
  if (supplierStoreError) throw supplierStoreError;

  const rows = supplierStoreRows || [];
  const supplierIds = [...new Set(rows.map((row: any) => row.supplier_id).filter(Boolean))];
  if (supplierIds.length === 0) return [];

  const supplierMeta = new Map<string, { storeIds: string[]; storeNames: string[] }>();
  for (const row of rows as any[]) {
    const current = supplierMeta.get(row.supplier_id) || { storeIds: [], storeNames: [] };
    if (row.store_id && !current.storeIds.includes(row.store_id)) current.storeIds.push(row.store_id);
    const storeName = Array.isArray(row.stores) ? row.stores[0]?.name : row.stores?.name;
    if (storeName && !current.storeNames.includes(storeName)) current.storeNames.push(storeName);
    supplierMeta.set(row.supplier_id, current);
  }

  const { data: suppliers, error: supplierError } = await supabase
    .from('suppliers')
    .select('*')
    .in('id', supplierIds)
    .order('name', { ascending: true });

  if (supplierError) throw supplierError;

  return mapSupplierRows((suppliers || []).map((supplier: any) => ({
    ...supplier,
    store_ids: supplierMeta.get(supplier.id)?.storeIds || [],
    store_names: supplierMeta.get(supplier.id)?.storeNames || [],
  })));
};

export const useSupplierStore = create<SupplierStore>((set, get) => ({
  suppliers: [],
  purchaseOrders: [],
  isLoading: false,

  fetchSuppliers: async () => {
    const storeId = useAuthStore.getState().activeStoreId;

    set({ isLoading: true });
    try {
      if (!navigator.onLine) throw new Error("Offline mode: cannot fetch initial suppliers");
      const suppliers = await fetchSuppliersForStore(storeId ?? undefined);
      set({ suppliers, isLoading: false });
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
    const ownerProfileId = useAuthStore.getState().user?.id;
    if (!ownerProfileId) {
      throw new Error('Your session has expired. Sign in again before creating a supplier.');
    }
    const selectedStoreIds = [...new Set((data.storeIds || []).filter((storeId) => storeId && storeId !== 'all'))];
    if (selectedStoreIds.length === 0) {
       console.warn("Please select at least one store first.");
       return undefined;
    }
    if (!navigator.onLine) {
      throw new Error('Creating shared suppliers currently requires an online connection.');
    }

    const newId = crypto.randomUUID();
    const newSupplier = {
      id: newId,
      name: data.name,
      contact: data.contact,
      email: data.email,
      phone: data.phone,
      address: data.address,
      lead_time_days: data.leadTimeDays,
      owner_profile_id: ownerProfileId,
    };

    const optimistic: Supplier = {
      ...data,
      id: newId,
      storeId: selectedStoreIds[0],
      storeIds: selectedStoreIds,
      storeNames: useAuthStore.getState().stores.filter((store) => selectedStoreIds.includes(store.id)).map((store) => store.name),
      reliabilityScore: 100,
      priceScore: 50,
      overallScore: 80,
      totalOrders: 0,
      onTimeDeliveries: 0,
      createdAt: new Date().toISOString()
    };

    const currentActiveStore = useAuthStore.getState().activeStoreId;
    if (currentActiveStore === 'all' || selectedStoreIds.includes(currentActiveStore || '')) {
      set(s => ({ suppliers: [...s.suppliers, optimistic] }));
    }

    try {
      const { error: insertSupplierError } = await supabase.from('suppliers').insert(newSupplier);
      if (insertSupplierError) throw insertSupplierError;

      const { error: linkError } = await supabase.from('supplier_stores').insert(
        selectedStoreIds.map((storeId) => ({
          supplier_id: newId,
          store_id: storeId,
        }))
      );
      if (linkError) {
        await supabase.from('suppliers').delete().eq('id', newId);
        throw linkError;
      }

      await get().fetchSuppliers();
      return optimistic;
    } catch (err) {
      // Revert optimistic addition if the network/database call failed with an explicit data error
      if (currentActiveStore === 'all' || selectedStoreIds.includes(currentActiveStore || '')) {
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
    const selectedStoreIds = [...new Set((data.storeIds || []).filter((storeId) => storeId && storeId !== 'all'))];
    if (selectedStoreIds.length === 0) {
      throw new Error('Assign the supplier to at least one store.');
    }
    if (!navigator.onLine) {
      throw new Error('Updating shared supplier assignments currently requires an online connection.');
    }

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
      suppliers: s.suppliers.map((sup) => {
        if (sup.id !== id) return sup;
        const storeNames = useAuthStore.getState().stores
          .filter((store) => selectedStoreIds.includes(store.id))
          .map((store) => store.name);
        return {
          ...sup,
          ...data,
          storeId: selectedStoreIds[0],
          storeIds: selectedStoreIds,
          storeNames,
        };
      })
    }));

    try {
      const { error: supplierError } = await supabase.from('suppliers').update(changes).eq('id', id);
      if (supplierError) throw supplierError;

      const { data: existingLinks, error: existingLinksError } = await supabase
        .from('supplier_stores')
        .select('store_id')
        .eq('supplier_id', id);
      if (existingLinksError) throw existingLinksError;

      const existingStoreIds = new Set((existingLinks || []).map((row) => row.store_id));
      const nextStoreIds = new Set(selectedStoreIds);
      const toAdd = selectedStoreIds.filter((storeId) => !existingStoreIds.has(storeId));
      const toRemove = [...existingStoreIds].filter((storeId) => !nextStoreIds.has(storeId));

      if (toAdd.length > 0) {
        const { error: addLinkError } = await supabase.from('supplier_stores').insert(
          toAdd.map((storeId) => ({
            supplier_id: id,
            store_id: storeId,
          }))
        );
        if (addLinkError) throw addLinkError;
      }

      for (const storeId of toRemove) {
        const { error: removeLinkError } = await supabase
          .from('supplier_stores')
          .delete()
          .eq('supplier_id', id)
          .eq('store_id', storeId);
        if (removeLinkError) throw removeLinkError;
      }

      await get().fetchSuppliers();
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
    const activeStoreId = useAuthStore.getState().activeStoreId;
    const supplier = previousSuppliers.find((item) => item.id === id);
    if (!supplier) throw new Error('Supplier not found.');
    if (!navigator.onLine) {
      throw new Error('Removing shared suppliers currently requires an online connection.');
    }

    const targetStoreId =
      activeStoreId && activeStoreId !== 'all'
        ? activeStoreId
        : supplier.storeIds.length === 1
        ? supplier.storeIds[0]
        : undefined;

    if (!targetStoreId) {
      throw new Error('Select a specific store before removing a supplier shared across multiple stores.');
    }

    // Check the database directly because local cache can be stale.
    const { count: linkedPoCount, error: linkedPoError } = await supabase
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', id)
      .eq('store_id', targetStoreId);

    if (linkedPoError && linkedPoError.code) {
      throw linkedPoError;
    }

    const { count: linkedProductCount, error: linkedProductError } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', id)
      .eq('store_id', targetStoreId);

    if (linkedProductError && linkedProductError.code) {
      throw linkedProductError;
    }

    const hasLinkedPurchaseOrders = (linkedPoCount ?? 0) > 0
      || previousPurchaseOrders.some((po) => po.supplierId === id && po.storeId === targetStoreId);

    if (hasLinkedPurchaseOrders) {
      throw new Error('Cannot remove this supplier from the selected store while purchase orders still reference it.');
    }

    if ((linkedProductCount ?? 0) > 0) {
      throw new Error('Cannot remove this supplier from the selected store while products still use it. Reassign those products first.');
    }

    set(s => ({
      suppliers: s.suppliers.filter((sup) => {
        if (sup.id !== id) return true;
        return !sup.storeIds.includes(targetStoreId) || sup.storeIds.length > 1;
      }).map((sup) => {
        if (sup.id !== id) return sup;
        const nextStoreIds = sup.storeIds.filter((storeId) => storeId !== targetStoreId);
        const removedStoreName = useAuthStore.getState().stores.find((item) => item.id === targetStoreId)?.name;
        return {
          ...sup,
          storeIds: nextStoreIds,
          storeNames: sup.storeNames.filter((storeName) => storeName !== removedStoreName),
          storeId: nextStoreIds[0] || '',
        };
      }),
      purchaseOrders: s.purchaseOrders.filter(po => !(po.supplierId === id && po.storeId === targetStoreId))
    }));

    try {
      if (supplier.storeIds.length > 1) {
        const { error } = await supabase
          .from('supplier_stores')
          .delete()
          .eq('supplier_id', id)
          .eq('store_id', targetStoreId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('suppliers')
          .delete()
          .eq('id', id);
        if (error) throw error;
      }

      await get().fetchSuppliers();
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
