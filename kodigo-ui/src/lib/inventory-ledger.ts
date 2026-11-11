import { supabase } from './supabase';
import { canonicalOperationJson, createOperationCommand, createOperationId, getPosOperation, parseConfirmedOperationResult } from './pos-operations.ts';
import type { ConfirmedOperationResult, OperationCommandV1, OperationJsonValue } from '@/types/operations';
import type { AdjustmentReason } from '@/types';

export interface InventoryLedgerBalance {
  store_id: string;
  product_id: string;
  location_id: string;
  quantity_on_hand: number;
  version: number;
}

export type InventoryAdjustmentMode = 'add' | 'remove' | 'count';

export interface InventoryAdjustmentCommandResult {
  workflow_state: 'applied' | 'requested';
  request_id?: string;
  adjustment_id?: string;
  movement_id?: string;
  stock_before?: number;
  stock_after?: number;
  quantity_delta?: number;
}

const pendingInventoryCommands = new Map<string, OperationCommandV1>();

export function buildInventoryCommand(input: {
  storeId: string;
  expectedVersion: number | null;
  payload: Record<string, OperationJsonValue>;
  operationId?: string;
}): OperationCommandV1 {
  const command = createOperationCommand({
    operation_id: input.operationId ?? createOperationId(),
    store_id: input.storeId,
    terminal_id: null,
    shift_id: null,
    occurred_at_local: new Date().toISOString(),
    terminal_sequence: null,
    expected_version: input.expectedVersion,
    payload: input.payload,
  });
  if (!input.operationId) return command;
  const pending = pendingInventoryCommands.get(command.operation_id);
  if (pending) {
    if (pending.store_id !== command.store_id
      || canonicalOperationJson(pending.payload) !== canonicalOperationJson(command.payload)) {
      throw new Error('This inventory operation ID is already tied to a different proposal. Start a new adjustment.');
    }
    return pending;
  }
  pendingInventoryCommands.set(command.operation_id, command);
  return command;
}

function forgetInventoryCommand(operationId: string) {
  pendingInventoryCommands.delete(operationId);
}

export interface CreateInventoryProductResult {
  product_id: string;
  initial_stock: number;
  inventory_adjustment: Record<string, unknown> | null;
}

/** Create the catalog rows and opening-stock movement in one server transaction. */
export async function createInventoryProduct(input: {
  storeId: string;
  product: Record<string, OperationJsonValue> & { id: string };
  sellingOptions: Record<string, OperationJsonValue>[];
  restockingOptions: Record<string, OperationJsonValue>[];
  supplierIds: string[];
  initialStock: number;
  operationId?: string;
}): Promise<ConfirmedOperationResult<CreateInventoryProductResult>> {
  const command = buildInventoryCommand({
    storeId: input.storeId,
    expectedVersion: null,
    operationId: input.operationId ?? input.product.id,
    payload: {
      product: input.product,
      selling_options: input.sellingOptions,
      restocking_options: input.restockingOptions,
      supplier_ids: input.supplierIds,
      initial_stock: input.initialStock,
    },
  });
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
  let data: unknown;
  let error: unknown;
  try {
    const response = await supabase.rpc('create_product_v2', { p_command: command })
      .abortSignal(controller.signal);
    data = response.data;
    error = response.error;
  } finally {
    window.clearTimeout(timeoutId);
  }
  const matchesCommand = (result: ConfirmedOperationResult<CreateInventoryProductResult>) =>
    result.operation_id === command.operation_id
      && result.outcome === 'confirmed'
      && result.aggregate_type === 'product'
      && result.aggregate_id === input.product.id
      && result.result.product_id === input.product.id
      && result.result.initial_stock === input.initialStock;
  if (error) {
    try {
      const prior = await getPosOperation<CreateInventoryProductResult>(input.storeId, command.operation_id);
      if (prior && matchesCommand(prior)) {
        forgetInventoryCommand(command.operation_id);
        return prior;
      }
    } catch {
      // Keep the original RPC error so a failed recovery read is never treated
      // as confirmation of a product or opening-stock movement.
    }
    throw error;
  }
  const result = parseOperation<CreateInventoryProductResult>(data, command.operation_id);
  if (!matchesCommand(result)) {
    throw new Error('The server response does not match the product creation command. Refresh the catalog before retrying.');
  }
  forgetInventoryCommand(command.operation_id);
  return result;
}

function isMissingLedgerStatusFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

/** Existing deployments without T06 keep using their current online RPC path. */
export async function isInventoryLedgerEnabled(storeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_inventory_ledger_status', { p_store_id: storeId });
  if (error) {
    if (isMissingLedgerStatusFunction(error)) return false;
    throw error;
  }
  return Boolean((data as { enabled?: boolean } | null)?.enabled);
}

export async function getInventoryLedgerBalance(
  storeId: string,
  productId: string,
): Promise<InventoryLedgerBalance> {
  const { data, error } = await supabase.rpc('get_inventory_product_balance', {
    p_store_id: storeId,
    p_product_id: productId,
  });
  if (error) throw error;
  const balance = data as InventoryLedgerBalance | null;
  if (!balance || !Number.isSafeInteger(Number(balance.version)) || Number(balance.version) < 1
    || !Number.isFinite(Number(balance.quantity_on_hand))) {
    throw new Error('The server did not return a valid live inventory balance. Refresh the inventory page and retry.');
  }
  return { ...balance, version: Number(balance.version), quantity_on_hand: Number(balance.quantity_on_hand) };
}

function parseOperation<T>(data: unknown, operationId: string): ConfirmedOperationResult<T> {
  const result = parseConfirmedOperationResult<T>(data);
  if (result.operation_id !== operationId) {
    throw new Error('The server response belongs to a different inventory command.');
  }
  return result;
}

export async function requestInventoryAdjustment(input: {
  storeId: string;
  productId: string;
  balance: InventoryLedgerBalance;
  mode: InventoryAdjustmentMode;
  quantity: number;
  reason: AdjustmentReason;
  note?: string;
  operationId?: string;
}): Promise<ConfirmedOperationResult<InventoryAdjustmentCommandResult>> {
  const command = buildInventoryCommand({
    storeId: input.storeId,
    expectedVersion: input.balance.version,
    operationId: input.operationId,
    payload: {
      product_id: input.productId,
      location_id: input.balance.location_id,
      mode: input.mode,
      quantity: input.quantity,
      reason: input.reason,
      note: input.note?.trim() || null,
    },
  });
  const { data, error } = await supabase.rpc('request_inventory_adjustment', { p_command: command });
  if (error) throw error;
  const result = parseOperation<InventoryAdjustmentCommandResult>(data, command.operation_id);
  forgetInventoryCommand(command.operation_id);
  return result;
}

export async function receiveInventoryStock(input: {
  storeId: string;
  productId: string;
  balance: InventoryLedgerBalance;
  restockingOptionId?: string;
  quantity: number;
  purchaseUnit: string;
  piecesPerUnit: number;
  totalSupplierCost?: number;
  ownership?: 'store_owned' | 'consigned';
  supplierId?: string;
  reason: string;
  note?: string;
  operationId?: string;
}): Promise<ConfirmedOperationResult<Record<string, unknown>>> {
  const command = buildInventoryCommand({
    storeId: input.storeId,
    expectedVersion: input.balance.version,
    operationId: input.operationId,
    payload: {
      product_id: input.productId,
      restocking_option_id: input.restockingOptionId ?? null,
      receiving_quantity: input.quantity,
      purchase_unit: input.purchaseUnit,
      pieces_per_purchase_unit: input.piecesPerUnit,
      purchase_total: input.totalSupplierCost ?? null,
      ownership: input.ownership ?? 'store_owned',
      supplier_id: input.supplierId ?? null,
      reason: input.reason.trim(),
      note: input.note?.trim() || null,
    },
  });
  const { data, error } = await supabase.rpc('receive_product_stock_v2', { p_command: command });
  if (error) throw error;
  const result = parseOperation<Record<string, unknown>>(data, command.operation_id);
  forgetInventoryCommand(command.operation_id);
  return result;
}
