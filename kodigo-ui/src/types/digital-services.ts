import type { OperationCommandV1, ConfirmedOperationResult } from './operations';

export type DigitalServiceKind = 'digital_product' | 'eload' | 'gcash_cash_in' | 'gcash_cash_out';
export type DigitalProviderKind = 'load' | 'gcash' | 'other';
export type DigitalExternalOutcome = 'confirmed' | 'failed' | 'unknown';

export interface DigitalServiceProduct {
  id: string;
  name: string;
  sku: string;
  kind: DigitalServiceKind;
  selling_price: string;
  cost_price: string;
  min_face_amount: string | null;
  max_face_amount: string | null;
  additional_charge: string;
  category_id: string;
}

export interface DigitalProviderWallet {
  provider_account_id: string;
  provider_name: string;
  account_kind: DigitalProviderKind;
  account_label: string;
  masked_identifier: string | null;
  active: boolean;
  wallet_account_id: string | null;
  wallet_type: 'load' | 'gcash' | null;
  balance: string | null;
  available_balance: string | null;
  wallet_version: number | null;
}

export interface DigitalFeeBand {
  minimum_amount: string;
  maximum_amount: string | null;
  formula: 'percent' | 'flat';
  rate_bps: number | null;
  flat_amount: string | null;
}

export interface DigitalFeePolicy {
  id: string;
  service_kind: Exclude<DigitalServiceKind, 'digital_product'>;
  policy_code: string;
  version: number;
  formula: 'percent' | 'flat' | 'bands';
  rate_bps: number | null;
  flat_amount: string | null;
  minimum_amount: string | null;
  maximum_amount: string | null;
  is_default: boolean;
  bands: DigitalFeeBand[];
}

export interface DigitalCashierShift {
  id: string;
  terminal_id: string;
  drawer_id: string;
  cashier_id: string;
  cashier_name: string;
  state: 'active';
  version: number;
  opening_amount: string;
  opened_at: string;
}

export interface DigitalServiceRecord {
  id: string;
  version: number;
  service_kind: DigitalServiceKind;
  state: 'draft' | 'reserved' | 'awaiting_cash' | 'awaiting_external' | 'completed' | 'needs_reconciliation' | string;
  face_amount: string;
  fee_amount: string;
  retail_amount: string;
  earning_amount: string;
  cash_leg_state: string;
  provider_leg_state: string;
  created_at: string;
  completed_at: string | null;
  product_name: string;
  account_label: string | null;
  reference: string | null;
  reconciliation_case_id: string | null;
}

export interface DigitalServiceWorkspace {
  enabled: boolean;
  online_only: true;
  active_shifts: DigitalCashierShift[];
  products: DigitalServiceProduct[];
  accounts: DigitalProviderWallet[];
  fee_policies: DigitalFeePolicy[];
  wallet_adjustments: DigitalWalletAdjustmentRequest[];
  records: DigitalServiceRecord[];
  generated_at: string;
}

export interface DigitalWalletAdjustmentRequest {
  request_id: string;
  request_version: number;
  wallet_id: string;
  wallet_label: string;
  wallet_type: 'load' | 'gcash';
  wallet_version: number;
  requester_id: string;
  state: 'requested' | 'approved';
  kind: 'opening' | 'topup' | 'withdraw' | 'correction';
  amount: string;
  funding_source: 'cash' | 'external' | 'opening_balance';
  reason: string;
  decision_id: string | null;
  decision: 'approve' | 'reject' | null;
  decision_by: string | null;
}

export interface DigitalServiceQuote {
  service_kind: DigitalServiceKind;
  face_amount: string;
  fee_amount: string;
  cost_amount: string;
  retail_amount: string;
  additional_charge_amount: string;
  earning_amount: string;
  wallet_delta: string;
  cash_delta: string;
  fee_policy_id: string | null;
  policy_code: string | null;
  policy_version: number | null;
  fee_policy_snapshot: Record<string, unknown>;
}

export interface DigitalServiceRecordResult {
  service_id: string;
  service_kind: DigitalServiceKind;
  state: string;
  version: number;
  face_amount: string;
  fee_amount: string;
  retail_amount: string;
  cost_amount: string;
  earning_amount: string;
  cash_delta: string;
  cash_movement_id: string;
  wallet_movement_id: string | null;
  external_event_id: string | null;
  reconciliation_case_id: string | null;
  message: string;
}

export type DigitalCommand = OperationCommandV1;
export type DigitalCommandResult<T> = ConfirmedOperationResult<T>;
