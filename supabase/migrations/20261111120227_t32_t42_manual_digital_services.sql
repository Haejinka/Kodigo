-- T32-T42: manual digital product, e-load and GCash service recording.
-- No provider API, credential storage, or automated transfer is introduced.
-- All operations remain disabled until the existing store feature flag and
-- financial/shift release prerequisites are enabled by an approved rollout.

ALTER TABLE public.products
  ADD COLUMN kind text NOT NULL DEFAULT 'physical',
  ADD COLUMN stock_tracked boolean NOT NULL DEFAULT true,
  ADD COLUMN digital_min_face_amount numeric(14,2),
  ADD COLUMN digital_max_face_amount numeric(14,2),
  ADD COLUMN digital_additional_charge numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ADD CONSTRAINT products_kind_valid CHECK (
    kind IN ('physical', 'digital_product', 'eload', 'gcash_cash_in', 'gcash_cash_out')
  ),
  ADD CONSTRAINT products_stock_kind_match CHECK (
    (kind = 'physical' AND stock_tracked)
    OR (kind <> 'physical' AND NOT stock_tracked AND current_stock = 0)
  ),
  ADD CONSTRAINT products_digital_face_range_valid CHECK (
    (digital_min_face_amount IS NULL OR digital_min_face_amount >= 0)
    AND (digital_max_face_amount IS NULL OR digital_max_face_amount >= 0)
    AND (digital_min_face_amount IS NULL OR digital_max_face_amount IS NULL
      OR digital_min_face_amount <= digital_max_face_amount)
  ),
  ADD CONSTRAINT products_digital_charge_nonnegative CHECK (digital_additional_charge >= 0);

CREATE TABLE public.digital_provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  account_kind text NOT NULL CHECK (account_kind IN ('load', 'gcash', 'other')),
  account_label text NOT NULL,
  masked_identifier text,
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digital_provider_account_label_valid CHECK (length(btrim(account_label)) BETWEEN 1 AND 100),
  CONSTRAINT digital_provider_account_name_valid CHECK (length(btrim(provider_name)) BETWEEN 1 AND 80),
  CONSTRAINT digital_provider_account_masked_identifier_valid CHECK (
    masked_identifier IS NULL OR length(btrim(masked_identifier)) BETWEEN 1 AND 80
  ),
  CONSTRAINT digital_provider_accounts_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT digital_provider_accounts_store_name_unique UNIQUE (store_id, account_kind, account_label)
);

COMMENT ON TABLE public.digital_provider_accounts IS
  'Store-local manual provider account labels. Never stores PINs, OTPs, passwords, API keys, or transfer credentials.';

CREATE TABLE public.wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  provider_account_id uuid NOT NULL,
  wallet_type text NOT NULL CHECK (wallet_type IN ('load', 'gcash')),
  currency text NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
  account_label text NOT NULL,
  posted_balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (posted_balance >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_accounts_provider_scope_fk
    FOREIGN KEY (store_id, provider_account_id)
    REFERENCES public.digital_provider_accounts(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT wallet_accounts_label_valid CHECK (length(btrim(account_label)) BETWEEN 1 AND 100),
  CONSTRAINT wallet_accounts_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT wallet_accounts_provider_type_unique UNIQUE (store_id, provider_account_id, wallet_type)
);

CREATE TABLE public.service_fee_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  service_kind text NOT NULL CHECK (service_kind IN ('eload', 'gcash_cash_in', 'gcash_cash_out')),
  policy_code text NOT NULL CHECK (policy_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  version integer NOT NULL CHECK (version > 0),
  formula text NOT NULL CHECK (formula IN ('percent', 'flat', 'bands')),
  rate_bps integer,
  flat_amount numeric(14,2),
  minimum_amount numeric(14,2),
  maximum_amount numeric(14,2),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_fee_policy_interval_valid CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT service_fee_policy_amount_range_valid CHECK (
    (minimum_amount IS NULL OR minimum_amount >= 0)
    AND (maximum_amount IS NULL OR maximum_amount >= 0)
    AND (minimum_amount IS NULL OR maximum_amount IS NULL OR minimum_amount <= maximum_amount)
  ),
  CONSTRAINT service_fee_policy_formula_valid CHECK (
    (formula = 'percent' AND rate_bps BETWEEN 1 AND 10000 AND flat_amount IS NULL)
    OR (formula = 'flat' AND flat_amount >= 0 AND rate_bps IS NULL)
    OR (formula = 'bands' AND rate_bps IS NULL AND flat_amount IS NULL)
  ),
  CONSTRAINT service_fee_policies_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT service_fee_policy_version_unique UNIQUE (store_id, service_kind, policy_code, version)
);

CREATE INDEX service_fee_policies_lookup_idx
  ON public.service_fee_policies (store_id, service_kind, policy_code, effective_from DESC)
  WHERE active;

CREATE TABLE public.service_fee_policy_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  band_ordinal integer NOT NULL CHECK (band_ordinal > 0),
  minimum_amount numeric(14,2) NOT NULL CHECK (minimum_amount >= 0),
  maximum_amount numeric(14,2),
  formula text NOT NULL CHECK (formula IN ('percent', 'flat')),
  rate_bps integer,
  flat_amount numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_fee_bands_policy_scope_fk
    FOREIGN KEY (store_id, policy_id) REFERENCES public.service_fee_policies(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_fee_bands_range_valid CHECK (maximum_amount IS NULL OR maximum_amount >= minimum_amount),
  CONSTRAINT service_fee_bands_formula_valid CHECK (
    (formula = 'percent' AND rate_bps BETWEEN 1 AND 10000 AND flat_amount IS NULL)
    OR (formula = 'flat' AND flat_amount >= 0 AND rate_bps IS NULL)
  ),
  CONSTRAINT service_fee_bands_ordinal_unique UNIQUE (store_id, policy_id, band_ordinal)
);

CREATE TABLE public.digital_service_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  provider_account_id uuid REFERENCES public.digital_provider_accounts(id) ON DELETE RESTRICT,
  wallet_account_id uuid REFERENCES public.wallet_accounts(id) ON DELETE RESTRICT,
  fee_policy_id uuid REFERENCES public.service_fee_policies(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES public.cashier_shifts(id) ON DELETE RESTRICT,
  terminal_id uuid NOT NULL REFERENCES public.pos_terminals(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  service_kind text NOT NULL CHECK (service_kind IN ('digital_product', 'eload', 'gcash_cash_in', 'gcash_cash_out')),
  face_amount numeric(14,2) NOT NULL CHECK (face_amount >= 0),
  fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  cost_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  retail_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (retail_amount >= 0),
  additional_charge_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (additional_charge_amount >= 0),
  earning_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (earning_amount >= 0),
  fee_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fee_policy_snapshot) = 'object'),
  quote_hash text NOT NULL CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  quote_snapshot jsonb NOT NULL CHECK (jsonb_typeof(quote_snapshot) = 'object'),
  state text NOT NULL DEFAULT 'draft' CHECK (
    state IN ('draft', 'reserved', 'awaiting_cash', 'awaiting_external', 'completed',
      'needs_reconciliation', 'reversal_requested', 'awaiting_external_reversal',
      'partially_reversed', 'reversed', 'cancelled', 'failed')
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  cash_leg_state text NOT NULL DEFAULT 'not_required'
    CHECK (cash_leg_state IN ('not_required', 'pending', 'confirmed', 'unknown', 'failed')),
  provider_leg_state text NOT NULL DEFAULT 'not_required'
    CHECK (provider_leg_state IN ('not_required', 'pending', 'confirmed', 'unknown', 'failed')),
  sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT digital_service_operation_unique UNIQUE (store_id, operation_id),
  CONSTRAINT digital_service_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT digital_service_quote_fields_valid CHECK (
    (service_kind = 'digital_product' AND fee_policy_id IS NULL)
    OR (service_kind <> 'digital_product' AND fee_policy_id IS NOT NULL)
  )
);

CREATE INDEX digital_service_store_created_idx
  ON public.digital_service_transactions (store_id, created_at DESC, id DESC);
CREATE INDEX digital_service_store_state_idx
  ON public.digital_service_transactions (store_id, state, updated_at DESC);
CREATE INDEX digital_service_wallet_idx
  ON public.digital_service_transactions (store_id, wallet_account_id, created_at DESC)
  WHERE wallet_account_id IS NOT NULL;

CREATE TABLE public.wallet_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  wallet_account_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  service_id uuid,
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 160),
  movement_kind text NOT NULL CHECK (movement_kind IN (
    'opening', 'topup', 'withdrawal', 'adjustment', 'service_debit', 'service_credit', 'reversal'
  )),
  signed_amount numeric(14,2) NOT NULL CHECK (signed_amount <> 0),
  balance_before numeric(14,2) NOT NULL CHECK (balance_before >= 0),
  balance_after numeric(14,2) NOT NULL CHECK (balance_after >= 0),
  external_reference text,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_movement_balance_conservation CHECK (balance_after = balance_before + signed_amount),
  CONSTRAINT wallet_movement_wallet_scope_fk
    FOREIGN KEY (store_id, wallet_account_id) REFERENCES public.wallet_accounts(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT wallet_movement_service_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT wallet_movement_source_unique UNIQUE (store_id, operation_id, source_key, wallet_account_id)
);

CREATE INDEX wallet_movements_history_idx
  ON public.wallet_movements (store_id, wallet_account_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX wallet_movement_external_reference_unique
  ON public.wallet_movements (store_id, wallet_account_id, external_reference)
  WHERE external_reference IS NOT NULL;

CREATE TABLE public.wallet_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  wallet_account_id uuid NOT NULL,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 160),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  remaining_amount numeric(14,2) NOT NULL CHECK (remaining_amount >= 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'consumed', 'released')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_reservation_balance_valid CHECK (remaining_amount <= amount),
  CONSTRAINT wallet_reservation_wallet_scope_fk
    FOREIGN KEY (store_id, wallet_account_id) REFERENCES public.wallet_accounts(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT wallet_reservation_service_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT wallet_reservation_source_unique UNIQUE (store_id, service_id, source_key)
);

CREATE TABLE public.digital_service_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN (
    'created', 'reserved', 'cash_recorded', 'external_recorded', 'completed',
    'reconciliation_required', 'cancelled', 'reversal_requested', 'reversal_recorded'
  )),
  step text NOT NULL CHECK (length(btrim(step)) BETWEEN 1 AND 80),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digital_service_event_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT digital_service_event_operation_step_unique UNIQUE (store_id, service_id, operation_id, step)
);

CREATE INDEX digital_service_events_history_idx
  ON public.digital_service_events (store_id, service_id, created_at, id);

CREATE TABLE public.external_settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  provider_account_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  leg_kind text NOT NULL CHECK (leg_kind IN ('load_delivery', 'wallet_transfer', 'service_cost', 'reversal')),
  normalized_reference text,
  external_amount numeric(14,2) NOT NULL CHECK (external_amount > 0),
  external_at timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('confirmed', 'failed', 'unknown')),
  evidence_ref text,
  verified_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_settlement_provider_scope_fk
    FOREIGN KEY (store_id, provider_account_id)
    REFERENCES public.digital_provider_accounts(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT external_settlement_service_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT external_settlement_reference_valid CHECK (
    normalized_reference IS NULL OR (
      length(normalized_reference) BETWEEN 1 AND 160
      AND normalized_reference = btrim(normalized_reference)
      AND normalized_reference !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT external_settlement_evidence_valid CHECK (
    evidence_ref IS NULL OR (length(btrim(evidence_ref)) BETWEEN 1 AND 200 AND evidence_ref !~ '[[:cntrl:]]')
  ),
  CONSTRAINT external_settlement_confirmed_evidence CHECK (
    outcome <> 'confirmed' OR (normalized_reference IS NOT NULL AND external_at IS NOT NULL AND evidence_ref IS NOT NULL)
  )
);

CREATE UNIQUE INDEX external_settlement_confirmed_reference_unique
  ON public.external_settlement_events (store_id, provider_account_id, direction, normalized_reference)
  WHERE outcome = 'confirmed' AND normalized_reference IS NOT NULL;
CREATE UNIQUE INDEX external_settlement_operation_leg_unique
  ON public.external_settlement_events (store_id, operation_id, service_id, leg_kind, direction);
CREATE INDEX external_settlement_service_history_idx
  ON public.external_settlement_events (store_id, service_id, verified_at DESC, id DESC);

CREATE TABLE public.service_clearing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 160),
  leg_kind text NOT NULL CHECK (leg_kind IN ('cash_principal', 'provider_principal', 'service_cost', 'reversal')),
  signed_amount numeric(14,2) NOT NULL CHECK (signed_amount <> 0),
  external_event_id uuid REFERENCES public.external_settlement_events(id) ON DELETE RESTRICT,
  cash_movement_id uuid REFERENCES public.cash_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_clearing_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_clearing_source_unique UNIQUE (store_id, service_id, source_key)
);

