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

export interface OfflineOperationPayload {
  command: OperationCommandV1;
  grant_consumptions: Array<{ grant_id: string; quantity: number }>;
}
