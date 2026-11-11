export type SaleLineAmountBasis = 'net_item_discounted' | 'legacy_gross' | 'legacy_unknown';
export type SaleCreditKind = 'return_credit' | 'void_credit' | 'goodwill_credit';

/** Monetary facts stay as decimal strings at the database/API boundary. */
export interface SaleFinancialFacts {
  saleId: string;
  storeId: string;
  accountingVersion: number | null;
  lineAmountBasis: SaleLineAmountBasis;
  financialComplete: boolean;
  unclassifiedCount: number;
  grossBilled: string | null;
  saleDiscount: string | null;
  netBilled: string;
  postedCredits: string;
  capturedPayments: string;
  confirmedRefunds: string;
  netPaid: string;
  refundDue: string;
  settlementUnknown: boolean;
}

export interface SaleCreditAllocationInput {
  saleItemId: string;
  weight: string;
}

export interface CumulativeSaleLineCreditInput {
  soldQuantity: number;
  previouslyCreditedQuantity: number;
  requestedQuantity: number;
  originalNetAmount: string;
  previousCreditAmount: string;
  originalDiscountAmount?: string;
  previousDiscountShare?: string;
  originalVatAmount?: string;
  previousVatShare?: string;
  originalBaseQuantity?: string;
  previousBaseQuantity?: string;
  originalCogsAmount?: string;
  previousCogsRecovered?: string;
}

export interface CumulativeSaleLineCredit {
  cumulativeQuantity: number;
  amount: string;
  discountShare: string;
  vatShare: string;
  baseQuantity: string;
  cogsCapacity: string;
}