CREATE TABLE public.retailer_earning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 160),
  earning_kind text NOT NULL CHECK (earning_kind IN ('service_earned', 'verified_reversal', 'approved_adjustment')),
  signed_amount numeric(14,2) NOT NULL CHECK (signed_amount <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retailer_earning_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT retailer_earning_source_unique UNIQUE (store_id, service_id, source_key)
);

CREATE TABLE public.reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  domain text NOT NULL CHECK (domain IN ('wallet', 'cash', 'provider', 'digital_service')),
  service_id uuid REFERENCES public.digital_service_transactions(id) ON DELETE RESTRICT,
  wallet_account_id uuid REFERENCES public.wallet_accounts(id) ON DELETE RESTRICT,
  source_operation_id uuid REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  case_kind text NOT NULL CHECK (case_kind IN ('unknown_outcome', 'balance_difference', 'partial_reversal', 'legacy_exception')),
  expected_amount numeric(14,2),
  observed_amount numeric(14,2),
  difference_amount numeric(14,2),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'under_review', 'resolved')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  raised_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_service_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_wallet_scope_fk
    FOREIGN KEY (store_id, wallet_account_id) REFERENCES public.wallet_accounts(store_id, id) ON DELETE RESTRICT
);

CREATE INDEX reconciliation_cases_queue_idx
  ON public.reconciliation_cases (store_id, state, created_at, id);

CREATE TABLE public.wallet_reconciliation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  wallet_account_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  statement_at timestamptz NOT NULL,
  statement_balance numeric(14,2) NOT NULL CHECK (statement_balance >= 0),
  ledger_balance numeric(14,2) NOT NULL CHECK (ledger_balance >= 0),
  difference_amount numeric(14,2) NOT NULL,
  evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 1 AND 200),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_statement_scope_fk
    FOREIGN KEY (store_id, wallet_account_id) REFERENCES public.wallet_accounts(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT wallet_statement_difference_valid CHECK (difference_amount = statement_balance - ledger_balance),
  CONSTRAINT wallet_statement_reference_valid CHECK (evidence_ref !~ '[[:cntrl:]]')
);

CREATE TABLE public.digital_reversal_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  requested_leg_ids uuid[] NOT NULL CHECK (cardinality(requested_leg_ids) > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  state text NOT NULL DEFAULT 'requested' CHECK (
    state IN ('requested', 'approved', 'rejected', 'partially_reversed', 'reversed', 'needs_reconciliation')
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digital_reversal_service_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT digital_reversal_requester_not_decider CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT digital_reversal_cases_store_id_unique UNIQUE (store_id, id)
);

CREATE TABLE public.digital_reversal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  reversal_case_id uuid NOT NULL,
  service_id uuid NOT NULL,
  original_event_id uuid NOT NULL REFERENCES public.external_settlement_events(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 1 AND 200),
  cash_return_attested boolean NOT NULL DEFAULT false,
  reversed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digital_reversal_case_scope_fk
    FOREIGN KEY (store_id, reversal_case_id) REFERENCES public.digital_reversal_cases(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT digital_reversal_service_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT digital_reversal_leg_unique UNIQUE (store_id, original_event_id),
  CONSTRAINT digital_reversal_evidence_valid CHECK (evidence_ref !~ '[[:cntrl:]]')
);

CREATE TABLE public.digital_reversal_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  reversal_case_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  decided_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digital_reversal_decision_case_scope_fk
    FOREIGN KEY (store_id, reversal_case_id) REFERENCES public.digital_reversal_cases(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT digital_reversal_decision_unique UNIQUE (store_id, reversal_case_id)
);

ALTER TABLE public.sale_items
  ADD COLUMN digital_service_id uuid REFERENCES public.digital_service_transactions(id) ON DELETE RESTRICT;
ALTER TABLE public.payment_service_links
  ADD CONSTRAINT payment_service_links_digital_service_fk
    FOREIGN KEY (store_id, service_id)
    REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT;

CREATE TABLE public.wallet_reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  wallet_reservation_id uuid NOT NULL REFERENCES public.wallet_reservations(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('reserved', 'consumed', 'released')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_reservation_event_service_scope_fk
    FOREIGN KEY (store_id, service_id) REFERENCES public.digital_service_transactions(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT wallet_reservation_event_source_unique UNIQUE (store_id, wallet_reservation_id, operation_id, event_kind)
);

CREATE TABLE public.service_fee_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.pos_operations(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('created', 'closed')),
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_fee_policy_event_scope_fk
    FOREIGN KEY (store_id, policy_id) REFERENCES public.service_fee_policies(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_fee_policy_event_source_unique UNIQUE (store_id, policy_id, operation_id, event_kind)
);

CREATE INDEX wallet_reservations_active_idx
  ON public.wallet_reservations (store_id, wallet_account_id, created_at)
  WHERE state = 'active';
CREATE INDEX wallet_reservation_events_history_idx
  ON public.wallet_reservation_events (store_id, wallet_reservation_id, created_at, id);

ALTER TABLE public.digital_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_fee_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_fee_policy_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_service_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_service_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reservation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_settlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_clearing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retailer_earning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reconciliation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_reversal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_reversal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_reversal_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_fee_policy_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.digital_provider_accounts, public.wallet_accounts,
  public.service_fee_policies, public.service_fee_policy_bands,
  public.digital_service_transactions, public.digital_service_events,
  public.wallet_movements, public.wallet_reservations, public.wallet_reservation_events,
  public.external_settlement_events, public.service_clearing_events, public.retailer_earning_events,
  public.reconciliation_cases, public.wallet_reconciliation_snapshots,
  public.digital_reversal_cases, public.digital_reversal_events, public.digital_reversal_decisions,
  public.service_fee_policy_events
  FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY digital_provider_accounts_api_deny
  ON public.digital_provider_accounts FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY wallet_accounts_api_deny
  ON public.wallet_accounts FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY service_fee_policies_api_deny
  ON public.service_fee_policies FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY service_fee_policy_bands_api_deny
  ON public.service_fee_policy_bands FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY digital_service_transactions_api_deny
  ON public.digital_service_transactions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY digital_service_events_api_deny
  ON public.digital_service_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY wallet_movements_api_deny
  ON public.wallet_movements FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY wallet_reservations_api_deny
  ON public.wallet_reservations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY wallet_reservation_events_api_deny
  ON public.wallet_reservation_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY external_settlement_events_api_deny
  ON public.external_settlement_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY service_clearing_events_api_deny
  ON public.service_clearing_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY retailer_earning_events_api_deny
  ON public.retailer_earning_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY reconciliation_cases_api_deny
  ON public.reconciliation_cases FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY wallet_reconciliation_snapshots_api_deny
  ON public.wallet_reconciliation_snapshots FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY digital_reversal_cases_api_deny
  ON public.digital_reversal_cases FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY digital_reversal_events_api_deny
  ON public.digital_reversal_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY digital_reversal_decisions_api_deny
  ON public.digital_reversal_decisions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY service_fee_policy_events_api_deny
  ON public.service_fee_policy_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.reject_digital_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Digital financial history is append-only'
    USING ERRCODE = '55000', DETAIL = '{"business_code":"IMMUTABLE_FACT","retryable":false}';
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_digital_catalog_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.digital_catalog_writer', true), '')::uuid;
  v_operation public.pos_operations%ROWTYPE;
BEGIN
  IF NEW.kind = 'physical' THEN
    IF NOT NEW.stock_tracked THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Physical products must track inventory.');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stock_tracked OR NEW.current_stock <> 0 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Digital products are non-stock and must have zero stock.');
  END IF;
  IF v_operation_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Digital catalog changes must use the authorized catalog command.', '42501');
  END IF;
  SELECT operation.* INTO v_operation FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id AND operation.store_id = NEW.store_id;
  IF NOT FOUND OR v_operation.status <> 'processing' OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid())
    OR v_operation.kind <> 'create_digital_service_product' THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Digital catalog writer context is invalid.');
  END IF;
  IF NEW.digital_min_face_amount IS NOT NULL AND NEW.digital_min_face_amount < 0
    OR NEW.digital_max_face_amount IS NOT NULL AND NEW.digital_max_face_amount < 0
    OR NEW.digital_min_face_amount IS NOT NULL AND NEW.digital_max_face_amount IS NOT NULL
      AND NEW.digital_min_face_amount > NEW.digital_max_face_amount
    OR NEW.digital_additional_charge < 0 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Digital catalog price bounds are invalid.');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER products_digital_catalog_guard
  BEFORE INSERT OR UPDATE
  ON public.products FOR EACH ROW EXECUTE FUNCTION private.guard_digital_catalog_product();

CREATE OR REPLACE FUNCTION private.guard_digital_service_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.digital_service_writer', true), '')::uuid;
  v_operation public.pos_operations%ROWTYPE;
  v_transition_valid boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_operation_id IS NULL OR NEW.state <> 'draft' OR NEW.version <> 1 THEN
      PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Digital service creation must use its command.', '42501');
    END IF;
    SELECT operation.* INTO v_operation FROM public.pos_operations AS operation
    WHERE operation.id = v_operation_id AND operation.store_id = NEW.store_id;
    IF NOT FOUND OR v_operation.status <> 'processing' OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid())
      OR v_operation.kind <> 'record_digital_service' OR v_operation.id <> NEW.operation_id THEN
      PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Digital service creation context is invalid.');
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE'
    OR v_operation_id IS NULL
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
    OR NEW.wallet_account_id IS DISTINCT FROM OLD.wallet_account_id
    OR NEW.fee_policy_id IS DISTINCT FROM OLD.fee_policy_id
    OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
    OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.service_kind IS DISTINCT FROM OLD.service_kind
    OR NEW.face_amount IS DISTINCT FROM OLD.face_amount
    OR NEW.fee_amount IS DISTINCT FROM OLD.fee_amount
    OR NEW.cost_amount IS DISTINCT FROM OLD.cost_amount
    OR NEW.retail_amount IS DISTINCT FROM OLD.retail_amount
    OR NEW.additional_charge_amount IS DISTINCT FROM OLD.additional_charge_amount
    OR NEW.earning_amount IS DISTINCT FROM OLD.earning_amount
    OR NEW.fee_policy_snapshot IS DISTINCT FROM OLD.fee_policy_snapshot
    OR NEW.quote_hash IS DISTINCT FROM OLD.quote_hash
    OR NEW.quote_snapshot IS DISTINCT FROM OLD.quote_snapshot
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1
    OR NEW.updated_at < OLD.updated_at THEN
    PERFORM private.raise_pos_operation_error('IMMUTABLE_FACT', 'Digital quote snapshots and service identity cannot be changed.');
  END IF;

  SELECT operation.* INTO v_operation FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id AND operation.store_id = NEW.store_id;
  IF NOT FOUND OR v_operation.status <> 'processing' OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Digital service update context is invalid.');
  END IF;

  v_transition_valid := CASE OLD.state
    WHEN 'draft' THEN NEW.state IN ('reserved', 'completed', 'needs_reconciliation', 'cancelled')
    WHEN 'reserved' THEN NEW.state IN ('awaiting_cash', 'awaiting_external', 'completed', 'needs_reconciliation', 'cancelled')
    WHEN 'awaiting_cash' THEN NEW.state IN ('awaiting_external', 'completed', 'needs_reconciliation')
    WHEN 'awaiting_external' THEN NEW.state IN ('awaiting_cash', 'completed', 'needs_reconciliation')
    WHEN 'needs_reconciliation' THEN NEW.state IN ('needs_reconciliation', 'awaiting_cash', 'awaiting_external', 'completed', 'reversal_requested')
    WHEN 'completed' THEN NEW.state = 'reversal_requested'
    WHEN 'reversal_requested' THEN NEW.state IN ('awaiting_external_reversal', 'partially_reversed', 'reversed', 'needs_reconciliation')
    WHEN 'awaiting_external_reversal' THEN NEW.state IN ('partially_reversed', 'reversed', 'needs_reconciliation')
    WHEN 'partially_reversed' THEN NEW.state IN ('awaiting_external_reversal', 'reversed', 'needs_reconciliation')
    ELSE false
  END;
  IF NOT v_transition_valid THEN
    PERFORM private.raise_pos_operation_error('INVALID_STATE_TRANSITION', 'Digital service state transition is not allowed.');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER digital_service_lifecycle_guard
  BEFORE INSERT OR UPDATE ON public.digital_service_transactions
  FOR EACH ROW EXECUTE FUNCTION private.guard_digital_service_lifecycle();

CREATE OR REPLACE FUNCTION private.guard_wallet_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.wallet_writer', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.posted_balance <> 0 OR NEW.version <> 1 THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Wallets start at zero and require an evidenced ledger opening.');
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id IS DISTINCT FROM OLD.store_id
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
      OR NEW.wallet_type IS DISTINCT FROM OLD.wallet_type
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.account_label IS DISTINCT FROM OLD.account_label
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      PERFORM private.raise_pos_operation_error('IMMUTABLE_FACT', 'Wallet identity is immutable.');
    END IF;
    IF NEW.posted_balance IS DISTINCT FROM OLD.posted_balance
      OR NEW.version IS DISTINCT FROM OLD.version THEN
      IF v_operation_id IS NULL OR NEW.version <> OLD.version + 1 THEN
        PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Wallet balance changes must use an authorized ledger command.', '42501');
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM private.raise_pos_operation_error('IMMUTABLE_FACT', 'Wallet accounts cannot be deleted.');
  RETURN OLD;
