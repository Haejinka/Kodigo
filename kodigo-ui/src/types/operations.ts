/** JSON values accepted by the versioned command contract. */
export type OperationJsonValue =
  | null
  | boolean
  | number
  | string
  | OperationJsonValue[]
  | { [key: string]: OperationJsonValue };

/** Actor identity is deliberately absent: the server derives it from the session. */
export interface OperationCommandV1 {
  contract_version: 1;
  operation_id: string;
  store_id: string;
  terminal_id: string | null;
  shift_id: string | null;
  occurred_at_local: string | null;
  terminal_sequence: number | null;
  expected_version: number | null;
  payload: Record<string, OperationJsonValue>;
}

export interface ConfirmedOperationResult<T> {
  contract_version: 1;
  operation_id: string;
  outcome: 'confirmed' | 'pending_external';
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  confirmed_at: string;
  result: T;
}

/** Local durability is not evidence that the server accepted a command. */
export interface RecordedLocallyResult {
  outcome: 'recorded_locally';
  local_id: string;
  queue_state: OfflineQueueState;
  occurred_at_local: string;
}

export type OfflineQueueState =
  | 'local_pending'
  | 'syncing'
  | 'synchronized'
  | 'retry_wait'
  | 'conflicted'
  | 'blocked_auth'
  | 'needs_recovery';

export type OperationResult<T> = ConfirmedOperationResult<T> | RecordedLocallyResult;
