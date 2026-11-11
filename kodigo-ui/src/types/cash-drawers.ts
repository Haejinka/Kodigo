export interface PosTerminal {
  id: string;
  store_id: string;
  name: string;
  display_identifier: string | null;
  active: boolean;
  version: number;
  created_at: string;
}

export interface CashDrawer {
  id: string;
  store_id: string;
  name: string;
  terminal_id: string | null;
  active: boolean;
  version: number;
  created_at: string;
}

export interface CashierShift {
  id: string;
  store_id: string;
  drawer_id: string;
  terminal_id: string;
  cashier_id: string;
  cashier_name_snapshot: string;
  state: 'active' | 'submitting' | 'closed';
  version: number;
  opening_amount: string;
  opened_at: string;
  occurred_at_local: string | null;
}

export interface CashCustodySnapshot {
  terminals: PosTerminal[];
  drawers: CashDrawer[];
}