END;
$function$;

CREATE TRIGGER wallet_projection_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.wallet_accounts
  FOR EACH ROW EXECUTE FUNCTION private.guard_wallet_projection();

CREATE OR REPLACE FUNCTION private.guard_wallet_reservation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.wallet_writer', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_operation_id IS NULL OR NEW.state <> 'active' OR NEW.remaining_amount <> NEW.amount THEN
      PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Wallet reservations must be created through a service command.', '42501');
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF v_operation_id IS NULL OR NEW.store_id IS DISTINCT FROM OLD.store_id
      OR NEW.wallet_account_id IS DISTINCT FROM OLD.wallet_account_id
      OR NEW.service_id IS DISTINCT FROM OLD.service_id
      OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
      OR NEW.source_key IS DISTINCT FROM OLD.source_key
      OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.reason IS DISTINCT FROM OLD.reason
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.version <> OLD.version + 1
      OR NEW.remaining_amount > OLD.remaining_amount
      OR (OLD.state <> 'active' AND NEW.state IS DISTINCT FROM OLD.state) THEN
      PERFORM private.raise_pos_operation_error('IMMUTABLE_FACT', 'Wallet reservation identity or lifecycle is invalid.');
    END IF;
    IF NEW.state NOT IN ('active', 'consumed', 'released')
      OR (NEW.state = 'active' AND NEW.remaining_amount = 0)
      OR (NEW.state IN ('consumed', 'released') AND NEW.remaining_amount <> 0) THEN
      PERFORM private.raise_pos_operation_error('INVALID_STATE_TRANSITION', 'Wallet reservation state is invalid.');
    END IF;
    RETURN NEW;
  END IF;
  PERFORM private.raise_pos_operation_error('IMMUTABLE_FACT', 'Wallet reservations cannot be deleted.');
  RETURN OLD;
END;
$function$;

CREATE TRIGGER wallet_reservation_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.wallet_reservations
  FOR EACH ROW EXECUTE FUNCTION private.guard_wallet_reservation_lifecycle();

CREATE OR REPLACE FUNCTION private.guard_service_fee_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.effective_to IS NULL
    AND NEW.effective_to IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.store_id = OLD.store_id
    AND NEW.service_kind = OLD.service_kind
    AND NEW.policy_code = OLD.policy_code
    AND NEW.version = OLD.version
    AND NEW.formula = OLD.formula
    AND NEW.rate_bps IS NOT DISTINCT FROM OLD.rate_bps
    AND NEW.flat_amount IS NOT DISTINCT FROM OLD.flat_amount
    AND NEW.minimum_amount IS NOT DISTINCT FROM OLD.minimum_amount
    AND NEW.maximum_amount IS NOT DISTINCT FROM OLD.maximum_amount
    AND NEW.effective_from = OLD.effective_from
    AND NEW.is_default = OLD.is_default
    AND NEW.active = OLD.active
    AND NEW.created_by = OLD.created_by
    AND NEW.created_at = OLD.created_at
    AND NULLIF(pg_catalog.current_setting('kodigo.fee_policy_writer', true), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Service fee policy versions are immutable; create a new version'
    USING ERRCODE = '55000', DETAIL = '{"business_code":"IMMUTABLE_POLICY","retryable":false}';
END;
$function$;

CREATE TRIGGER service_fee_policy_immutable
  BEFORE UPDATE OR DELETE ON public.service_fee_policies
  FOR EACH ROW EXECUTE FUNCTION private.guard_service_fee_policy();

CREATE OR REPLACE FUNCTION private.guard_sale_item_digital_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_kind text;
  v_sale_store uuid;
  v_service public.digital_service_transactions%ROWTYPE;
  v_writer uuid := NULLIF(pg_catalog.current_setting('kodigo.digital_service_writer', true), '')::uuid;
BEGIN
  SELECT sale.store_id INTO v_sale_store FROM public.sales AS sale WHERE sale.id = NEW.sale_id;
  SELECT product.kind INTO v_kind FROM public.products AS product
  WHERE product.id = NEW.product_id AND product.store_id = v_sale_store;
  IF v_kind IS NULL THEN
    PERFORM private.raise_pos_operation_error('PRODUCT_NOT_FOUND', 'Sale product does not belong to its store.', '23503');
  END IF;
  IF v_kind = 'physical' THEN
    IF NEW.digital_service_id IS NOT NULL THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Physical sale lines cannot reference digital services.');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.digital_service_id IS NULL OR v_writer IS NULL
    OR NEW.operation_id IS DISTINCT FROM v_writer THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Non-stock products can only be sold by digital service completion.', '42501');
  END IF;
  SELECT service.* INTO v_service FROM public.digital_service_transactions AS service
  WHERE service.id = NEW.digital_service_id AND service.store_id = v_sale_store;
  IF NOT FOUND OR v_service.product_id <> NEW.product_id
    OR v_service.state NOT IN ('reserved', 'awaiting_cash', 'awaiting_external')
    OR v_service.service_kind <> v_kind
    OR NOT EXISTS (
      SELECT 1 FROM public.pos_operations AS operation
      WHERE operation.id = v_writer AND operation.store_id = v_sale_store
        AND operation.status = 'processing' AND operation.kind = 'complete_digital_service'
        AND operation.actor_id = (SELECT auth.uid())
    ) THEN
    PERFORM private.raise_pos_operation_error('SALE_INELIGIBLE', 'Digital sale line does not match an authorized service completion.');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER sale_items_digital_service_guard
  BEFORE INSERT OR UPDATE
  ON public.sale_items FOR EACH ROW EXECUTE FUNCTION private.guard_sale_item_digital_service();

CREATE OR REPLACE FUNCTION private.ensure_live_product_inventory_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
BEGIN
  IF NOT NEW.stock_tracked OR NEW.kind <> 'physical' THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = NEW.store_id AND cutover.status = 'complete'
  ) THEN
    SELECT location.id INTO v_location_id FROM public.inventory_locations AS location
    WHERE location.store_id = NEW.store_id AND location.kind = 'sellable'
      AND location.is_default AND location.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Store has no active default sellable inventory location'; END IF;
    INSERT INTO public.inventory_balances (store_id, product_id, location_id, quantity_on_hand, provenance)
    VALUES (NEW.store_id, NEW.id, v_location_id, 0, 'live')
    ON CONFLICT (store_id, product_id, location_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.allocate_sale_item_stock_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_store_id uuid;
  v_product public.products%ROWTYPE;
  v_lot public.inventory_stock_lots%ROWTYPE;
  v_remaining numeric := COALESCE(NEW.base_unit_quantity, NEW.quantity, 0);
  v_take numeric;
  v_total_cost numeric := 0;
  v_has_owned boolean := false;
  v_has_consigned boolean := false;
BEGIN
  SELECT sale.store_id INTO v_store_id FROM public.sales AS sale WHERE sale.id = NEW.sale_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Sale % does not exist', NEW.sale_id; END IF;
  SELECT product.* INTO v_product FROM public.products AS product
  WHERE product.id = NEW.product_id AND product.store_id = v_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale product does not belong to its store'; END IF;
  IF v_product.kind <> 'physical' OR NOT v_product.stock_tracked THEN
    IF NEW.digital_service_id IS NULL
      OR NULLIF(pg_catalog.current_setting('kodigo.digital_service_writer', true), '') IS DISTINCT FROM NEW.operation_id::text THEN
      RAISE EXCEPTION 'Non-stock line must use digital service completion'
        USING ERRCODE = '42501', DETAIL = '{"business_code":"CAPABILITY_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN
    IF NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '') IS NULL THEN
      RAISE EXCEPTION 'This client must be upgraded to the ledger checkout command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'Sale line has no base-unit quantity'; END IF;
  FOR v_lot IN
    SELECT lot.* FROM public.inventory_stock_lots AS lot
    WHERE lot.store_id = v_store_id AND lot.product_id = NEW.product_id AND lot.quantity_remaining > 0
    ORDER BY lot.received_at, lot.id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_lot.quantity_remaining, v_remaining);
    UPDATE public.inventory_stock_lots AS lot
    SET quantity_remaining = lot.quantity_remaining - v_take, quantity_sold = lot.quantity_sold + v_take
    WHERE lot.store_id = v_store_id AND lot.id = v_lot.id;
    INSERT INTO public.sale_item_stock_allocations (
      store_id, sale_item_id, lot_id, quantity_base_units, unit_cost, ownership, supplier_id
    ) VALUES (
      v_store_id, NEW.id, v_lot.id, v_take, v_lot.unit_cost, v_lot.ownership, v_lot.supplier_id
    );
    v_total_cost := v_total_cost + v_take * v_lot.unit_cost;
    v_has_owned := v_has_owned OR v_lot.ownership = 'store_owned';
    v_has_consigned := v_has_consigned OR v_lot.ownership = 'consigned';
    v_remaining := v_remaining - v_take;
  END LOOP;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Inventory ownership lots are short by % base units for product %', v_remaining, NEW.product_id;
  END IF;
  NEW.cost_per_base_unit := CASE WHEN COALESCE(NEW.base_unit_quantity, 0) > 0
    THEN v_total_cost / NEW.base_unit_quantity ELSE 0 END;
  NEW.cogs := v_total_cost;
  NEW.cost_price := CASE WHEN COALESCE(NEW.quantity, 0) > 0 THEN v_total_cost / NEW.quantity ELSE 0 END;
  NEW.gross_profit := NEW.line_total - v_total_cost;
  NEW.gross_margin := CASE WHEN NEW.line_total > 0 THEN (NEW.line_total - v_total_cost) / NEW.line_total ELSE 0 END;
  NEW.stock_source := CASE WHEN v_has_owned AND v_has_consigned THEN 'mixed'
    WHEN v_has_consigned THEN 'consigned' ELSE 'product' END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_store uuid;
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_location_id uuid;
  v_operation_id uuid;
  v_multiplier numeric := 1;
  v_required_base numeric;
  v_before numeric;
  v_after numeric;
  v_expected_version bigint;
