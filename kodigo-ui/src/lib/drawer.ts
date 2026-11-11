import { supabase } from '@/lib/supabase';

export interface DrawerTotals {
  opening_cash: number;
  cash_sales: number;
  cash_refunds: number;
  digital_cash_in: number;
  digital_cash_out: number;
  pay_in: number;
  pay_out: number;
  expected_cash: number;
}

export interface DrawerEntry {
  id: string;
  entry_type: 'pay_in' | 'pay_out' | 'drop';
  amount: number;
  reason: string;
  created_at: string;
}

export interface DrawerSession {
  id: string;
  store_id: string;
  cashier_name: string | null;
  opening_cash: number;
  opened_at: string;
  state: 'open' | 'closed';
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  close_notes: string | null;
  review_status: 'pending' | 'approved' | 'flagged';
  review_note: string | null;
  totals: DrawerTotals;
  entries: DrawerEntry[];
}

export interface AdjustmentRequest {
  id: string;
  sale_id: string;
  kind: 'void' | 'refund' | 'return';
  reason: string;
  amount: number | null;
  method: string | null;
  state: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  decision_note: string | null;
  receipt_number: string | null;
  sale_total: number;
  requester_name: string | null;
  decider_name: string | null;
}

export interface CustomerHistory {
  visits: number;
  total_spent: number;
  last_purchase_at: string | null;
  sales: Array<{ id: string; created_at: string; total: number; status: string; payment_method: string; receipt_number: string | null; items: string | null }>;
}

export interface CustomerRank {
  customer_id: string;
  display_name: string;
  visits: number;
  total_spent: number;
  last_purchase_at: string;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const getOpenDrawer = (storeId: string) => rpc<DrawerSession | null>('get_open_drawer_session', { p_store_id: storeId });
export const openDrawer = (storeId: string, openingCash: number) => rpc<DrawerSession>('open_drawer_session', { p_store_id: storeId, p_opening_cash: openingCash });
export const recordDrawerEntry = (sessionId: string, type: DrawerEntry['entry_type'], amount: number, reason: string) =>
  rpc<DrawerSession>('record_drawer_entry', { p_session_id: sessionId, p_type: type, p_amount: amount, p_reason: reason });
export const closeDrawer = (sessionId: string, counted: number, notes?: string) =>
  rpc<DrawerSession>('close_drawer_session', { p_session_id: sessionId, p_counted_cash: counted, p_notes: notes ?? null });
export const listDrawerSessions = (storeId: string, reviewStatus?: string) =>
  rpc<DrawerSession[]>('list_drawer_sessions', { p_store_id: storeId, p_review_status: reviewStatus ?? null, p_limit: 100 });
export const reviewDrawer = (sessionId: string, status: 'approved' | 'flagged', note?: string) =>
  rpc<DrawerSession>('review_drawer_session', { p_session_id: sessionId, p_status: status, p_note: note ?? null });

export const requestAdjustment = (input: { saleId: string; kind: 'void' | 'refund' | 'return'; reason: string; amount?: number; method?: string; items?: unknown }) =>
  rpc<{ id: string }>('request_sale_adjustment', {
    p_sale_id: input.saleId, p_kind: input.kind, p_reason: input.reason,
    p_amount: input.amount ?? null, p_method: input.method ?? 'cash', p_items: input.items ?? null,
  });
export const listAdjustmentRequests = (storeId: string, state?: string) =>
  rpc<AdjustmentRequest[]>('list_sale_adjustment_requests', { p_store_id: storeId, p_state: state ?? null });
export const decideAdjustment = (requestId: string, approve: boolean, note?: string) =>
  rpc<{ state: string }>('decide_sale_adjustment', { p_request_id: requestId, p_approve: approve, p_note: note ?? null });

export const linkSaleCustomer = (saleId: string, customerId: string) =>
  rpc<null>('link_sale_customer', { p_sale_id: saleId, p_customer_id: customerId });
export const getCustomerHistory = (customerId: string) => rpc<CustomerHistory>('get_customer_history', { p_customer_id: customerId, p_limit: 100 });
export const getCustomerRankings = (storeId: string, from: Date, to: Date, by: 'spend' | 'visits') =>
  rpc<CustomerRank[]>('customer_rankings', { p_store_id: storeId, p_from: from.toISOString(), p_to: to.toISOString(), p_by: by, p_limit: 25 });
