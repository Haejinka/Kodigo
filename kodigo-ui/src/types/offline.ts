import type { OfflineQueueState, OperationCommandV1 } from './operations';

export interface OfflineRecordScope {
  recordId: string;
  storeId: string;
  actorId: string;
  terminalId: string;
}

export interface WrappedOfflineMasterKey {
  version: 1;
  schema_version: 2;
  kdf: 'PBKDF2-SHA256';
  iterations: 600_000;
  store_id: string;
  actor_id: string;
  terminal_id: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface EncryptedOfflinePayload {
  version: 1;
  iv: string;
  ciphertext: string;
}

export interface OfflineQueuedOperation {
  operation_id: string;
  operation_kind: string;
  store_id: string;
  actor_id: string;
  terminal_id: string;
  terminal_sequence: number;
  payload_hash: string;
  encrypted_payload: EncryptedOfflinePayload;
  state: OfflineQueueState;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  acknowledgement_id: string | null;
  lease_id: string;
  shift_id: string;
  created_at_local: string;
  updated_at_local: string;
}

export interface OfflineTerminalMetadata {
  scope_key: string;
  store_id: string;
  actor_id: string;
  terminal_id: string;
  lease_id: string;
  next_sequence: number;
  last_acknowledged_sequence: number;
  wrapped_master_key: WrappedOfflineMasterKey;
  updated_at_local: string;
}

export interface OfflineCatalogSnapshot {
  id: string;
  store_id: string;
  product_id: string;
  catalog_version: string;
  payload: EncryptedOfflinePayload;
  captured_at_server: string;
}

export interface OfflineLeaseSnapshot {
  id: string;
  store_id: string;
  terminal_id: string;
  shift_id: string;
  cashier_id: string;
  issued_at: string;
  expires_at: string;
  last_mfa_at: string;
  state: 'active' | 'revoked' | 'expired' | 'reconciled';
  catalog_version: string;
  price_policy_hash: string;
  sequence_start: number;
  sequence_end: number;
  contract_version: number;
}

export interface OfflineStockGrant {
  id: string;
  store_id: string;
  terminal_id: string;
  lease_id: string;
  product_id: string;
  location_id: string;
  lot_id: string;
  quantity_allocated: number;
  quantity_consumed: number;
  quantity_released: number;
  state: 'active' | 'exhausted' | 'released' | 'reconciled';
  version: number;
}

export interface OfflineGrantEvent {
  id: string;
  grant_id: string;
  operation_id: string;
  kind: 'consume';
  quantity: number;
  created_at_local: string;
}

export interface OfflineOperationAck {
  operation_id: string;
  store_id: string;
  actor_id: string;
  terminal_id: string;
  terminal_sequence: number;
  payload_hash: string;
  result_hash: string;
  encrypted_result: EncryptedOfflinePayload;
  acknowledged_at_server: string;
  stored_at_local: string;
}

export interface LegacyRecoveryRecord {
  id: string;
  source_store: 'sales_queue' | 'generic_mutations';
  source_key: string;
  original_payload: unknown;
  imported_at_local: string;
  recovery_state: 'unreviewed';
}

export interface OfflineOperationPayload {
  command: OperationCommandV1;
  grant_consumptions: Array<{ grant_id: string; quantity: number }>;
}