BEGIN
  SELECT sale.store_id INTO v_sale_store FROM public.sales AS sale WHERE sale.id = NEW.sale_id;
  IF v_sale_store IS NULL THEN RAISE EXCEPTION 'Sale % does not exist', NEW.sale_id; END IF;
  SELECT product.* INTO v_product FROM public.products AS product
  WHERE product.id = NEW.product_id AND product.store_id = v_sale_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale product does not belong to its store'; END IF;
  IF v_product.kind <> 'physical' OR NOT v_product.stock_tracked THEN
    IF NEW.digital_service_id IS NULL
      OR NULLIF(pg_catalog.current_setting('kodigo.digital_service_writer', true), '') IS DISTINCT FROM NEW.operation_id::text THEN
      RAISE EXCEPTION 'Non-stock line must use digital service completion'
        USING ERRCODE = '42501', DETAIL = '{"business_code":"CAPABILITY_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_sale_store AND cutover.status = 'complete'
  ) THEN
    v_operation_id := NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '')::uuid;
    IF v_operation_id IS NULL THEN
      RAISE EXCEPTION 'This client must be upgraded to the ledger checkout command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    SELECT location.id INTO v_location_id FROM public.inventory_locations AS location
    WHERE location.store_id = v_sale_store AND location.kind = 'sellable'
      AND location.is_default AND location.is_active;
    SELECT balance.* INTO v_balance FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_sale_store AND balance.product_id = NEW.product_id
      AND balance.location_id = v_location_id AND balance.provenance = 'live' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A live product balance is missing for sale item %', NEW.id
        USING ERRCODE = '55000', DETAIL = '{"business_code":"INVENTORY_RECONCILIATION_REQUIRED","retryable":false}';
    END IF;
    v_expected_version := v_balance.version;
    PERFORM private.allocate_sale_lots(pg_catalog.jsonb_build_object(
      'store_id', v_sale_store, 'sale_id', NEW.sale_id, 'sale_item_id', NEW.id,
      'operation_id', v_operation_id, 'location_id', v_location_id,
      'source_line_key', NEW.id::text, 'expected_balance_version', v_expected_version
    ));
    RETURN NEW;
  END IF;
  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT option_row.* INTO v_option FROM public.product_selling_options AS option_row
    WHERE option_row.id = NEW.selling_option_id FOR UPDATE;
    IF NOT FOUND OR v_option.product_id <> NEW.product_id OR v_option.store_id <> v_sale_store OR NOT v_option.is_active THEN
      RAISE EXCEPTION 'Selling option does not belong to an active sale product/store';
    END IF;
    v_multiplier := CASE WHEN v_option.is_bulk
      THEN GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2) ELSE 1 END;
  END IF;
  v_required_base := NEW.quantity * v_multiplier;
  IF v_product.current_stock < v_required_base THEN
    RAISE EXCEPTION 'Insufficient base stock for %. Available base units %, required base units %',
      v_product.name, v_product.current_stock, v_required_base;
  END IF;
  v_before := v_product.current_stock;
  v_after := round(v_before - v_required_base);
  UPDATE public.products AS product SET current_stock = v_after, updated_at = now() WHERE product.id = NEW.product_id;
  PERFORM private.sync_shared_option_stock(NEW.product_id, v_after);
  NEW.stock_source := 'product';
  INSERT INTO public.inventory_movements (
    store_id, product_id, product_name, selling_option_id, selling_option_label, unit_label,
    package_size, package_unit, movement_type, quantity_delta, stock_before, stock_after,
    stock_source, reference_type, reference_id, note, created_by
  ) VALUES (
    v_sale_store, NEW.product_id, NEW.product_name, NEW.selling_option_id,
    COALESCE(NEW.selling_option_label, v_option.label, v_product.unit),
    COALESCE(NEW.unit_label, v_product.unit, 'unit'),
    CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
    CASE WHEN v_multiplier > 1 THEN COALESCE(v_product.unit, 'unit') ELSE NULL END,
    'sale', -v_required_base, v_before, v_after, 'product', 'sale', NEW.sale_id,
    'POS sale ' || NEW.sale_id::text, (SELECT auth.uid())
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.reject_digital_fact_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_digital_catalog_product() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_digital_service_lifecycle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_wallet_projection() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_wallet_reservation_lifecycle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_service_fee_policy() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_sale_item_digital_service() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.ensure_live_product_inventory_balance() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.allocate_sale_item_stock_lots() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_deduct_stock_on_sale() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER wallet_movements_append_only
  BEFORE UPDATE OR DELETE ON public.wallet_movements
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER wallet_reservation_events_append_only
  BEFORE UPDATE OR DELETE ON public.wallet_reservation_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER digital_service_events_append_only
  BEFORE UPDATE OR DELETE ON public.digital_service_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER external_settlement_events_append_only
  BEFORE UPDATE OR DELETE ON public.external_settlement_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER service_clearing_events_append_only
  BEFORE UPDATE OR DELETE ON public.service_clearing_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER retailer_earning_events_append_only
  BEFORE UPDATE OR DELETE ON public.retailer_earning_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER wallet_reconciliation_snapshots_append_only
  BEFORE UPDATE OR DELETE ON public.wallet_reconciliation_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER digital_reversal_events_append_only
  BEFORE UPDATE OR DELETE ON public.digital_reversal_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER digital_reversal_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.digital_reversal_decisions
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER service_fee_policy_bands_append_only
  BEFORE UPDATE OR DELETE ON public.service_fee_policy_bands
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();
CREATE TRIGGER service_fee_policy_events_append_only
  BEFORE UPDATE OR DELETE ON public.service_fee_policy_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_digital_fact_mutation();

-- Fee policy defaults are created once per store by the first provider-account
-- setup. Later fee changes are new versions and service rows retain snapshots.
CREATE OR REPLACE FUNCTION private.seed_digital_fee_policies(
  p_store_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_policy_id uuid;
BEGIN
  PERFORM pg_catalog.set_config('kodigo.fee_policy_writer', p_operation_id::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.service_fee_policies AS p WHERE p.store_id = p_store_id AND p.policy_code = 'eload_2_commission' AND p.active) THEN
    INSERT INTO public.service_fee_policies (store_id, service_kind, policy_code, version, formula, rate_bps, minimum_amount, effective_from, is_default, created_by)
    VALUES (p_store_id, 'eload', 'eload_2_commission', 1, 'percent', 200, 0, pg_catalog.statement_timestamp(), true, p_actor_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_fee_policies AS p WHERE p.store_id = p_store_id AND p.policy_code = 'cashin_3' AND p.active) THEN
    INSERT INTO public.service_fee_policies (store_id, service_kind, policy_code, version, formula, rate_bps, minimum_amount, effective_from, is_default, created_by)
    VALUES (p_store_id, 'gcash_cash_in', 'cashin_3', 1, 'percent', 300, 0, pg_catalog.statement_timestamp(), true, p_actor_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_fee_policies AS p WHERE p.store_id = p_store_id AND p.policy_code = 'cashin_percent_2' AND p.active) THEN
    INSERT INTO public.service_fee_policies (store_id, service_kind, policy_code, version, formula, rate_bps, minimum_amount, effective_from, is_default, created_by)
    VALUES (p_store_id, 'gcash_cash_in', 'cashin_percent_2', 1, 'percent', 200, 0, pg_catalog.statement_timestamp(), false, p_actor_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_fee_policies AS p WHERE p.store_id = p_store_id AND p.policy_code = 'cashout_standard' AND p.active) THEN
    INSERT INTO public.service_fee_policies (store_id, service_kind, policy_code, version, formula, minimum_amount, effective_from, is_default, created_by)
    VALUES (p_store_id, 'gcash_cash_out', 'cashout_standard', 1, 'bands', 50, pg_catalog.statement_timestamp(), true, p_actor_id)
    RETURNING id INTO v_policy_id;
    INSERT INTO public.service_fee_policy_bands (store_id, policy_id, band_ordinal, minimum_amount, maximum_amount, formula, flat_amount)
    VALUES (p_store_id, v_policy_id, 1, 50, 100, 'flat', 2),
      (p_store_id, v_policy_id, 2, 100.01, NULL, 'flat', 4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_fee_policies AS p WHERE p.store_id = p_store_id AND p.policy_code = 'cashout_percent_2' AND p.active) THEN
    INSERT INTO public.service_fee_policies (store_id, service_kind, policy_code, version, formula, rate_bps, minimum_amount, effective_from, is_default, created_by)
    VALUES (p_store_id, 'gcash_cash_out', 'cashout_percent_2', 1, 'percent', 200, 50, pg_catalog.statement_timestamp(), false, p_actor_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.digital_service_quote(
  p_store_id uuid,
  p_product_id uuid,
  p_service_kind text,
  p_face_amount numeric,
  p_policy_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_policy public.service_fee_policies%ROWTYPE;
  v_band public.service_fee_policy_bands%ROWTYPE;
  v_fee numeric(14,2) := 0;
  v_cost numeric(14,2) := 0;
  v_retail numeric(14,2) := 0;
  v_earning numeric(14,2) := 0;
  v_wallet_delta numeric(14,2) := 0;
  v_cash_delta numeric(14,2) := 0;
  v_now timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_face_amount IS NULL OR p_face_amount <= 0 OR p_face_amount <> pg_catalog.round(p_face_amount, 2)
    OR p_face_amount >= 1000000000000::numeric THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Service amount must be greater than zero and have at most two decimals.');
  END IF;
  SELECT product.* INTO v_product FROM public.products AS product
  WHERE product.store_id = p_store_id AND product.id = p_product_id AND product.is_active;
  IF NOT FOUND OR v_product.kind IS DISTINCT FROM p_service_kind OR v_product.stock_tracked OR v_product.current_stock <> 0 THEN
    PERFORM private.raise_pos_operation_error('PRODUCT_NOT_FOUND', 'An active non-stock product for this service type is required.', '23503');
  END IF;
  IF (v_product.digital_min_face_amount IS NOT NULL AND p_face_amount < v_product.digital_min_face_amount)
    OR (v_product.digital_max_face_amount IS NOT NULL AND p_face_amount > v_product.digital_max_face_amount) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Amount is outside this service product range.');
  END IF;
  IF p_service_kind = 'digital_product' THEN
    IF pg_catalog.round(p_face_amount, 2) <> pg_catalog.round(v_product.selling_price, 2) THEN
      PERFORM private.raise_pos_operation_error('QUOTE_CHANGED', 'Digital product price changed; refresh the quote.');
    END IF;
    v_cost := pg_catalog.round(v_product.cost_price, 2);
    v_retail := pg_catalog.round(v_product.selling_price, 2);
    v_earning := GREATEST(v_retail - v_cost, 0);
    RETURN pg_catalog.jsonb_build_object('service_kind', p_service_kind, 'face_amount', p_face_amount::text,
      'fee_amount', '0.00', 'cost_amount', v_cost::text, 'retail_amount', v_retail::text,
      'additional_charge_amount', '0.00', 'earning_amount', v_earning::text, 'wallet_delta', '0.00',
      'cash_delta', v_retail::text, 'fee_policy_id', NULL, 'policy_code', NULL, 'policy_version', NULL,
      'fee_policy_snapshot', '{}'::jsonb);
  END IF;

  SELECT policy.* INTO v_policy FROM public.service_fee_policies AS policy
  WHERE policy.store_id = p_store_id AND policy.service_kind = p_service_kind
    AND policy.active AND policy.effective_from <= v_now
    AND (policy.effective_to IS NULL OR policy.effective_to > v_now)
    AND (policy.policy_code = p_policy_code OR (p_policy_code IS NULL AND policy.is_default))
  ORDER BY policy.version DESC LIMIT 1;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('FEE_POLICY_NOT_FOUND', 'No active fee policy is configured for this service.');
  END IF;
  IF v_policy.minimum_amount IS NOT NULL AND p_face_amount < v_policy.minimum_amount
    OR v_policy.maximum_amount IS NOT NULL AND p_face_amount > v_policy.maximum_amount THEN
    PERFORM private.raise_pos_operation_error('UNSUPPORTED_AMOUNT', 'Amount is outside the selected fee policy range.');
  END IF;
  IF v_policy.formula = 'bands' THEN
    SELECT band.* INTO v_band FROM public.service_fee_policy_bands AS band
    WHERE band.store_id = p_store_id AND band.policy_id = v_policy.id
      AND p_face_amount >= band.minimum_amount
      AND (band.maximum_amount IS NULL OR p_face_amount <= band.maximum_amount)
    ORDER BY band.band_ordinal LIMIT 1;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('UNSUPPORTED_AMOUNT', 'Amount is not covered by the selected fee bands.');
    END IF;
    v_fee := CASE WHEN v_band.formula = 'flat' THEN v_band.flat_amount
      ELSE pg_catalog.round(p_face_amount * v_band.rate_bps / 10000.0, 2) END;
  ELSE
    v_fee := CASE WHEN v_policy.formula = 'flat' THEN v_policy.flat_amount
      ELSE pg_catalog.round(p_face_amount * v_policy.rate_bps / 10000.0, 2) END;
  END IF;
  IF p_service_kind = 'eload' THEN
    v_cost := pg_catalog.round(p_face_amount * (1 - v_policy.rate_bps / 10000.0), 2);
    v_fee := 0;
    v_retail := pg_catalog.round(p_face_amount + v_product.digital_additional_charge, 2);
    v_earning := GREATEST(v_retail - v_cost, 0);
    v_wallet_delta := -v_cost;
    v_cash_delta := v_retail;
  ELSIF p_service_kind = 'gcash_cash_in' THEN
    v_cost := p_face_amount;
    v_retail := v_fee;
    v_earning := v_fee;
    v_wallet_delta := -p_face_amount;
    v_cash_delta := pg_catalog.round(p_face_amount + v_fee, 2);
  ELSE
    v_cost := 0;
    v_retail := v_fee;
    v_earning := v_fee;
    v_wallet_delta := pg_catalog.round(p_face_amount + v_fee, 2);
    v_cash_delta := -p_face_amount;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'service_kind', p_service_kind, 'face_amount', p_face_amount::text,
    'fee_amount', v_fee::text, 'cost_amount', v_cost::text, 'retail_amount', v_retail::text,
    'additional_charge_amount', CASE WHEN p_service_kind = 'eload' THEN v_product.digital_additional_charge::text ELSE '0.00' END,
    'earning_amount', v_earning::text, 'wallet_delta', v_wallet_delta::text, 'cash_delta', v_cash_delta::text,
    'fee_policy_id', v_policy.id, 'policy_code', v_policy.policy_code, 'policy_version', v_policy.version,
    'fee_policy_snapshot', pg_catalog.jsonb_build_object(
      'id', v_policy.id, 'service_kind', v_policy.service_kind, 'policy_code', v_policy.policy_code,
      'version', v_policy.version, 'formula', v_policy.formula, 'rate_bps', v_policy.rate_bps,
      'flat_amount', v_policy.flat_amount, 'minimum_amount', v_policy.minimum_amount,
      'maximum_amount', v_policy.maximum_amount, 'effective_from', v_policy.effective_from,
      'effective_to', v_policy.effective_to, 'band', CASE WHEN v_band.id IS NULL THEN NULL ELSE
        pg_catalog.jsonb_build_object('ordinal', v_band.band_ordinal, 'minimum_amount', v_band.minimum_amount,
          'maximum_amount', v_band.maximum_amount, 'formula', v_band.formula,
          'rate_bps', v_band.rate_bps, 'flat_amount', v_band.flat_amount) END
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.quote_digital_service(
  p_store_id uuid,
  p_product_id uuid,
  p_service_kind text,
  p_face_amount numeric,
  p_policy_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_belongs_to_store(p_store_id)
    OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'A valid signed-in store session is required.', '42501');
  END IF;
  RETURN private.digital_service_quote(p_store_id, p_product_id, p_service_kind, p_face_amount, p_policy_code);
END;
$function$;

CREATE OR REPLACE FUNCTION private.post_digital_wallet_movement(
  p_store_id uuid,
  p_wallet_id uuid,
  p_operation_id uuid,
  p_service_id uuid,
  p_source_key text,
  p_movement_kind text,
  p_amount numeric,
  p_reference text,
  p_reason text
)
RETURNS public.wallet_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_wallet public.wallet_accounts%ROWTYPE;
  v_available numeric(14,2);
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_movement public.wallet_movements%ROWTYPE;
BEGIN
  SELECT wallet.* INTO v_wallet FROM public.wallet_accounts AS wallet
  WHERE wallet.store_id = p_store_id AND wallet.id = p_wallet_id AND wallet.active FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('WALLET_NOT_FOUND', 'An active wallet for this service is required.', '23503');
  END IF;
  SELECT wallet.posted_balance - COALESCE((SELECT pg_catalog.sum(reservation.remaining_amount)
    FROM public.wallet_reservations AS reservation
    WHERE reservation.store_id = wallet.store_id AND reservation.wallet_account_id = wallet.id
      AND reservation.state = 'active'), 0)
  INTO v_available FROM public.wallet_accounts AS wallet
  WHERE wallet.store_id = p_store_id AND wallet.id = p_wallet_id;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount <> pg_catalog.round(p_amount, 2)
    OR p_amount >= 1000000000000::numeric THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Wallet movement must be a nonzero amount with at most two decimals.');
  END IF;
  IF p_amount < 0 AND v_available < -p_amount THEN
    PERFORM private.raise_pos_operation_error('INSUFFICIENT_WALLET_BALANCE', 'The recorded service exceeds the wallet balance available after active holds.', '23514');
  END IF;
  v_before := v_wallet.posted_balance;
  v_after := v_before + p_amount;
  IF v_after < 0 THEN
    PERFORM private.raise_pos_operation_error('INSUFFICIENT_WALLET_BALANCE', 'The wallet balance cannot become negative.', '23514');
  END IF;
  PERFORM pg_catalog.set_config('kodigo.wallet_writer', p_operation_id::text, true);
  UPDATE public.wallet_accounts AS wallet
  SET posted_balance = v_after, version = wallet.version + 1, updated_at = pg_catalog.clock_timestamp()
  WHERE wallet.store_id = p_store_id AND wallet.id = p_wallet_id;
  INSERT INTO public.wallet_movements (
    store_id, wallet_account_id, operation_id, service_id, source_key, movement_kind,
    signed_amount, balance_before, balance_after, external_reference, reason, actor_id
  ) VALUES (
    p_store_id, p_wallet_id, p_operation_id, p_service_id, p_source_key, p_movement_kind,
    p_amount, v_before, v_after, p_reference, p_reason, (SELECT auth.uid())
  ) RETURNING * INTO v_movement;
  RETURN v_movement;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_digital_provider_account(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor uuid := (SELECT auth.uid());
  v_payload jsonb;
  v_kind text;
  v_account public.digital_provider_accounts%ROWTYPE;
  v_wallet public.wallet_accounts%ROWTYPE;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('create_digital_provider_account', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'operations_v2');
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 4
    OR NOT (v_payload ?& ARRAY['provider_name', 'account_kind', 'account_label', 'masked_identifier'])
    OR pg_catalog.jsonb_typeof(v_payload->'provider_name') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'account_kind') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'account_label') <> 'string'
    OR (v_payload->'masked_identifier' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'masked_identifier') <> 'string') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Provider account fields are invalid.');
  END IF;
  v_kind := v_payload->>'account_kind';
  IF v_kind NOT IN ('load', 'gcash', 'other') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Provider account kind must be load, gcash, or other.');
  END IF;
  IF pg_catalog.length(pg_catalog.btrim(v_payload->>'provider_name')) NOT BETWEEN 1 AND 80
    OR pg_catalog.length(pg_catalog.btrim(v_payload->>'account_label')) NOT BETWEEN 1 AND 100
    OR COALESCE(pg_catalog.length(pg_catalog.btrim(v_payload->>'masked_identifier')), 0) > 80 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Provider name, label, or masked identifier length is invalid.');
  END IF;
  IF COALESCE(v_payload->>'masked_identifier', '') ~ '[[:cntrl:]]' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Masked identifier cannot contain control characters.');
  END IF;
  INSERT INTO public.digital_provider_accounts (
    store_id, provider_name, account_kind, account_label, masked_identifier, created_by
  ) VALUES (
    v_operation.store_id, pg_catalog.btrim(v_payload->>'provider_name'), v_kind,
    pg_catalog.btrim(v_payload->>'account_label'), NULLIF(pg_catalog.btrim(COALESCE(v_payload->>'masked_identifier', '')), ''), v_actor
  ) RETURNING * INTO v_account;
  IF v_kind IN ('load', 'gcash') THEN
    PERFORM private.seed_digital_fee_policies(v_operation.store_id, v_actor, v_operation.id);
    PERFORM pg_catalog.set_config('kodigo.wallet_writer', v_operation.id::text, true);
    INSERT INTO public.wallet_accounts (store_id, provider_account_id, wallet_type, account_label, created_by)
    VALUES (v_operation.store_id, v_account.id, v_kind, v_account.account_label, v_actor)
    RETURNING * INTO v_wallet;
  END IF;
  v_result := pg_catalog.jsonb_build_object('provider_account_id', v_account.id,
    'wallet_account_id', v_wallet.id, 'account_kind', v_kind, 'account_label', v_account.account_label,
    'masked_identifier', v_account.masked_identifier, 'wallet_balance', COALESCE(v_wallet.posted_balance, 0)::text);
  RETURN private.finish_pos_operation(v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'digital_provider_account', v_account.id::text,
    v_account.version, v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_digital_service_product(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor uuid := (SELECT auth.uid());
  v_payload jsonb;
  v_kind text;
  v_product public.products%ROWTYPE;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('create_digital_service_product', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'operations_v2');
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 9
    OR NOT (v_payload ?& ARRAY['kind', 'name', 'sku', 'category_id', 'selling_price', 'cost_price', 'min_face_amount', 'max_face_amount', 'additional_charge'])
    OR pg_catalog.jsonb_typeof(v_payload->'kind') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'name') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'sku') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'category_id') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'selling_price') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'cost_price') <> 'string'
    OR (v_payload->'min_face_amount' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'min_face_amount') <> 'string')
    OR (v_payload->'max_face_amount' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'max_face_amount') <> 'string')
    OR pg_catalog.jsonb_typeof(v_payload->'additional_charge') <> 'string' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Digital product fields are incomplete or malformed.');
  END IF;
  v_kind := v_payload->>'kind';
  IF v_kind NOT IN ('digital_product', 'eload', 'gcash_cash_in', 'gcash_cash_out')
    OR pg_catalog.length(pg_catalog.btrim(v_payload->>'name')) NOT BETWEEN 1 AND 120
    OR pg_catalog.length(pg_catalog.btrim(v_payload->>'sku')) NOT BETWEEN 1 AND 80
    OR (v_payload->>'sku') ~ '[[:cntrl:]]' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Digital service kind, name, or SKU is invalid.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.categories AS category
    JOIN public.stores AS store ON store.owner_id = category.owner_id
    WHERE category.id = (v_payload->>'category_id')::uuid AND store.id = v_operation.store_id
  ) THEN
    PERFORM private.raise_pos_operation_error('CATEGORY_NOT_FOUND', 'Select a category assigned to this store owner.', '23503');
  END IF;
  IF (v_payload->>'selling_price')::numeric < 0 OR (v_payload->>'cost_price')::numeric < 0
    OR (v_payload->>'additional_charge')::numeric < 0
    OR (v_payload->>'selling_price')::numeric <> pg_catalog.round((v_payload->>'selling_price')::numeric, 2)
    OR (v_payload->>'cost_price')::numeric <> pg_catalog.round((v_payload->>'cost_price')::numeric, 2)
    OR (v_payload->>'additional_charge')::numeric <> pg_catalog.round((v_payload->>'additional_charge')::numeric, 2)
    OR (v_payload->>'selling_price')::numeric >= 1000000000000::numeric
    OR (v_payload->>'cost_price')::numeric >= 1000000000000::numeric
    OR (v_payload->>'additional_charge')::numeric >= 1000000000000::numeric THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Price, cost, and additional charge cannot be negative.');
  END IF;
  IF v_kind = 'digital_product' AND ((v_payload->>'selling_price')::numeric <= 0
    OR (v_payload->>'cost_price')::numeric > (v_payload->>'selling_price')::numeric) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'A digital product requires a positive price that covers its configured cost.');
  END IF;
  IF v_payload->'min_face_amount' <> 'null'::jsonb AND (v_payload->>'min_face_amount')::numeric < 0
    OR v_payload->'max_face_amount' <> 'null'::jsonb AND (v_payload->>'max_face_amount')::numeric < 0
    OR v_payload->'min_face_amount' <> 'null'::jsonb AND v_payload->'max_face_amount' <> 'null'::jsonb
      AND (v_payload->>'min_face_amount')::numeric > (v_payload->>'max_face_amount')::numeric THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Digital face amount limits are invalid.');
  END IF;
  PERFORM pg_catalog.set_config('kodigo.digital_catalog_writer', v_operation.id::text, true);
  INSERT INTO public.products (
    store_id, name, sku, category_id, cost_price, selling_price, current_stock,
    min_stock_level, safety_stock, reorder_level, lead_time_days, unit, is_active,
    kind, stock_tracked, digital_min_face_amount, digital_max_face_amount, digital_additional_charge
  ) VALUES (
    v_operation.store_id, pg_catalog.btrim(v_payload->>'name'), pg_catalog.btrim(v_payload->>'sku'),
    (v_payload->>'category_id')::uuid, (v_payload->>'cost_price')::numeric,
    (v_payload->>'selling_price')::numeric, 0, 0, 0, 0, 0, 'service', true,
    v_kind, false, NULLIF(v_payload->>'min_face_amount', '')::numeric,
    NULLIF(v_payload->>'max_face_amount', '')::numeric, (v_payload->>'additional_charge')::numeric
  ) RETURNING * INTO v_product;
  v_result := pg_catalog.jsonb_build_object('product_id', v_product.id, 'kind', v_product.kind,
    'name', v_product.name, 'sku', v_product.sku, 'selling_price', v_product.selling_price::text,
    'cost_price', v_product.cost_price::text, 'min_face_amount', v_product.digital_min_face_amount,
    'max_face_amount', v_product.digital_max_face_amount,
    'additional_charge', v_product.digital_additional_charge::text);
  RETURN private.finish_pos_operation(v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'digital_service_product', v_product.id::text, 1, v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_manual_digital_service(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor uuid := (SELECT auth.uid());
  v_payload jsonb;
  v_product public.products%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
  v_quote jsonb;
  v_service public.digital_service_transactions%ROWTYPE;
  v_external public.external_settlement_events%ROWTYPE;
  v_cash public.cash_movements%ROWTYPE;
  v_wallet_movement public.wallet_movements%ROWTYPE;
  v_store_id uuid;
  v_service_kind text;
  v_amount numeric(14,2);
  v_outcome text;
  v_direction text;
  v_leg_kind text;
  v_reference text;
  v_evidence text;
  v_external_at timestamptz;
  v_provider_account_id uuid;
  v_wallet_account_id uuid;
  v_cash_delta numeric(14,2);
  v_cash_amount numeric(14,2);
  v_wallet_delta numeric(14,2);
  v_duplicate_reference boolean := false;
  v_complete boolean := false;
  v_result jsonb;
  v_case_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  v_operation := private.begin_pos_operation('record_digital_service', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'operations_v2');
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'approval_workflows');
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'drawer_shifts');
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'digital_services');
  PERFORM private.assert_store_capability(v_operation.store_id, 'operate_digital_services');
  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
  END IF;
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 11
    OR NOT (v_payload ?& ARRAY['product_id', 'service_kind', 'face_amount', 'policy_code', 'provider_account_id', 'wallet_account_id', 'external_outcome', 'reference', 'external_at', 'evidence_ref', 'cash_exchange_attested'])
    OR pg_catalog.jsonb_typeof(v_payload->'product_id') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'service_kind') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'face_amount') <> 'string'
    OR (v_payload->'policy_code' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'policy_code') <> 'string')
    OR (v_payload->'provider_account_id' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'provider_account_id') <> 'string')
    OR (v_payload->'wallet_account_id' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'wallet_account_id') <> 'string')
    OR pg_catalog.jsonb_typeof(v_payload->'external_outcome') <> 'string'
    OR (v_payload->'reference' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'reference') <> 'string')
    OR (v_payload->'external_at' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'external_at') <> 'string')
    OR (v_payload->'evidence_ref' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'evidence_ref') <> 'string')
    OR pg_catalog.jsonb_typeof(v_payload->'cash_exchange_attested') <> 'boolean' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Digital service command fields are incomplete or malformed.');
  END IF;
  IF v_operation.shift_id IS NULL OR v_operation.terminal_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('SHIFT_CONTEXT_REQUIRED', 'Digital service records require an active cashier shift and terminal.');
  END IF;
  SELECT shift.* INTO v_shift FROM public.cashier_shifts AS shift
  WHERE shift.store_id = v_operation.store_id AND shift.id = v_operation.shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.terminal_id <> v_operation.terminal_id OR v_shift.state <> 'active'
    OR (v_shift.cashier_id <> v_actor AND (SELECT profile.role::text FROM public.profiles AS profile WHERE profile.id = v_actor) <> 'admin') THEN
    PERFORM private.raise_pos_operation_error('SHIFT_NOT_ACTIVE', 'The selected shift is not active for this cashier and terminal.');
  END IF;
  v_service_kind := v_payload->>'service_kind';
  v_amount := (v_payload->>'face_amount')::numeric;
  v_outcome := v_payload->>'external_outcome';
  v_provider_account_id := NULLIF(v_payload->>'provider_account_id', '')::uuid;
  v_wallet_account_id := NULLIF(v_payload->>'wallet_account_id', '')::uuid;
  v_reference := NULLIF(pg_catalog.btrim(COALESCE(v_payload->>'reference', '')), '');
  v_evidence := NULLIF(pg_catalog.btrim(COALESCE(v_payload->>'evidence_ref', '')), '');
  IF v_service_kind NOT IN ('digital_product', 'eload', 'gcash_cash_in', 'gcash_cash_out')
    OR v_outcome NOT IN ('confirmed', 'failed', 'unknown') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Service kind or external outcome is unsupported.');
  END IF;
  IF COALESCE(v_payload->>'cash_exchange_attested', 'false') <> 'true' THEN
    PERFORM private.raise_pos_operation_error('CASH_ATTESTATION_REQUIRED', 'Confirm that the physical cash exchange actually occurred.');
  END IF;
  IF v_service_kind = 'digital_product' THEN
    IF v_outcome <> 'confirmed' OR v_evidence IS NULL OR v_reference IS NOT NULL
      OR v_provider_account_id IS NOT NULL OR v_wallet_account_id IS NOT NULL THEN
      PERFORM private.raise_pos_operation_error('DELIVERY_ATTESTATION_REQUIRED', 'Digital products require delivery evidence and do not use a provider wallet.');
    END IF;
    IF (v_payload->'policy_code') <> 'null'::jsonb THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Digital product records do not use a fee policy.');
    END IF;
  ELSE
    IF v_provider_account_id IS NULL OR v_wallet_account_id IS NULL THEN
      PERFORM private.raise_pos_operation_error('PROVIDER_ACCOUNT_REQUIRED', 'Select the configured provider account and wallet for this service.');
    END IF;
    IF v_outcome = 'confirmed' AND (v_reference IS NULL OR v_evidence IS NULL OR v_payload->'external_at' = 'null'::jsonb) THEN
      PERFORM private.raise_pos_operation_error('EXTERNAL_EVIDENCE_REQUIRED', 'Confirmed external service requires a reference, external time, and evidence reference.');
    END IF;
    IF v_reference IS NOT NULL AND (pg_catalog.length(v_reference) > 160 OR v_reference ~ '[[:cntrl:]]')
      OR v_evidence IS NOT NULL AND (pg_catalog.length(v_evidence) > 200 OR v_evidence ~ '[[:cntrl:]]') THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'External reference or evidence reference is invalid.');
    END IF;
    IF v_payload->'external_at' <> 'null'::jsonb THEN
      BEGIN v_external_at := (v_payload->>'external_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'External timestamp is invalid.'); END;
    END IF;
  END IF;
  SELECT product.* INTO v_product FROM public.products AS product
  WHERE product.store_id = v_operation.store_id AND product.id = (v_payload->>'product_id')::uuid
    AND product.kind = v_service_kind AND product.is_active AND NOT product.stock_tracked AND product.current_stock = 0
  FOR UPDATE;
  IF NOT FOUND THEN PERFORM private.raise_pos_operation_error('PRODUCT_NOT_FOUND', 'Active non-stock service product was not found.', '23503'); END IF;
  v_quote := private.digital_service_quote(v_operation.store_id, v_product.id, v_service_kind, v_amount, v_payload->>'policy_code');
  IF v_service_kind <> 'digital_product' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.digital_provider_accounts AS provider
      JOIN public.wallet_accounts AS wallet ON wallet.store_id = provider.store_id AND wallet.provider_account_id = provider.id
      WHERE provider.store_id = v_operation.store_id AND provider.id = v_provider_account_id
        AND wallet.id = v_wallet_account_id AND provider.active AND wallet.active
        AND provider.account_kind = CASE WHEN v_service_kind = 'eload' THEN 'load' ELSE 'gcash' END
        AND wallet.wallet_type = provider.account_kind
    ) THEN PERFORM private.raise_pos_operation_error('PROVIDER_ACCOUNT_MISMATCH', 'Provider account and wallet do not match this service.', '23503'); END IF;
  END IF;
  IF v_service_kind = 'gcash_cash_out' THEN
    v_direction := 'inbound'; v_leg_kind := 'wallet_transfer';
  ELSIF v_service_kind = 'eload' THEN
    v_direction := 'outbound'; v_leg_kind := 'load_delivery';
  ELSE
    v_direction := 'outbound'; v_leg_kind := 'wallet_transfer';
  END IF;
  IF v_outcome = 'confirmed' AND EXISTS (
    SELECT 1 FROM public.external_settlement_events AS existing
    WHERE existing.store_id = v_operation.store_id AND existing.provider_account_id = v_provider_account_id
      AND existing.direction = v_direction AND existing.normalized_reference = v_reference
      AND existing.outcome = 'confirmed'
  ) THEN
    v_outcome := 'unknown';
    v_duplicate_reference := true;
  END IF;
  v_cash_delta := (v_quote->>'cash_delta')::numeric;
  v_cash_amount := abs(v_cash_delta);
  v_wallet_delta := (v_quote->>'wallet_delta')::numeric;
  IF v_service_kind = 'digital_product' THEN v_complete := true;
  ELSE v_complete := v_outcome = 'confirmed'; END IF;
  PERFORM pg_catalog.set_config('kodigo.digital_service_writer', v_operation.id::text, true);
  INSERT INTO public.digital_service_transactions (
    store_id, operation_id, product_id, provider_account_id, wallet_account_id,
    fee_policy_id, shift_id, terminal_id, created_by, service_kind, face_amount,
    fee_amount, cost_amount, retail_amount, additional_charge_amount, earning_amount,
    fee_policy_snapshot, quote_hash, quote_snapshot, state, cash_leg_state, provider_leg_state,
    confirmed_at, completed_at
  ) VALUES (
    v_operation.store_id, v_operation.id, v_product.id, v_provider_account_id, v_wallet_account_id,
    NULLIF(v_quote->>'fee_policy_id', '')::uuid, v_shift.id, v_shift.terminal_id, v_actor, v_service_kind, v_amount,
    (v_quote->>'fee_amount')::numeric, (v_quote->>'cost_amount')::numeric,
    (v_quote->>'retail_amount')::numeric, (v_quote->>'additional_charge_amount')::numeric,
    (v_quote->>'earning_amount')::numeric, v_quote->'fee_policy_snapshot',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_quote::text, 'UTF8'), 'sha256'), 'hex'),
    v_quote, 'draft', 'pending', CASE WHEN v_service_kind = 'digital_product' THEN 'confirmed' ELSE v_outcome END,
    CASE WHEN v_outcome = 'confirmed' THEN v_external_at ELSE NULL END,
    NULL
  ) RETURNING * INTO v_service;
  v_cash := private.post_cash_movement(
    v_operation.store_id, v_shift.drawer_id, v_shift.id, v_operation.id,
    'digital-service-cash/' || v_service.id::text, 'digital_service', v_service.id,
    CASE WHEN v_cash_delta < 0 THEN 'digital_cash_out' ELSE 'digital_cash_in' END,
    v_cash_amount, v_cash_delta, 'Manual ' || v_service_kind || ' cash leg', v_operation.local_occurred_at
  );
  INSERT INTO public.service_clearing_events (store_id, service_id, operation_id, source_key, leg_kind, signed_amount, cash_movement_id)
  VALUES (v_service.store_id, v_service.id, v_operation.id, 'cash-principal', 'cash_principal',
    CASE WHEN v_service_kind = 'gcash_cash_out' THEN -v_amount ELSE v_amount END, v_cash.id);
  IF v_service_kind = 'digital_product' THEN
    UPDATE public.digital_service_transactions AS service
    SET state = 'completed', cash_leg_state = 'confirmed', version = service.version + 1,
        updated_at = pg_catalog.clock_timestamp(), completed_at = v_now
    WHERE service.store_id = v_service.store_id AND service.id = v_service.id
    RETURNING * INTO v_service;
    INSERT INTO public.digital_service_events (store_id, service_id, operation_id, event_kind, step, actor_id, details)
    VALUES (v_service.store_id, v_service.id, v_operation.id, 'completed', 'manual_delivery', v_actor,
      pg_catalog.jsonb_build_object('cash_movement_id', v_cash.id, 'delivery_evidence_ref', v_evidence,
        'cost_amount', v_service.cost_amount::text, 'retail_amount', v_service.retail_amount::text));
  ELSE
    INSERT INTO public.external_settlement_events (
      store_id, service_id, operation_id, provider_account_id, direction, leg_kind,
      normalized_reference, external_amount, external_at, outcome, evidence_ref, verified_by
    ) VALUES (
      v_service.store_id, v_service.id, v_operation.id, v_provider_account_id, v_direction, v_leg_kind,
      v_reference, CASE WHEN v_service_kind = 'gcash_cash_out' THEN v_amount + (v_quote->>'fee_amount')::numeric ELSE v_amount END,
      v_external_at, v_outcome, v_evidence, v_actor
    ) RETURNING * INTO v_external;
    IF v_outcome = 'confirmed' THEN
      BEGIN
        v_wallet_movement := private.post_digital_wallet_movement(
          v_service.store_id, v_wallet_account_id, v_operation.id, v_service.id,
          'digital-service-wallet/' || v_service.id::text,
          CASE WHEN v_wallet_delta < 0 THEN 'service_debit' ELSE 'service_credit' END,
          v_wallet_delta, v_reference, 'Manual verified ' || v_service_kind || ' settlement'
        );
      EXCEPTION WHEN check_violation THEN
        v_complete := false;
        INSERT INTO public.reconciliation_cases (
          store_id, domain, service_id, wallet_account_id, source_operation_id, case_kind,
          expected_amount, observed_amount, difference_amount, reason, raised_by, evidence_ref
        ) VALUES (v_service.store_id, 'wallet', v_service.id, v_wallet_account_id, v_operation.id,
          'balance_difference', abs(v_wallet_delta), 0, -abs(v_wallet_delta),
          'Provider outcome was confirmed but the internal wallet ledger could not post the expected balance change.',
          v_actor, v_evidence) RETURNING id INTO v_case_id;
      END;
    END IF;
    IF v_outcome = 'confirmed' THEN
      INSERT INTO public.service_clearing_events (store_id, service_id, operation_id, source_key, leg_kind, signed_amount, external_event_id)
      VALUES (v_service.store_id, v_service.id, v_operation.id, 'provider-principal', 'provider_principal',
        CASE WHEN v_service_kind = 'gcash_cash_out' THEN v_amount ELSE -v_amount END, v_external.id);
    END IF;
    IF v_outcome <> 'confirmed' THEN
      INSERT INTO public.reconciliation_cases (
        store_id, domain, service_id, wallet_account_id, source_operation_id, case_kind,
        expected_amount, observed_amount, difference_amount, reason, raised_by, evidence_ref
      ) VALUES (v_service.store_id, CASE WHEN v_outcome = 'unknown' THEN 'provider' ELSE 'digital_service' END,
        v_service.id, v_wallet_account_id, v_operation.id, 'unknown_outcome',
        CASE WHEN v_service_kind = 'gcash_cash_out' THEN v_amount + (v_quote->>'fee_amount')::numeric ELSE v_amount END,
        CASE WHEN v_outcome = 'failed' THEN 0 ELSE NULL END, NULL,
        CASE WHEN v_duplicate_reference THEN 'This provider reference was already recorded; review both records before any further action.'
          WHEN v_outcome = 'unknown' THEN 'Provider outcome is unknown; do not repeat the external action until reviewed.'
          WHEN v_outcome = 'failed' THEN 'Provider reported failure after the cash leg was recorded.'
          ELSE 'Confirmed provider movement requires wallet reconciliation.' END,
        v_actor, v_evidence
      ) RETURNING id INTO v_case_id;
    END IF;
    UPDATE public.digital_service_transactions AS service
    SET state = CASE WHEN v_complete THEN 'completed' ELSE 'needs_reconciliation' END,
        cash_leg_state = 'confirmed', provider_leg_state = v_outcome,
        version = service.version + 1, updated_at = pg_catalog.clock_timestamp(),
        completed_at = CASE WHEN v_complete THEN v_now ELSE NULL END
    WHERE service.store_id = v_service.store_id AND service.id = v_service.id
    RETURNING * INTO v_service;
    INSERT INTO public.digital_service_events (store_id, service_id, operation_id, event_kind, step, actor_id, details)
    VALUES (v_service.store_id, v_service.id, v_operation.id,
      CASE WHEN v_complete THEN 'completed' ELSE 'reconciliation_required' END,
      'manual_provider_record', v_actor,
      pg_catalog.jsonb_build_object('external_event_id', v_external.id, 'cash_movement_id', v_cash.id,
        'reconciliation_case_id', v_case_id, 'provider_outcome', v_outcome,
        'reference', v_reference, 'evidence_ref', v_evidence));
  END IF;
  IF v_complete THEN
    INSERT INTO public.retailer_earning_events (store_id, service_id, operation_id, source_key, earning_kind, signed_amount)
    VALUES (v_service.store_id, v_service.id, v_operation.id, 'service-earned', 'service_earned', v_service.earning_amount);
  END IF;
  v_result := pg_catalog.jsonb_build_object(
    'service_id', v_service.id, 'service_kind', v_service.service_kind, 'state', v_service.state,
    'version', v_service.version, 'face_amount', v_service.face_amount::text,
    'fee_amount', v_service.fee_amount::text, 'retail_amount', v_service.retail_amount::text,
    'cost_amount', v_service.cost_amount::text, 'earning_amount', CASE WHEN v_complete THEN v_service.earning_amount::text ELSE '0.00' END,
    'cash_delta', v_cash.cash_delta::text, 'cash_movement_id', v_cash.id,
    'wallet_movement_id', v_wallet_movement.id, 'external_event_id', v_external.id,
    'reconciliation_case_id', v_case_id,
    'message', CASE WHEN v_complete THEN 'Service recorded as complete.' ELSE 'Observed cash was recorded. Provider outcome requires reconciliation; do not repeat the transfer.' END
  );
  RETURN private.finish_pos_operation(v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, CASE WHEN v_complete THEN 'confirmed' ELSE 'pending_external' END,
    'digital_service', v_service.id::text, v_service.version, v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_digital_service_records(p_store_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_role text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_belongs_to_store(p_store_id) OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'A valid signed-in store session is required.', '42501');
  END IF;
  SELECT profile.role::text INTO v_actor_role FROM public.profiles AS profile WHERE profile.id = (SELECT auth.uid());
  IF v_actor_role = 'inventory' THEN PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Digital service records are restricted.', '42501'); END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Limit must be between 1 and 100.');
  END IF;
  RETURN pg_catalog.jsonb_build_object('items', COALESCE((
    SELECT pg_catalog.jsonb_agg(item.row_data ORDER BY item.created_at DESC, item.id DESC)
    FROM (
      SELECT service.id, service.created_at,
        pg_catalog.jsonb_build_object('id', service.id, 'service_kind', service.service_kind,
          'state', service.state, 'version', service.version, 'face_amount', service.face_amount::text,
          'fee_amount', service.fee_amount::text, 'retail_amount', service.retail_amount::text,
          'earning_amount', service.earning_amount::text, 'cash_leg_state', service.cash_leg_state,
          'provider_leg_state', service.provider_leg_state, 'created_at', service.created_at,
          'completed_at', service.completed_at, 'product_name', product.name,
          'account_label', provider.account_label, 'reference', external.normalized_reference,
          'reconciliation_case_id', case_row.id) AS row_data
      FROM public.digital_service_transactions AS service
      JOIN public.products AS product ON product.store_id = service.store_id AND product.id = service.product_id
      LEFT JOIN public.digital_provider_accounts AS provider ON provider.store_id = service.store_id AND provider.id = service.provider_account_id
      LEFT JOIN LATERAL (SELECT event.normalized_reference FROM public.external_settlement_events AS event
        WHERE event.store_id = service.store_id AND event.service_id = service.id
        ORDER BY event.verified_at DESC LIMIT 1) AS external ON true
      LEFT JOIN LATERAL (SELECT case_item.id FROM public.reconciliation_cases AS case_item
        WHERE case_item.store_id = service.store_id AND case_item.service_id = service.id AND case_item.state <> 'resolved'
        ORDER BY case_item.created_at DESC LIMIT 1) AS case_row ON true
      WHERE service.store_id = p_store_id
      ORDER BY service.created_at DESC, service.id DESC LIMIT p_limit
    ) AS item
  ), '[]'::jsonb), 'generated_at', pg_catalog.clock_timestamp());
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_digital_service_workspace(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_role text;
  v_digital_enabled boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_belongs_to_store(p_store_id) OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'A valid signed-in store session is required.', '42501');
  END IF;
  SELECT profile.role::text INTO v_actor_role FROM public.profiles AS profile WHERE profile.id = (SELECT auth.uid());
  IF v_actor_role = 'inventory' THEN PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Digital service records are restricted.', '42501'); END IF;
  PERFORM private.assert_store_capability(p_store_id, 'operate_digital_services');
  v_digital_enabled := private.store_feature_enabled(p_store_id, 'digital_services');
  RETURN pg_catalog.jsonb_build_object(
    'enabled', v_digital_enabled,
    'online_only', true,
    'active_shifts', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', shift.id, 'terminal_id', shift.terminal_id, 'drawer_id', shift.drawer_id,
        'cashier_id', shift.cashier_id, 'cashier_name', shift.cashier_name_snapshot,
        'state', shift.state, 'version', shift.version,
        'opening_amount', shift.opening_amount::text, 'opened_at', shift.opened_at
      ) ORDER BY shift.opened_at DESC)
      FROM public.cashier_shifts AS shift
      WHERE shift.store_id = p_store_id AND shift.state = 'active'
        AND (shift.cashier_id = (SELECT auth.uid()) OR v_actor_role = 'admin')
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', product.id, 'name', product.name, 'sku', product.sku, 'kind', product.kind,
        'selling_price', product.selling_price::text, 'cost_price', product.cost_price::text,
        'min_face_amount', product.digital_min_face_amount, 'max_face_amount', product.digital_max_face_amount,
        'additional_charge', product.digital_additional_charge::text, 'category_id', product.category_id
      ) ORDER BY product.name, product.id)
      FROM public.products AS product
      WHERE product.store_id = p_store_id AND product.is_active AND product.kind <> 'physical'
        AND NOT product.stock_tracked AND product.current_stock = 0
    ), '[]'::jsonb),
    'accounts', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'provider_account_id', provider.id, 'provider_name', provider.provider_name,
        'account_kind', provider.account_kind, 'account_label', provider.account_label,
        'masked_identifier', provider.masked_identifier, 'active', provider.active,
        'wallet_account_id', wallet.id, 'wallet_type', wallet.wallet_type,
        'balance', wallet.posted_balance::text, 'available_balance',
          (wallet.posted_balance - COALESCE((SELECT pg_catalog.sum(reservation.remaining_amount)
            FROM public.wallet_reservations AS reservation WHERE reservation.store_id = wallet.store_id
              AND reservation.wallet_account_id = wallet.id AND reservation.state = 'active'), 0))::text,
        'wallet_version', wallet.version
      ) ORDER BY provider.account_kind, provider.account_label)
      FROM public.digital_provider_accounts AS provider
      LEFT JOIN public.wallet_accounts AS wallet
        ON wallet.store_id = provider.store_id AND wallet.provider_account_id = provider.id
      WHERE provider.store_id = p_store_id AND provider.active
    ), '[]'::jsonb),
    'fee_policies', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', policy.id, 'service_kind', policy.service_kind, 'policy_code', policy.policy_code,
        'version', policy.version, 'formula', policy.formula, 'rate_bps', policy.rate_bps,
        'flat_amount', policy.flat_amount::text, 'minimum_amount', policy.minimum_amount::text,
        'maximum_amount', policy.maximum_amount::text, 'is_default', policy.is_default,
        'bands', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'minimum_amount', band.minimum_amount::text, 'maximum_amount', band.maximum_amount::text,
          'formula', band.formula, 'rate_bps', band.rate_bps, 'flat_amount', band.flat_amount::text
        ) ORDER BY band.band_ordinal) FROM public.service_fee_policy_bands AS band
          WHERE band.store_id = policy.store_id AND band.policy_id = policy.id), '[]'::jsonb)
      ) ORDER BY policy.service_kind, policy.is_default DESC, policy.policy_code, policy.version DESC)
      FROM public.service_fee_policies AS policy
      WHERE policy.store_id = p_store_id AND policy.active
        AND policy.effective_from <= pg_catalog.statement_timestamp()
        AND (policy.effective_to IS NULL OR policy.effective_to > pg_catalog.statement_timestamp())
    ), '[]'::jsonb),
    'wallet_adjustments', CASE WHEN v_actor_role = 'admin' THEN COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'request_id', request.id, 'request_version', request.request_version,
        'wallet_id', wallet.id, 'wallet_label', wallet.account_label,
        'wallet_type', wallet.wallet_type, 'wallet_version', wallet.version,
        'requester_id', request.requester_id,
        'state', request.state, 'kind', request.proposed_payload->>'kind',
        'amount', request.proposed_payload->>'amount',
        'funding_source', request.proposed_payload->>'funding_source',
        'reason', request.reason, 'decision_id', decision.id,
        'decision', decision.decision, 'decision_by', decision.actor_id
      ) ORDER BY request.created_at DESC, request.id DESC)
      FROM public.operational_approval_requests AS request
      JOIN public.wallet_accounts AS wallet
        ON wallet.store_id = request.store_id AND wallet.id = request.resource_id
      LEFT JOIN public.operational_approval_decisions AS decision
        ON decision.store_id = request.store_id AND decision.request_id = request.id
      WHERE request.store_id = p_store_id AND request.kind = 'wallet_adjustment'
        AND request.state IN ('requested', 'approved')
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'records', COALESCE((public.list_digital_service_records(p_store_id, 50)->'items'), '[]'::jsonb),
    'generated_at', pg_catalog.clock_timestamp()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_digital_reconciliation_case()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.reconciliation_writer', true), '')::uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reconciliation cases cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE'
    AND v_operation_id IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.store_id = OLD.store_id
    AND NEW.domain = OLD.domain
    AND NEW.service_id IS NOT DISTINCT FROM OLD.service_id
    AND NEW.wallet_account_id IS NOT DISTINCT FROM OLD.wallet_account_id
    AND NEW.source_operation_id IS NOT DISTINCT FROM OLD.source_operation_id
    AND NEW.case_kind = OLD.case_kind
    AND NEW.expected_amount IS NOT DISTINCT FROM OLD.expected_amount
    AND NEW.observed_amount IS NOT DISTINCT FROM OLD.observed_amount
    AND NEW.difference_amount IS NOT DISTINCT FROM OLD.difference_amount
    AND NEW.reason = OLD.reason
    AND NEW.raised_by = OLD.raised_by
    AND NEW.created_at = OLD.created_at
    AND OLD.state IN ('open', 'under_review')
    AND NEW.state = 'resolved'
    AND NEW.resolved_by = (SELECT auth.uid())
    AND NEW.evidence_ref IS NOT NULL
    AND NEW.updated_at >= OLD.updated_at
    AND EXISTS (SELECT 1 FROM public.pos_operations AS operation
      WHERE operation.store_id = NEW.store_id AND operation.id = v_operation_id
        AND operation.actor_id = (SELECT auth.uid()) AND operation.status = 'processing'
        AND operation.kind = 'resolve_digital_service_external_outcome') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Reconciliation case lifecycle is not authorized' USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER digital_reconciliation_case_guard
  BEFORE UPDATE OR DELETE ON public.reconciliation_cases
  FOR EACH ROW EXECUTE FUNCTION private.guard_digital_reconciliation_case();

