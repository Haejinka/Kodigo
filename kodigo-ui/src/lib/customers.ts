import type {
  CustomerCommandBuilderForArchiveInput,
  CustomerCommandBuilderForAssociationInput,
  CustomerCommandBuilderForUpdateInput,
  CustomerCommandBuilderInput,
  CustomerCommandResult,
  CustomerOperationCommand,
  CustomerOperationResult,
  CustomerProfile,
  CustomerRecordResult,
  CustomerSaleLinkResult,
  CustomerSummary,
} from '@/types/customers';
import type { OperationCommandV1 } from '@/types/operations';
import { createOperationCommand, createOperationId, parseConfirmedOperationResult } from './pos-operations';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function requireUuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) throw new TypeError(`${label} must be a UUID.`);
  return value.toLowerCase();
}

function normalizeOptionalContact(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be text or null.`);
  const normalized = value.trim();
  if (normalized.length > maxLength || containsControlCharacters(normalized)) {
    throw new TypeError(`${label} exceeds the allowed format.`);
  }
  return normalized || null;
}

function normalizeCustomerName(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Customer name must be text.');
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 100 || containsControlCharacters(normalized)) {
    throw new TypeError('Customer name must contain 1 to 100 printable characters.');
  }
  return normalized;
}

function normalizeReason(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Reason must be text.');
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 500 || containsControlCharacters(normalized)) {
    throw new TypeError('Reason must contain 3 to 500 printable characters.');
  }
  return normalized;
}

function buildCommand(
  storeId: string,
  expectedVersion: number | null,
  payload: Record<string, string | null>,
  operationId = createOperationId(),
): CustomerOperationCommand {
  return createOperationCommand({
    operation_id: requireUuid(operationId, 'Operation ID'),
    store_id: requireUuid(storeId, 'Store ID'),
    terminal_id: null,
    shift_id: null,
    occurred_at_local: null,
    terminal_sequence: null,
    expected_version: expectedVersion,
    payload,
  });
}

/** Build once and reuse this exact command after a transport failure. */
export function buildCreateCustomerCommand(input: CustomerCommandBuilderInput): CustomerOperationCommand {
  return buildCommand(input.storeId, null, {
    display_name: normalizeCustomerName(input.displayName),
    phone: normalizeOptionalContact(input.phone, 'Phone', 40),
    email: normalizeOptionalContact(input.email, 'Email', 254),
  }, input.operationId);
}

/** Build once and reuse this exact command after a transport failure. */
export function buildUpdateCustomerCommand(input: CustomerCommandBuilderForUpdateInput): CustomerOperationCommand {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new TypeError('Expected customer version must be a positive safe integer.');
  }
  return buildCommand(input.storeId, input.expectedVersion, {
    customer_id: requireUuid(input.customerId, 'Customer ID'),
    display_name: normalizeCustomerName(input.displayName),
    phone: normalizeOptionalContact(input.phone, 'Phone', 40),
    email: normalizeOptionalContact(input.email, 'Email', 254),
  }, input.operationId);
}

/** Build once and reuse this exact command after a transport failure. */
export function buildArchiveCustomerCommand(input: CustomerCommandBuilderForArchiveInput): CustomerOperationCommand {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new TypeError('Expected customer version must be a positive safe integer.');
  }
  return buildCommand(input.storeId, input.expectedVersion, {
    customer_id: requireUuid(input.customerId, 'Customer ID'),
    reason: normalizeReason(input.reason),
  }, input.operationId);
}

/** Build once and reuse this exact command after a transport failure. */
export function buildAssociateSaleCustomerCommand(input: CustomerCommandBuilderForAssociationInput): CustomerOperationCommand {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new TypeError('Expected customer version must be a positive safe integer.');
  }
  return buildCommand(input.storeId, input.expectedVersion, {
    customer_id: requireUuid(input.customerId, 'Customer ID'),
    sale_id: requireUuid(input.saleId, 'Sale ID'),
    reason: normalizeReason(input.reason),
  }, input.operationId);
}

export function parseCustomerSummaries(value: unknown): CustomerSummary[] {
  if (!Array.isArray(value)) throw new TypeError('Customer search result must be an array.');
  return value.map((entry) => {
    if (!isPlainObject(entry)
      || !hasExactKeys(entry, ['id', 'display_name'])
      || typeof entry.id !== 'string' || !uuidPattern.test(entry.id)
      || typeof entry.display_name !== 'string'
      || entry.display_name.trim() !== entry.display_name
      || entry.display_name.length < 1 || entry.display_name.length > 100) {
      throw new TypeError('Customer search result has invalid fields.');
    }
    return { id: entry.id.toLowerCase(), display_name: entry.display_name };
  });
}

export function parseCustomerProfile(value: unknown): CustomerProfile {
  if (!isPlainObject(value)
    || !hasExactKeys(value, [
      'id', 'store_id', 'display_name', 'phone', 'email', 'active',
      'version', 'created_at', 'updated_at', 'archived_at',
    ])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || typeof value.store_id !== 'string' || !uuidPattern.test(value.store_id)
    || typeof value.display_name !== 'string'
    || value.display_name.trim() !== value.display_name
    || value.display_name.length < 1 || value.display_name.length > 100
    || (value.phone !== null && (typeof value.phone !== 'string' || value.phone.length > 40))
    || (value.email !== null && (typeof value.email !== 'string' || value.email.length > 254))
    || typeof value.active !== 'boolean'
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !isIsoDate(value.created_at) || !isIsoDate(value.updated_at)
    || (value.archived_at !== null && !isIsoDate(value.archived_at))) {
    throw new TypeError('Customer profile has invalid fields.');
  }
  return {
    ...value,
    id: value.id.toLowerCase(),
    store_id: value.store_id.toLowerCase(),
  } as CustomerProfile;
}

function parseCustomerCommandResult(
  value: unknown,
  expectedOperationId: string,
  kind: 'create_customer' | 'update_customer' | 'archive_customer' | 'associate_sale_customer',
): CustomerOperationResult {
  const operation = parseConfirmedOperationResult<CustomerCommandResult>(value);
  if (operation.outcome !== 'confirmed' || operation.operation_id !== expectedOperationId.toLowerCase()) {
    throw new TypeError('Customer command response does not match the submitted operation.');
  }
  if (kind === 'associate_sale_customer') {
    const link = operation.result as CustomerSaleLinkResult;
    if (!isPlainObject(link)
      || !hasExactKeys(link, ['link_id', 'sale_id', 'customer_id', 'link_type', 'linked_at'])
      || typeof link.link_id !== 'string' || !uuidPattern.test(link.link_id)
      || typeof link.sale_id !== 'string' || !uuidPattern.test(link.sale_id)
      || typeof link.customer_id !== 'string' || !uuidPattern.test(link.customer_id)
      || link.link_type !== 'retroactive' || !isIsoDate(link.linked_at)
      || operation.aggregate_type !== 'sale_customer_link'
      || operation.aggregate_id !== link.link_id
      || operation.aggregate_version !== 1) {
      throw new TypeError('Customer sale link response has invalid fields.');
    }
    return operation as CustomerOperationResult;
  }

  const record = operation.result as CustomerRecordResult;
  if (!isPlainObject(record)
    || !hasExactKeys(record, ['customer_id', 'version'])
    || typeof record.customer_id !== 'string' || !uuidPattern.test(record.customer_id)
    || !Number.isSafeInteger(record.version) || Number(record.version) < 1
    || operation.aggregate_type !== 'customer'
    || operation.aggregate_id !== record.customer_id
    || operation.aggregate_version !== record.version) {
    throw new TypeError('Customer record response has invalid fields.');
  }
  return operation as CustomerOperationResult;
}

export async function searchCustomers(storeId: string, query: string, limit = 20): Promise<CustomerSummary[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 80
    || normalizedQuery.includes('%') || normalizedQuery.includes('_') || normalizedQuery.includes('\\')
    || containsControlCharacters(normalizedQuery)
    || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError('Customer search query or limit is invalid.');
  }
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('search_customers', {
    p_store_id: requireUuid(storeId, 'Store ID'),
    p_query: normalizedQuery,
    p_limit: limit,
  });
  if (error) throw error;
  return parseCustomerSummaries(data);
}

export async function getCustomer(storeId: string, customerId: string): Promise<CustomerProfile> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('get_customer', {
    p_store_id: requireUuid(storeId, 'Store ID'),
    p_customer_id: requireUuid(customerId, 'Customer ID'),
  });
  if (error) throw error;
  const customer = parseCustomerProfile(data);
  if (customer.store_id !== storeId.toLowerCase()) {
    throw new TypeError('Customer profile belongs to a different store.');
  }
  return customer;
}

export async function createCustomer(command: OperationCommandV1): Promise<CustomerOperationResult> {
  return submitCustomerCommand('create_customer', command);
}

export async function updateCustomer(command: OperationCommandV1): Promise<CustomerOperationResult> {
  return submitCustomerCommand('update_customer', command);
}

export async function archiveCustomer(command: OperationCommandV1): Promise<CustomerOperationResult> {
  return submitCustomerCommand('archive_customer', command);
}

export async function associateSaleCustomer(command: OperationCommandV1): Promise<CustomerOperationResult> {
  return submitCustomerCommand('associate_sale_customer', command);
}

async function submitCustomerCommand(
  kind: 'create_customer' | 'update_customer' | 'archive_customer' | 'associate_sale_customer',
  command: OperationCommandV1,
): Promise<CustomerOperationResult> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc(kind, { p_command: command });
  if (error) throw error;
  return parseCustomerCommandResult(data, command.operation_id, kind);
}
