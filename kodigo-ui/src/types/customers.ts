import type { ConfirmedOperationResult, OperationCommandV1 } from './operations';

export interface CustomerSummary {
  id: string;
  display_name: string;
}

export interface CustomerProfile extends CustomerSummary {
  store_id: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CustomerRecordResult {
  customer_id: string;
  version: number;
}

export interface CustomerSaleLinkResult {
  link_id: string;
  sale_id: string;
  customer_id: string;
  link_type: 'retroactive';
  linked_at: string;
}

export type CustomerCommandResult = CustomerRecordResult | CustomerSaleLinkResult;

export type CustomerOperationResult = ConfirmedOperationResult<CustomerCommandResult>;

export interface CustomerProfileInput {
  displayName: string;
  phone?: string | null;
  email?: string | null;
}

export interface CustomerCommandBuilderInput extends CustomerProfileInput {
  storeId: string;
  operationId?: string;
}

export interface CustomerCommandBuilderForUpdateInput extends CustomerCommandBuilderInput {
  customerId: string;
  expectedVersion: number;
}

export interface CustomerCommandBuilderForArchiveInput {
  storeId: string;
  customerId: string;
  expectedVersion: number;
  reason: string;
  operationId?: string;
}

export interface CustomerCommandBuilderForAssociationInput {
  storeId: string;
  customerId: string;
  saleId: string;
  expectedVersion: number;
  reason: string;
  operationId?: string;
}

export type CustomerOperationCommand = OperationCommandV1;
