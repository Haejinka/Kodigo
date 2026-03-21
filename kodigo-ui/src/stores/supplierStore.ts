import { create } from 'zustand';
import { mockSuppliers, mockProducts } from '@/lib/mock-data';
import {
  computeReliabilityScore,
  computePriceScore,
  computeOverallScore,
} from '@/lib/supplier-scores';
import type { Supplier, PurchaseOrder, Product } from '@/types';

/** Fields collected via the form — scores are always auto-computed, never entered manually. */
export type SupplierFormData = Omit<
  Supplier,
  'id' | 'overallScore' | 'reliabilityScore' | 'priceScore' | 'totalOrders' | 'onTimeDeliveries' | 'createdAt'
>;

interface SupplierStore {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];

  // ── CRUD ────────────────────────────────────────────────────────────────────
  addSupplier: (data: SupplierFormData) => Supplier;
  updateSupplier: (id: string, data: SupplierFormData) => void;
  deleteSupplier: (id: string) => void;

  // ── Purchase Orders ─────────────────────────────────────────────────────────
  createPurchaseOrder: (
    supplierId: string,
    supplierName: string,
    items: PurchaseOrder['items'],
  ) => PurchaseOrder;
  receivePurchaseOrder: (poId: string, onTime: boolean, products: Product[]) => void;
  cancelPurchaseOrder: (poId: string) => void;

  // ── Score recalculation ─────────────────────────────────────────────────────
  /** Call whenever product cost prices change to keep price scores current. */
  recalculatePriceScores: (products: Product[]) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function recomputeAllScores(suppliers: Supplier[], products: Product[]): Supplier[] {
  return suppliers.map((sup) => {
    const reliabilityScore = computeReliabilityScore(sup.totalOrders, sup.onTimeDeliveries);
    const priceScore = computePriceScore(sup.id, suppliers, products);
    const overallScore = computeOverallScore(reliabilityScore, priceScore);
    return { ...sup, reliabilityScore, priceScore, overallScore };
  });
}

// Seed initial suppliers with formula-derived scores from mock product data
const initialSuppliers = recomputeAllScores(mockSuppliers, mockProducts);

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSupplierStore = create<SupplierStore>((set, get) => ({
  suppliers: initialSuppliers,
  purchaseOrders: [],

  // ── CRUD ──────────────────────────────────────────────────────────────────

  addSupplier: (data) => {
    const existing = get().suppliers;
    // New supplier: reliability = 100 (no history yet), price = 50 (no products yet)
    const reliabilityScore = 100;
    const priceScore = 50;
    const overallScore = computeOverallScore(reliabilityScore, priceScore);

    const newSupplier: Supplier = {
      ...data,
      id: `s${Date.now()}`,
      reliabilityScore,
      priceScore,
      overallScore,
      totalOrders: 0,
      onTimeDeliveries: 0,
      createdAt: new Date().toISOString(),
    };

    set({ suppliers: [...existing, newSupplier] });
    return newSupplier;
  },

  updateSupplier: (id, data) => {
    // Only contact/logistics fields update; scores stay as-is until recalculated
    set((s) => ({
      suppliers: s.suppliers.map((sup) =>
        sup.id === id ? { ...sup, ...data } : sup,
      ),
    }));
  },

  deleteSupplier: (id) => {
    set((s) => ({
      suppliers: s.suppliers.filter((sup) => sup.id !== id),
      purchaseOrders: s.purchaseOrders.filter((po) => po.supplierId !== id),
    }));
  },

  // ── Purchase Orders ────────────────────────────────────────────────────────

  createPurchaseOrder: (supplierId, supplierName, items) => {
    const po: PurchaseOrder = {
      id: `po-${Date.now()}`,
      supplierId,
      supplierName,
      items,
      total: items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0),
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ purchaseOrders: [po, ...s.purchaseOrders] }));
    return po;
  },

  receivePurchaseOrder: (poId, onTime, products) => {
    const now = new Date().toISOString();
    set((s) => {
      const po = s.purchaseOrders.find((p) => p.id === poId);
      if (!po) return {};

      const updatedPOs = s.purchaseOrders.map((p) =>
        p.id === poId ? { ...p, status: 'received' as const, onTime, receivedAt: now } : p,
      );

      // Recount this supplier's delivery history from all received POs
      const received = updatedPOs.filter(
        (p) => p.supplierId === po.supplierId && p.status === 'received',
      );
      const totalOrders = received.length;
      const onTimeDeliveries = received.filter((p) => p.onTime).length;
      const reliabilityScore = computeReliabilityScore(totalOrders, onTimeDeliveries);

      // Refresh all suppliers' price scores (relative normalisation may shift)
      const updatedSuppliers = s.suppliers.map((sup) => {
        const pScore = computePriceScore(sup.id, s.suppliers, products);
        if (sup.id === po.supplierId) {
          const overall = computeOverallScore(reliabilityScore, pScore);
          return { ...sup, totalOrders, onTimeDeliveries, reliabilityScore, priceScore: pScore, overallScore: overall };
        }
        return { ...sup, priceScore: pScore, overallScore: computeOverallScore(sup.reliabilityScore, pScore) };
      });

      return { purchaseOrders: updatedPOs, suppliers: updatedSuppliers };
    });
  },

  cancelPurchaseOrder: (poId) => {
    set((s) => ({
      purchaseOrders: s.purchaseOrders.map((po) =>
        po.id === poId ? { ...po, status: 'cancelled' as const } : po,
      ),
    }));
  },

  // ── Score recalculation ────────────────────────────────────────────────────

  recalculatePriceScores: (products) => {
    set((s) => ({
      suppliers: s.suppliers.map((sup) => {
        const priceScore = computePriceScore(sup.id, s.suppliers, products);
        return { ...sup, priceScore, overallScore: computeOverallScore(sup.reliabilityScore, priceScore) };
      }),
    }));
  },
}));
