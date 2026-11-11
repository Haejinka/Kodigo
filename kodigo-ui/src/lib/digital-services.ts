import { createOperationCommand, createOperationId, parseConfirmedOperationResult } from './pos-operations';
import { supabase } from './supabase';
import type { OperationJsonValue } from '@/types/operations';
import type {
  DigitalCommand,
  DigitalCommandResult,
  DigitalExternalOutcome,
  DigitalProviderKind,
  DigitalServiceKind,
  DigitalServiceQuote,
  DigitalServiceRecordResult,
  DigitalServiceWorkspace,
} from '@/types/digital-services';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const amountPattern = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,2}))?$/;

function normalizeId(value: string, field: string): string {
  if (!uuidPattern.test(value)) throw new TypeError(`${field} must be a UUID.`);
  return value.toLowerCase();
}

export function normalizeDigitalAmount(value: string, field = 'Amount'): string {
  const match = amountPattern.exec(value.trim());
  if (!match) throw new TypeError(`${field} must be a positive amount with at most two decimals.`);
  const normalized = `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
  if (Number(normalized) <= 0) throw new TypeError(`${field} must be greater than zero.`);
  return normalized;
}

function normalizeCatalogAmount(value: string, field: string): string {
  const match = amountPattern.exec(value.trim());
  if (!match) throw new TypeError(`${field} must have at most two decimals.`);
  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
}

function newCommand(input: {
  operationId?: string;
  storeId: string;
  terminalId?: string | null;
  shiftId?: string | null;
  payload: Record<string, OperationJsonValue>;
}): DigitalCommand {
  const retrying = Boolean(input.operationId);
  return createOperationCommand({
    operation_id: normalizeId(input.operationId ?? createOperationId(), 'Operation ID'),
    store_id: normalizeId(input.storeId, 'Store ID'),
    terminal_id: input.terminalId ? normalizeId(input.terminalId, 'Terminal ID') : null,
    shift_id: input.shiftId ? normalizeId(input.shiftId, 'Shift ID') : null,
    // Keep command semantics byte-for-byte stable when a caller replays an
    // operation ID after a lost response.
    occurred_at_local: retrying ? null : new Date().toISOString(),
    terminal_sequence: null,
    expected_version: null,
    payload: input.payload,
  });
}

export async function getDigitalServiceWorkspace(storeId: string): Promise<DigitalServiceWorkspace> {
  const { data, error } = await supabase.rpc('get_digital_service_workspace', {
    p_store_id: normalizeId(storeId, 'Store ID'),
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Digital service workspace is invalid.');
  const result = data as DigitalServiceWorkspace;
  if (typeof result.enabled !== 'boolean' || result.online_only !== true
    || !Array.isArray(result.active_shifts) || !Array.isArray(result.products)
    || !Array.isArray(result.accounts) || !Array.isArray(result.fee_policies)
    || !Array.isArray(result.records)) {
    throw new TypeError('Digital service workspace is missing required fields.');
  }
  return result;
}

export async function quoteDigitalService(input: {
  storeId: string;
  productId: string;
  serviceKind: DigitalServiceKind;
  faceAmount: string;
  policyCode?: string | null;
}): Promise<DigitalServiceQuote> {
  const { data, error } = await supabase.rpc('quote_digital_service', {
    p_store_id: normalizeId(input.storeId, 'Store ID'),
    p_product_id: normalizeId(input.productId, 'Product ID'),
    p_service_kind: input.serviceKind,
    p_face_amount: normalizeDigitalAmount(input.faceAmount),
    p_policy_code: input.policyCode ?? null,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Digital service quote is invalid.');
  return data as DigitalServiceQuote;
}

export async function createDigitalProviderAccount(input: {
  storeId: string;
  providerName: string;
  accountKind: DigitalProviderKind;
  accountLabel: string;
  maskedIdentifier?: string | null;
  operationId?: string;
}): Promise<DigitalCommandResult<{
  provider_account_id: string;
  wallet_account_id: string | null;
  account_kind: DigitalProviderKind;
  account_label: string;
  masked_identifier: string | null;
  wallet_balance: string;
}>> {
  const command = newCommand({
    operationId: input.operationId,
    storeId: input.storeId,
    payload: {
      provider_name: input.providerName.trim(),
      account_kind: input.accountKind,
      account_label: input.accountLabel.trim(),
      masked_identifier: input.maskedIdentifier?.trim() || null,
    },
  });
  const { data, error } = await supabase.rpc('create_digital_provider_account', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<{
    provider_account_id: string;
    wallet_account_id: string | null;
    account_kind: DigitalProviderKind;
    account_label: string;
    masked_identifier: string | null;
    wallet_balance: string;
  }>(data);
}

export async function createDigitalServiceProduct(input: {
  storeId: string;
  kind: DigitalServiceKind;
  name: string;
  sku: string;
  categoryId: string;
  sellingPrice: string;
  costPrice: string;
  minFaceAmount?: string | null;
  maxFaceAmount?: string | null;
  additionalCharge?: string;
  operationId?: string;
}): Promise<DigitalCommandResult<{
  product_id: string;
  kind: DigitalServiceKind;
  name: string;
  sku: string;
  selling_price: string;
  cost_price: string;
  min_face_amount: number | null;
  max_face_amount: number | null;
  additional_charge: string;
}>> {
  const command = newCommand({
    operationId: input.operationId,
    storeId: input.storeId,
    payload: {
      kind: input.kind,
      name: input.name.trim(),
      sku: input.sku.trim(),
      category_id: normalizeId(input.categoryId, 'Category ID'),
      selling_price: normalizeCatalogAmount(input.sellingPrice, 'Selling price'),
      cost_price: normalizeCatalogAmount(input.costPrice, 'Cost price'),
      min_face_amount: input.minFaceAmount ? normalizeCatalogAmount(input.minFaceAmount, 'Minimum amount') : null,
      max_face_amount: input.maxFaceAmount ? normalizeCatalogAmount(input.maxFaceAmount, 'Maximum amount') : null,
      additional_charge: normalizeCatalogAmount(input.additionalCharge ?? '0.00', 'Additional charge'),
    },
  });
  const { data, error } = await supabase.rpc('create_digital_service_product', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<{
    product_id: string; kind: DigitalServiceKind; name: string; sku: string;
    selling_price: string; cost_price: string; min_face_amount: number | null;
    max_face_amount: number | null; additional_charge: string;
  }>(data);
}

export function buildManualDigitalServiceCommand(input: {
  storeId: string;
  terminalId?: string | null;
  shiftId?: string | null;
  productId: string;
  serviceKind: DigitalServiceKind;
  faceAmount: string;
  policyCode?: string | null;
  providerAccountId?: string | null;
  walletAccountId?: string | null;
  externalOutcome: DigitalExternalOutcome;
  reference?: string | null;
  externalAt?: string | null;
  evidenceRef: string;
  cashExchangeAttested: boolean;
  operationId?: string;
}): DigitalCommand {
  const externalAt = input.externalAt ? new Date(input.externalAt).toISOString() : null;
  return newCommand({
    operationId: input.operationId,
    storeId: input.storeId,
    terminalId: input.terminalId ?? null,
    shiftId: input.shiftId ?? null,
    payload: {
      product_id: normalizeId(input.productId, 'Product ID'),
      service_kind: input.serviceKind,
      face_amount: normalizeDigitalAmount(input.faceAmount),
      policy_code: input.policyCode ?? null,
      provider_account_id: input.providerAccountId ? normalizeId(input.providerAccountId, 'Provider account ID') : null,
      wallet_account_id: input.walletAccountId ? normalizeId(input.walletAccountId, 'Wallet account ID') : null,
      external_outcome: input.externalOutcome,
      reference: input.reference?.trim() || null,
      external_at: externalAt,
      evidence_ref: input.evidenceRef.trim() || null,
      cash_exchange_attested: input.cashExchangeAttested,
    },
  });
}

export async function recordManualDigitalService(
  command: DigitalCommand,
): Promise<DigitalCommandResult<DigitalServiceRecordResult>> {
  const { data, error } = await supabase.rpc('record_manual_digital_service', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<DigitalServiceRecordResult>(data);
}

export async function requestDigitalWalletAdjustment(input: {
  storeId: string;
  walletId: string;
  walletVersion: number;
  amount: string;
  kind: 'opening' | 'topup' | 'withdraw';
  fundingSource: 'external' | 'opening_balance';
  reason: string;
  operationId?: string;
}): Promise<DigitalCommandResult<{ request_id: string; request_version: number; kind: string; proposal_hash: string }>> {
  const amount = normalizeDigitalAmount(input.amount, 'Adjustment amount');
  const numericAmount = Number(amount);
  if (!Number.isSafeInteger(Math.round(numericAmount * 100))) {
    throw new TypeError('Adjustment amount is too large for a precise approval request.');
  }
  const command = newCommand({
    operationId: input.operationId,
    storeId: input.storeId,
    payload: {
      kind: 'wallet_adjustment',
      resource_id: normalizeId(input.walletId, 'Wallet ID'),
      expected_resource_version: input.walletVersion,
      proposal: {
        wallet_id: normalizeId(input.walletId, 'Wallet ID'),
        kind: input.kind,
        amount: numericAmount,
        funding_source: input.fundingSource,
      },
      reason: input.reason.trim(),
    },
  });
  const { data, error } = await supabase.rpc('request_operational_approval', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<{ request_id: string; request_version: number; kind: string; proposal_hash: string }>(data);
}

export async function decideDigitalWalletAdjustment(input: {
  storeId: string;
  requestId: string;
  requestVersion: number;
  decision: 'approve' | 'reject';
  reason: string;
  operationId?: string;
}): Promise<DigitalCommandResult<{ workflow_state: string; request_id: string; request_version: number; decision_id: string; decision: string }>> {
  const command = createOperationCommand({
    operation_id: normalizeId(input.operationId ?? createOperationId(), 'Operation ID'),
    store_id: normalizeId(input.storeId, 'Store ID'),
    terminal_id: null,
    shift_id: null,
    occurred_at_local: null,
    terminal_sequence: null,
    expected_version: input.requestVersion,
    payload: {
      request_id: normalizeId(input.requestId, 'Request ID'),
      decision: input.decision,
      reason: input.reason.trim(),
    },
  });
  const { data, error } = await supabase.rpc('decide_operational_approval', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<{ workflow_state: string; request_id: string; request_version: number; decision_id: string; decision: string }>(data);
}

export async function applyDigitalWalletAdjustment(input: {
  storeId: string;
  walletId: string;
  requestId: string;
  decisionId: string;
  walletVersion: number;
  externalReference: string;
  evidenceRef: string;
  operationId?: string;
}): Promise<DigitalCommandResult<{
  wallet_id: string;
  movement_id: string;
  balance_before: string;
  balance_after: string;
  application_id: string;
  external_reference: string;
}>> {
  const command = newCommand({
    operationId: input.operationId,
    storeId: input.storeId,
    payload: {
      request_id: normalizeId(input.requestId, 'Request ID'),
      decision_id: normalizeId(input.decisionId, 'Decision ID'),
      expected_wallet_version: input.walletVersion,
      external_reference: input.externalReference.trim() || null,
      evidence_ref: input.evidenceRef.trim(),
    },
  });
  const { data, error } = await supabase.rpc('apply_digital_wallet_adjustment', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<{
    wallet_id: string; movement_id: string; balance_before: string; balance_after: string;
    application_id: string; external_reference: string;
  }>(data);
}

export async function resolveManualDigitalServiceOutcome(input: {
  storeId: string;
  serviceId: string;
  serviceVersion: number;
  reference: string;
  externalAt: string;
  evidenceRef: string;
  operationId?: string;
}): Promise<DigitalCommandResult<{
  service_id: string;
  state: string;
  version: number;
  external_event_id: string;
  wallet_movement_id: string | null;
  reconciliation_case_id: string | null;
  message: string;
}>> {
  const command = newCommand({
    operationId: input.operationId,
    storeId: input.storeId,
    payload: {
      service_id: normalizeId(input.serviceId, 'Service ID'),
      service_version: input.serviceVersion,
      reference: input.reference.trim(),
      external_at: new Date(input.externalAt).toISOString(),
      evidence_ref: input.evidenceRef.trim(),
    },
  });
  const { data, error } = await supabase.rpc('resolve_digital_service_external_outcome', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<{
    service_id: string; state: string; version: number; external_event_id: string;
    wallet_movement_id: string | null; reconciliation_case_id: string | null; message: string;
  }>(data);
}

export async function addWalletBalance(input: {
  storeId: string;
  walletId: string;
  amount: string;
  note?: string | null;
  operationId?: string;
}) {
  const command = newCommand({
    operationId: input.operationId,
    storeId: input.storeId,
    payload: {
      wallet_id: normalizeId(input.walletId, 'Wallet ID'),
      amount: normalizeDigitalAmount(input.amount),
      note: input.note?.trim() || null,
    },
  });
  const { data, error } = await supabase.rpc('add_wallet_balance', { p_command: command });
  if (error) throw error;
  return parseConfirmedOperationResult<{ wallet_id: string; added: string; balance_after: string }>(data);
}
