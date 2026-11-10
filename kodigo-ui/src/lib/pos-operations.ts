import type { OperationCommandV1, OperationJsonValue } from '@/types/operations';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJson(value: unknown, ancestors: Set<object>): OperationJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Operation payload numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('Operation payload must not contain circular references.');
    ancestors.add(value);
    const result = value.map((entry) => normalizeJson(entry, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (isPlainObject(value)) {
    if (ancestors.has(value)) throw new TypeError('Operation payload must not contain circular references.');
    ancestors.add(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Operation payload must not contain symbol keys.');
    }
    const result = Object.create(null) as Record<string, OperationJsonValue>;
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) throw new TypeError(`Operation payload field "${key}" is undefined.`);
      result[key] = normalizeJson(entry, ancestors);
    }
    ancestors.delete(value);
    return result;
  }
  throw new TypeError('Operation payload must contain only JSON values.');
}

function freezeJson<T extends OperationJsonValue>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Stable JSON for fixtures and local queue integrity; the server recomputes its own hash. */
export function canonicalOperationJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new Set()));
}

/** SHA-256 over semantic command fields; the server recomputes it and never trusts this value. */
export async function hashOperationCommand(command: OperationCommandV1): Promise<string> {
  const semanticRequest = {
    contract_version: command.contract_version,
    store_id: command.store_id,
    terminal_id: command.terminal_id,
    shift_id: command.shift_id,
    occurred_at_local: command.occurred_at_local,
    terminal_sequence: command.terminal_sequence,
    expected_version: command.expected_version,
    payload: command.payload,
  };
  return hashCanonicalOperationValue(semanticRequest);
}

export async function hashCanonicalOperationValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalOperationJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Create a command once and persist it unchanged for every retry. */
export function createOperationCommand(
  input: Omit<OperationCommandV1, 'contract_version'>,
): OperationCommandV1 {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure operation IDs are unavailable in this browser.');
  if (!isUuid(input.operation_id)) throw new TypeError('Operation ID must be a UUID.');
  if (!isUuid(input.store_id)) throw new TypeError('Store ID must be a UUID.');
  if (input.terminal_id !== null && !isUuid(input.terminal_id)) throw new TypeError('Terminal ID must be a UUID or null.');
  if (input.shift_id !== null && !isUuid(input.shift_id)) throw new TypeError('Shift ID must be a UUID or null.');
  if (input.terminal_sequence !== null && (!Number.isInteger(input.terminal_sequence) || input.terminal_sequence < 0)) {
    throw new TypeError('Terminal sequence must be a non-negative integer or null.');
  }
  if (input.expected_version !== null && (!Number.isInteger(input.expected_version) || input.expected_version < 0)) {
    throw new TypeError('Expected version must be a non-negative integer or null.');
  }
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
  if (input.occurred_at_local !== null
    && (!isoDateTime.test(input.occurred_at_local) || Number.isNaN(Date.parse(input.occurred_at_local)))) {
    throw new TypeError('Local occurrence time must be a valid ISO date-time or null.');
  }
  if (!isPlainObject(input.payload)) throw new TypeError('Operation payload must be a JSON object.');

  const command: OperationCommandV1 = Object.freeze({
    contract_version: 1,
    operation_id: input.operation_id.toLowerCase(),
    store_id: input.store_id.toLowerCase(),
    terminal_id: input.terminal_id?.toLowerCase() ?? null,
    shift_id: input.shift_id?.toLowerCase() ?? null,
    occurred_at_local: input.occurred_at_local,
    terminal_sequence: input.terminal_sequence,
    expected_version: input.expected_version,
    payload: freezeJson(normalizeJson(input.payload, new Set()) as Record<string, OperationJsonValue>),
  });
  // Validate that every envelope value can be represented by the canonical hash format.
  canonicalOperationJson(command);
  return command;
}

export function createOperationId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure operation IDs are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