CREATE OR REPLACE FUNCTION public.apply_digital_wallet_adjustment(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_request public.operational_approval_requests%ROWTYPE;
  v_wallet public.wallet_accounts%ROWTYPE;
  v_movement public.wallet_movements%ROWTYPE;
  v_kind text;
  v_source text;
  v_delta numeric(14,2);
  v_external_reference text;
  v_evidence text;
  v_application_id uuid;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('apply_wallet_adjustment', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'operations_v2');
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'approval_workflows');
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 5
    OR NOT (v_payload ?& ARRAY['request_id', 'decision_id', 'expected_wallet_version', 'external_reference', 'evidence_ref'])
    OR pg_catalog.jsonb_typeof(v_payload->'request_id') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'decision_id') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'expected_wallet_version') <> 'number'
    OR (v_payload->'external_reference' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'external_reference') <> 'string')
    OR pg_catalog.jsonb_typeof(v_payload->'evidence_ref') <> 'string' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Wallet adjustment application fields are incomplete or malformed.');
  END IF;
  IF (v_payload->>'expected_wallet_version') !~ '^[1-9][0-9]*$'
    OR pg_catalog.length(v_payload->>'expected_wallet_version') > 18 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Wallet version is invalid.');
  END IF;
  v_request := private.assert_operational_approval_applicable(
    v_operation.store_id, (v_payload->>'request_id')::uuid, (v_payload->>'decision_id')::uuid,
    'wallet_adjustment', (v_payload->>'expected_wallet_version')::bigint
  );
  SELECT wallet.* INTO v_wallet FROM public.wallet_accounts AS wallet
  WHERE wallet.store_id = v_operation.store_id AND wallet.id = v_request.resource_id FOR UPDATE;
  IF NOT FOUND OR v_wallet.version <> (v_payload->>'expected_wallet_version')::bigint THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Wallet changed after approval; request a new review.', '40001');
  END IF;
  v_kind := v_request.proposed_payload->>'kind';
  v_source := v_request.proposed_payload->>'funding_source';
  IF v_source NOT IN ('external', 'opening_balance') OR v_kind = 'correction' THEN
    PERFORM private.raise_pos_operation_error('UPGRADE_REQUIRED', 'Only evidenced external opening and top-up movements are supported by this wallet screen.');
  END IF;
  IF v_source = 'opening_balance' AND (v_kind <> 'opening' OR v_wallet.posted_balance <> 0)
    OR v_source = 'external' AND v_kind NOT IN ('topup', 'withdraw') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Wallet adjustment kind does not match its external funding source.');
  END IF;
  v_external_reference := NULLIF(pg_catalog.btrim(COALESCE(v_payload->>'external_reference', '')), '');
  v_evidence := pg_catalog.btrim(v_payload->>'evidence_ref');
  IF v_external_reference IS NULL OR pg_catalog.length(v_external_reference) > 160
    OR v_external_reference ~ '[[:cntrl:]]'
    OR pg_catalog.length(v_evidence) NOT BETWEEN 1 AND 200 OR v_evidence ~ '[[:cntrl:]]' THEN
    PERFORM private.raise_pos_operation_error('EVIDENCE_REQUIRED', 'External wallet adjustments require a unique reference and evidence reference.');
  END IF;
  v_delta := (v_request.proposed_payload->>'amount')::numeric * CASE WHEN v_kind = 'withdraw' THEN -1 ELSE 1 END;
  v_movement := private.post_digital_wallet_movement(
    v_operation.store_id, v_wallet.id, v_operation.id, NULL,
    'wallet-adjustment/' || v_request.id::text,
    CASE v_kind WHEN 'opening' THEN 'opening' WHEN 'topup' THEN 'topup' ELSE 'withdrawal' END,
    v_delta, v_external_reference, pg_catalog.left(v_request.reason || ' | evidence: ' || v_evidence, 500)
  );
  v_application_id := private.record_operational_approval_application(
    v_operation.store_id, v_request.id, (v_payload->>'decision_id')::uuid, v_operation.id,
    'wallet_adjustment', v_wallet.version, v_wallet.version + 1
  );
  v_result := pg_catalog.jsonb_build_object('wallet_id', v_wallet.id,
    'movement_id', v_movement.id, 'balance_before', v_movement.balance_before::text,
    'balance_after', v_movement.balance_after::text, 'application_id', v_application_id,
    'external_reference', v_external_reference);
  RETURN private.finish_pos_operation(v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'wallet_account', v_wallet.id::text,
    v_wallet.version + 1, v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_digital_service_external_outcome(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_service public.digital_service_transactions%ROWTYPE;
  v_external public.external_settlement_events%ROWTYPE;
  v_movement public.wallet_movements%ROWTYPE;
  v_reference text;
  v_evidence text;
  v_external_at timestamptz;
  v_external_amount numeric(14,2);
  v_direction text;
  v_leg_kind text;
  v_wallet_delta numeric(14,2);
  v_complete boolean := false;
  v_case_id uuid;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('resolve_digital_service_external_outcome', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'operations_v2');
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'approval_workflows');
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'drawer_shifts');
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'digital_services');
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 5
    OR NOT (v_payload ?& ARRAY['service_id', 'service_version', 'reference', 'external_at', 'evidence_ref'])
    OR pg_catalog.jsonb_typeof(v_payload->'service_id') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'service_version') <> 'number'
    OR pg_catalog.jsonb_typeof(v_payload->'reference') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'external_at') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'evidence_ref') <> 'string'
    OR (v_payload->>'service_version') !~ '^[1-9][0-9]*$'
    OR pg_catalog.length(v_payload->>'service_version') > 18 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Manual provider confirmation fields are invalid.');
  END IF;
  SELECT service.* INTO v_service FROM public.digital_service_transactions AS service
  WHERE service.store_id = v_operation.store_id AND service.id = (v_payload->>'service_id')::uuid FOR UPDATE;
  IF NOT FOUND OR v_service.version <> (v_payload->>'service_version')::bigint
    OR v_service.service_kind = 'digital_product' OR v_service.state <> 'needs_reconciliation'
    OR v_service.provider_leg_state NOT IN ('unknown', 'confirmed') THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'This digital service is not awaiting an external outcome review.', '40001');
  END IF;
  v_reference := pg_catalog.btrim(v_payload->>'reference');
  v_evidence := pg_catalog.btrim(v_payload->>'evidence_ref');
  IF pg_catalog.length(v_reference) NOT BETWEEN 1 AND 160 OR v_reference ~ '[[:cntrl:]]'
    OR pg_catalog.length(v_evidence) NOT BETWEEN 1 AND 200 OR v_evidence ~ '[[:cntrl:]]' THEN
    PERFORM private.raise_pos_operation_error('EVIDENCE_REQUIRED', 'A unique provider reference and manual review evidence are required.');
  END IF;
  BEGIN v_external_at := (v_payload->>'external_at')::timestamptz;
  EXCEPTION WHEN OTHERS THEN PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'External transaction time is invalid.'); END;
  IF v_external_at > pg_catalog.clock_timestamp() THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'External transaction time cannot be in the future.');
  END IF;
  IF v_service.service_kind = 'gcash_cash_out' THEN
    v_direction := 'inbound'; v_leg_kind := 'wallet_transfer';
    v_external_amount := v_service.face_amount + v_service.fee_amount;
    v_wallet_delta := v_external_amount;
  ELSIF v_service.service_kind = 'eload' THEN
    v_direction := 'outbound'; v_leg_kind := 'load_delivery';
    v_external_amount := v_service.face_amount;
    v_wallet_delta := -v_service.cost_amount;
  ELSE
    v_direction := 'outbound'; v_leg_kind := 'wallet_transfer';
    v_external_amount := v_service.face_amount;
    v_wallet_delta := -v_service.face_amount;
  END IF;
  SELECT event.* INTO v_external FROM public.external_settlement_events AS event
  WHERE event.store_id = v_service.store_id AND event.service_id = v_service.id
    AND event.outcome = 'confirmed'
  ORDER BY event.verified_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_external.normalized_reference <> v_reference OR v_external.external_amount <> v_external_amount THEN
      PERFORM private.raise_pos_operation_error('REFERENCE_CORRECTION_REQUIRED', 'A confirmed provider reference cannot be overwritten; use a reviewed reconciliation correction.');
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.external_settlement_events AS existing
      WHERE existing.store_id = v_service.store_id AND existing.provider_account_id = v_service.provider_account_id
        AND existing.direction = v_direction AND existing.normalized_reference = v_reference
        AND existing.outcome = 'confirmed') THEN
      PERFORM private.raise_pos_operation_error('DUPLICATE_PROVIDER_REFERENCE', 'This provider reference already belongs to another confirmed settlement.');
    END IF;
    INSERT INTO public.external_settlement_events (
      store_id, service_id, operation_id, provider_account_id, direction, leg_kind,
      normalized_reference, external_amount, external_at, outcome, evidence_ref, verified_by
    ) VALUES (
      v_service.store_id, v_service.id, v_operation.id, v_service.provider_account_id,
      v_direction, v_leg_kind, v_reference, v_external_amount, v_external_at,
      'confirmed', v_evidence, (SELECT auth.uid())
    ) RETURNING * INTO v_external;
  END IF;
  BEGIN
    SELECT movement.* INTO v_movement FROM public.wallet_movements AS movement
    WHERE movement.store_id = v_service.store_id AND movement.service_id = v_service.id
      AND movement.source_key = 'digital-service-wallet/' || v_service.id::text;
    IF NOT FOUND THEN
      v_movement := private.post_digital_wallet_movement(
        v_service.store_id, v_service.wallet_account_id, v_operation.id, v_service.id,
        'digital-service-wallet/' || v_service.id::text,
        CASE WHEN v_wallet_delta < 0 THEN 'service_debit' ELSE 'service_credit' END,
        v_wallet_delta, v_reference, 'Admin verified manual ' || v_service.service_kind || ' settlement'
      );
    END IF;
    v_complete := true;
  EXCEPTION WHEN check_violation THEN
    v_complete := false;
    INSERT INTO public.reconciliation_cases (
      store_id, domain, service_id, wallet_account_id, source_operation_id,
      case_kind, expected_amount, observed_amount, difference_amount,
      reason, raised_by, evidence_ref
    ) VALUES (
      v_service.store_id, 'wallet', v_service.id, v_service.wallet_account_id,
      v_operation.id, 'balance_difference', abs(v_wallet_delta), 0, -abs(v_wallet_delta),
      'Provider outcome is confirmed but the internal wallet balance still needs approved funding or reconciliation.',
      (SELECT auth.uid()), v_evidence
    ) RETURNING id INTO v_case_id;
  END;
  INSERT INTO public.service_clearing_events (
    store_id, service_id, operation_id, source_key, leg_kind, signed_amount, external_event_id
  ) VALUES (
    v_service.store_id, v_service.id, v_operation.id, 'provider-principal', 'provider_principal',
    CASE WHEN v_service.service_kind = 'gcash_cash_out' THEN v_service.face_amount ELSE -v_service.face_amount END,
    v_external.id
  ) ON CONFLICT (store_id, service_id, source_key) DO NOTHING;
  PERFORM pg_catalog.set_config('kodigo.digital_service_writer', v_operation.id::text, true);
  UPDATE public.digital_service_transactions AS service
  SET state = CASE WHEN v_complete THEN 'completed' ELSE 'needs_reconciliation' END,
      provider_leg_state = 'confirmed', confirmed_at = COALESCE(service.confirmed_at, v_external_at),
      version = service.version + 1, updated_at = pg_catalog.clock_timestamp(),
      completed_at = CASE WHEN v_complete THEN pg_catalog.clock_timestamp() ELSE NULL END
  WHERE service.store_id = v_service.store_id AND service.id = v_service.id
  RETURNING * INTO v_service;
  IF v_complete THEN
    INSERT INTO public.retailer_earning_events (
      store_id, service_id, operation_id, source_key, earning_kind, signed_amount
    ) SELECT v_service.store_id, v_service.id, v_operation.id, 'service-earned', 'service_earned', v_service.earning_amount
    WHERE v_service.earning_amount > 0
    ON CONFLICT (store_id, service_id, source_key) DO NOTHING;
    PERFORM pg_catalog.set_config('kodigo.reconciliation_writer', v_operation.id::text, true);
    UPDATE public.reconciliation_cases AS case_row
    SET state = 'resolved', resolved_by = (SELECT auth.uid()), evidence_ref = v_evidence,
        updated_at = pg_catalog.clock_timestamp()
    WHERE case_row.store_id = v_service.store_id AND case_row.service_id = v_service.id
      AND case_row.state IN ('open', 'under_review');
  END IF;
  INSERT INTO public.digital_service_events (
    store_id, service_id, operation_id, event_kind, step, actor_id, details
  ) VALUES (
    v_service.store_id, v_service.id, v_operation.id,
    CASE WHEN v_complete THEN 'completed' ELSE 'reconciliation_required' END,
    'manual_provider_resolution', (SELECT auth.uid()),
    pg_catalog.jsonb_build_object('external_event_id', v_external.id,
      'wallet_movement_id', v_movement.id, 'reconciliation_case_id', v_case_id,
      'reference', v_reference, 'evidence_ref', v_evidence)
  );
  v_result := pg_catalog.jsonb_build_object('service_id', v_service.id, 'state', v_service.state,
    'version', v_service.version, 'external_event_id', v_external.id,
    'wallet_movement_id', v_movement.id, 'reconciliation_case_id', v_case_id,
    'message', CASE WHEN v_complete THEN 'Provider outcome was confirmed and the service is complete.'
      ELSE 'Provider outcome was confirmed. Wallet funding or reconciliation is still required.' END);
  RETURN private.finish_pos_operation(v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, CASE WHEN v_complete THEN 'confirmed' ELSE 'pending_external' END,
    'digital_service', v_service.id::text, v_service.version, v_result);
END;
$function$;

REVOKE ALL ON FUNCTION private.seed_digital_fee_policies(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.digital_service_quote(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.post_digital_wallet_movement(uuid, uuid, uuid, uuid, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_digital_reconciliation_case() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.quote_digital_service(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_digital_provider_account(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_digital_service_product(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.record_manual_digital_service(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_digital_service_records(uuid, integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_digital_service_workspace(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.apply_digital_wallet_adjustment(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.resolve_digital_service_external_outcome(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.quote_digital_service(uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_digital_provider_account(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_digital_service_product(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_digital_service(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_digital_service_records(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_digital_service_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_digital_wallet_adjustment(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_digital_service_external_outcome(jsonb) TO authenticated;
