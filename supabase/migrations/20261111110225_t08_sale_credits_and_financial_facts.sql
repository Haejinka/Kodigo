-- T08: additive accounting facts. Legacy receipt, payment, and return rows are
-- deliberately left untouched; ambiguous legacy sales remain unclassified.

ALTER TABLE public.sales
  ADD COLUMN accounting_version smallint,
  ADD COLUMN operation_id uuid;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_accounting_version_positive
    CHECK (accounting_version IS NULL OR accounting_version > 0),
  ADD CONSTRAINT sales_operation_store_fk
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX sales_store_operation_unique
  ON public.sales (store_id, operation_id)
  WHERE operation_id IS NOT NULL;

ALTER TABLE public.sale_items
  ADD COLUMN accounting_version smallint,
  ADD COLUMN line_amount_basis text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN operation_id uuid;

ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_accounting_version_positive
    CHECK (accounting_version IS NULL OR accounting_version > 0),
  ADD CONSTRAINT sale_items_line_amount_basis_valid
    CHECK (line_amount_basis IN ('net_item_discounted', 'legacy_gross', 'legacy_unknown')),
  ADD CONSTRAINT sale_items_sale_id_id_unique UNIQUE (sale_id, id);

CREATE INDEX sale_items_sale_accounting_idx
  ON public.sale_items (sale_id, id)
  INCLUDE (quantity, line_total, item_discount_amount, base_unit_quantity, cogs, accounting_version, line_amount_basis);

ALTER TABLE public.sale_payments
  ADD COLUMN operation_id uuid,
  ADD COLUMN event_kind text,
  ADD COLUMN original_payment_id uuid,
  ADD COLUMN refund_id uuid,
  ADD COLUMN void_id uuid,
  ADD COLUMN shift_id uuid,
  ADD COLUMN terminal_id uuid,
  ADD COLUMN accounting_version smallint;

ALTER TABLE public.sale_payments
  ADD CONSTRAINT sale_payments_event_kind_valid
    CHECK (event_kind IS NULL OR event_kind IN ('capture', 'refund', 'void_reversal')),
  ADD CONSTRAINT sale_payments_accounting_version_positive
    CHECK (accounting_version IS NULL OR accounting_version > 0),
  ADD CONSTRAINT sale_payments_new_event_shape
    CHECK (
      event_kind IS NULL
      OR (
        accounting_version IS NOT NULL
        AND operation_id IS NOT NULL
        AND (
          (event_kind = 'capture' AND amount >= 0 AND original_payment_id IS NULL)
          OR (event_kind IN ('refund', 'void_reversal') AND amount <= 0 AND original_payment_id IS NOT NULL)
        )
      )
    ),
  ADD CONSTRAINT sale_payments_store_sale_id_unique UNIQUE (store_id, sale_id, id),
  ADD CONSTRAINT sale_payments_operation_store_fk
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT sale_payments_original_same_sale_fk
    FOREIGN KEY (store_id, sale_id, original_payment_id)
    REFERENCES public.sale_payments (store_id, sale_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX sale_payments_operation_event_source_unique
  ON public.sale_payments (
    store_id,
    operation_id,
    event_kind,
    COALESCE(original_payment_id, refund_id, void_id, sale_id)
  )
  WHERE operation_id IS NOT NULL AND event_kind IS NOT NULL;

CREATE INDEX sale_payments_sale_event_idx
  ON public.sale_payments (store_id, sale_id, event_kind, created_at, id);

CREATE TABLE public.sale_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  reason text NOT NULL,
  approved_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  amount_total numeric(14,2) NOT NULL,
  vat_total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_adjustments_store_sale_fk
    FOREIGN KEY (store_id, sale_id) REFERENCES public.sales (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_adjustments_operation_fk
    FOREIGN KEY (store_id, operation_id) REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_adjustments_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT sale_adjustments_store_id_sale_id_unique UNIQUE (store_id, id, sale_id),
  CONSTRAINT sale_adjustments_source_unique UNIQUE (store_id, source_type, source_id),
  CONSTRAINT sale_adjustments_operation_kind_unique UNIQUE (store_id, operation_id, kind),
  CONSTRAINT sale_adjustments_source_type_valid CHECK (source_type IN ('return', 'void', 'goodwill')),
  CONSTRAINT sale_adjustments_kind_valid CHECK (kind IN ('return_credit', 'void_credit', 'goodwill_credit')),
  CONSTRAINT sale_adjustments_source_kind_match CHECK (
    (source_type = 'return' AND kind = 'return_credit')
    OR (source_type = 'void' AND kind = 'void_credit')
    OR (source_type = 'goodwill' AND kind = 'goodwill_credit')
  ),
  CONSTRAINT sale_adjustments_status_posted CHECK (status = 'posted'),
  CONSTRAINT sale_adjustments_reason_valid CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT sale_adjustments_amount_nonnegative CHECK (amount_total >= 0),
  CONSTRAINT sale_adjustments_vat_nonnegative CHECK (vat_total >= 0)
);

CREATE INDEX sale_adjustments_sale_created_idx
  ON public.sale_adjustments (store_id, sale_id, created_at, id);

CREATE TABLE public.sale_adjustment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  adjustment_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  sale_item_id uuid REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  source_id uuid,
  quantity_credited integer NOT NULL DEFAULT 0,
  base_quantity_credited numeric(14,6) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL,
  original_discount_share numeric(14,2) NOT NULL DEFAULT 0,
  vat_share numeric(14,2) NOT NULL DEFAULT 0,
  cogs_recovered numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_adjustment_items_header_same_sale_fk
    FOREIGN KEY (store_id, adjustment_id, sale_id)
    REFERENCES public.sale_adjustments (store_id, id, sale_id) ON DELETE RESTRICT,
  CONSTRAINT sale_adjustment_items_sale_line_fk
    FOREIGN KEY (sale_id, sale_item_id) REFERENCES public.sale_items (sale_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_adjustment_items_source_type_valid
    CHECK (source_type IN ('return_item', 'void_item', 'goodwill')),
  CONSTRAINT sale_adjustment_items_source_matches_header CHECK (
    (source_type = 'return_item' AND sale_item_id IS NOT NULL AND source_id IS NOT NULL AND quantity_credited > 0)
    OR (source_type = 'void_item' AND sale_item_id IS NOT NULL AND source_id IS NOT NULL AND quantity_credited > 0)
    OR (source_type = 'goodwill' AND quantity_credited = 0 AND base_quantity_credited = 0 AND amount > 0)
  ),
  CONSTRAINT sale_adjustment_items_source_unique UNIQUE (store_id, source_type, source_id),
  CONSTRAINT sale_adjustment_items_store_sale_id_unique UNIQUE (store_id, sale_id, id),
  CONSTRAINT sale_adjustment_items_quantity_nonnegative CHECK (quantity_credited >= 0),
  CONSTRAINT sale_adjustment_items_base_quantity_nonnegative CHECK (base_quantity_credited >= 0),
  CONSTRAINT sale_adjustment_items_amount_nonnegative CHECK (amount >= 0),
  CONSTRAINT sale_adjustment_items_discount_nonnegative CHECK (original_discount_share >= 0),
  CONSTRAINT sale_adjustment_items_vat_nonnegative CHECK (vat_share >= 0),
  CONSTRAINT sale_adjustment_items_cogs_nonnegative CHECK (cogs_recovered >= 0)
);

CREATE INDEX sale_adjustment_items_sale_line_idx
  ON public.sale_adjustment_items (store_id, sale_id, sale_item_id, adjustment_id);

CREATE TABLE public.sale_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  adjustment_item_id uuid NOT NULL,
  sale_item_id uuid,
  signed_amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_payment_allocations_payment_same_sale_fk
    FOREIGN KEY (store_id, sale_id, payment_id)
    REFERENCES public.sale_payments (store_id, sale_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_payment_allocations_adjustment_item_fk
    FOREIGN KEY (store_id, sale_id, adjustment_item_id)
    REFERENCES public.sale_adjustment_items (store_id, sale_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_payment_allocations_sale_line_fk
    FOREIGN KEY (sale_id, sale_item_id) REFERENCES public.sale_items (sale_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_payment_allocations_amount_nonzero CHECK (signed_amount <> 0),
  CONSTRAINT sale_payment_allocations_source_unique UNIQUE (store_id, payment_id, adjustment_item_id)
);

CREATE INDEX sale_payment_allocations_sale_idx
  ON public.sale_payment_allocations (store_id, sale_id, payment_id);

CREATE TABLE public.legacy_financial_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sale_id uuid NOT NULL UNIQUE,
  line_amount_basis text NOT NULL,
  accounting_version smallint,
  evidence_type text NOT NULL,
  evidence_hash text,
  ambiguity_reason text,
  reviewed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  settled_cash_unknown boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_financial_classifications_sale_same_store_fk
    FOREIGN KEY (store_id, sale_id) REFERENCES public.sales (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT legacy_financial_classifications_basis_valid
    CHECK (line_amount_basis IN ('net_item_discounted', 'legacy_gross', 'legacy_unknown')),
  CONSTRAINT legacy_financial_classifications_accounting_version_positive
    CHECK (accounting_version IS NULL OR accounting_version > 0),
  CONSTRAINT legacy_financial_classifications_evidence_type_valid
    CHECK (length(btrim(evidence_type)) BETWEEN 1 AND 80),
  CONSTRAINT legacy_financial_classifications_evidence_hash_valid
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT legacy_financial_classifications_evidence_present CHECK (
    (line_amount_basis = 'legacy_unknown' AND length(btrim(COALESCE(ambiguity_reason, ''))) BETWEEN 3 AND 500)
    OR (line_amount_basis <> 'legacy_unknown' AND evidence_hash IS NOT NULL)
  )
);

ALTER TABLE public.sale_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_adjustment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_financial_classifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sale_adjustments, public.sale_adjustment_items,
  public.sale_payment_allocations, public.legacy_financial_classifications
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reject_sale_financial_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Sale financial facts are append-only.'
    USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_sale_payment_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.event_kind IS NOT NULL THEN
      RAISE EXCEPTION 'Normalized sale payment events are append-only.' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.event_kind IS NOT NULL OR NEW.event_kind IS NOT NULL THEN
    RAISE EXCEPTION 'Normalized sale payment events are append-only.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_sale_financial_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  IF NEW.accounting_version IS NULL AND NEW.operation_id IS NULL THEN
    IF TG_TABLE_NAME = 'sale_items'
      AND (to_jsonb(NEW)->>'line_amount_basis') IS DISTINCT FROM 'legacy_unknown' THEN
      RAISE EXCEPTION 'Legacy sale lines require evidence-backed classification.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sales' THEN
    IF NEW.accounting_version IS NULL OR NEW.operation_id IS NULL THEN
      RAISE EXCEPTION 'Versioned sales require an accounting version and operation.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = NEW.sale_id;
  IF NOT FOUND OR NEW.accounting_version IS DISTINCT FROM v_sale.accounting_version
    OR NEW.operation_id IS DISTINCT FROM v_sale.operation_id THEN
    RAISE EXCEPTION 'Sale line accounting and operation snapshots must match the sale.' USING ERRCODE = '23514';
  END IF;
  IF NEW.accounting_version = 5 AND NEW.line_amount_basis <> 'net_item_discounted' THEN
    RAISE EXCEPTION 'Version 5 sale lines must record net item-discounted amounts.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_sale_payment_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  IF NEW.event_kind IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.store_id = NEW.store_id AND sale.id = NEW.sale_id;
  IF NOT FOUND OR NEW.accounting_version IS DISTINCT FROM v_sale.accounting_version THEN
    RAISE EXCEPTION 'Payment accounting version must match its sale.' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_kind = 'capture' AND NEW.operation_id IS DISTINCT FROM v_sale.operation_id THEN
    RAISE EXCEPTION 'Capture operation must match the originating sale.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER sales_accounting_snapshot_guard
  BEFORE INSERT OR UPDATE OF accounting_version, operation_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION private.guard_sale_financial_snapshot();

CREATE TRIGGER sale_items_accounting_snapshot_guard
  BEFORE INSERT OR UPDATE OF accounting_version, operation_id, line_amount_basis ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_sale_financial_snapshot();

CREATE TRIGGER sale_payments_accounting_snapshot_guard
  BEFORE INSERT ON public.sale_payments
  FOR EACH ROW EXECUTE FUNCTION private.guard_sale_payment_event_insert();

CREATE TRIGGER sale_payments_normalized_events_append_only
  BEFORE UPDATE OR DELETE ON public.sale_payments
  FOR EACH ROW EXECUTE FUNCTION private.guard_sale_payment_event_mutation();

CREATE TRIGGER sale_adjustments_append_only
  BEFORE UPDATE OR DELETE ON public.sale_adjustments
  FOR EACH ROW EXECUTE FUNCTION private.reject_sale_financial_fact_mutation();

CREATE TRIGGER sale_adjustment_items_append_only
  BEFORE UPDATE OR DELETE ON public.sale_adjustment_items
  FOR EACH ROW EXECUTE FUNCTION private.reject_sale_financial_fact_mutation();

CREATE TRIGGER sale_payment_allocations_append_only
  BEFORE UPDATE OR DELETE ON public.sale_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION private.reject_sale_financial_fact_mutation();

CREATE TRIGGER legacy_financial_classifications_append_only
  BEFORE UPDATE OR DELETE ON public.legacy_financial_classifications
  FOR EACH ROW EXECUTE FUNCTION private.reject_sale_financial_fact_mutation();

CREATE OR REPLACE FUNCTION private.assert_sale_adjustment_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_adjustment_id uuid;
  v_header public.sale_adjustments%ROWTYPE;
  v_amount numeric(14,2);
  v_vat numeric(14,2);
  v_line_count integer;
BEGIN
  IF TG_TABLE_NAME = 'sale_adjustments' THEN
    v_adjustment_id := NEW.id;
  ELSE
    v_adjustment_id := NEW.adjustment_id;
  END IF;

  SELECT adjustment.* INTO v_header
  FROM public.sale_adjustments AS adjustment
  WHERE adjustment.id = v_adjustment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale credit header is missing.' USING ERRCODE = '23503';
  END IF;

  SELECT count(*)::integer,
         COALESCE(sum(item.amount), 0)::numeric(14,2),
         COALESCE(sum(item.vat_share), 0)::numeric(14,2)
  INTO v_line_count, v_amount, v_vat
  FROM public.sale_adjustment_items AS item
  WHERE item.adjustment_id = v_adjustment_id;

  IF v_line_count = 0 OR v_header.amount_total IS DISTINCT FROM v_amount OR v_header.vat_total IS DISTINCT FROM v_vat THEN
    RAISE EXCEPTION 'Sale credit lines do not reconcile to their header.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER sale_adjustments_total_matches_lines
  AFTER INSERT ON public.sale_adjustments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_sale_adjustment_totals();

CREATE CONSTRAINT TRIGGER sale_adjustment_items_total_matches_header
  AFTER INSERT ON public.sale_adjustment_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_sale_adjustment_totals();

CREATE OR REPLACE FUNCTION private.sale_financial_facts(p_sale_id uuid)
RETURNS TABLE (
  sale_id uuid,
  store_id uuid,
  accounting_version smallint,
  line_amount_basis text,
  financial_complete boolean,
  unclassified_count integer,
  gross_billed numeric(14,2),
  sale_discount numeric(14,2),
  net_billed numeric(14,2),
  posted_credits numeric(14,2),
  captured_payments numeric(14,2),
  confirmed_refunds numeric(14,2),
  net_paid numeric(14,2),
  refund_due numeric(14,2),
  settlement_unknown boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_basis text;
  v_discount numeric(14,2);
  v_gross numeric(14,2);
  v_credit numeric(14,2);
  v_captured numeric(14,2);
  v_refunded numeric(14,2);
  v_unclassified integer;
  v_settlement_unknown boolean;
  v_line_count integer;
  v_classification public.legacy_financial_classifications%ROWTYPE;
BEGIN
  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = p_sale_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT classification.* INTO v_classification
  FROM public.legacy_financial_classifications AS classification
  WHERE classification.store_id = v_sale.store_id
    AND classification.sale_id = v_sale.id;

  SELECT count(*)::integer,
    count(*) FILTER (WHERE item.line_amount_basis = 'legacy_unknown')::integer,
    CASE
      WHEN count(*) > 0 AND bool_and(item.line_amount_basis = 'net_item_discounted') THEN 'net_item_discounted'
      WHEN count(*) > 0 AND bool_and(item.line_amount_basis = 'legacy_gross') THEN 'legacy_gross'
      ELSE 'legacy_unknown'
    END
  INTO v_line_count, v_unclassified, v_basis
  FROM public.sale_items AS item
  WHERE item.sale_id = v_sale.id;

  IF v_classification.id IS NOT NULL THEN
    v_basis := v_classification.line_amount_basis;
    IF v_basis = 'legacy_unknown' THEN
      v_unclassified := GREATEST(v_unclassified, 1);
    ELSE
      v_unclassified := 0;
    END IF;
  END IF;
  IF v_basis = 'legacy_unknown' THEN
    v_unclassified := GREATEST(v_unclassified, 1);
  END IF;

  IF v_basis = 'net_item_discounted' THEN
    SELECT COALESCE(sum(item.line_total + item.item_discount_amount), 0)::numeric(14,2),
           COALESCE(sum(item.item_discount_amount), 0)::numeric(14,2)
    INTO v_gross, v_discount
    FROM public.sale_items AS item
    WHERE item.sale_id = v_sale.id;
  ELSIF v_basis = 'legacy_gross' THEN
    SELECT COALESCE(sum(item.line_total), 0)::numeric(14,2)
    INTO v_gross
    FROM public.sale_items AS item
    WHERE item.sale_id = v_sale.id;
    v_discount := v_sale.discount;
  ELSE
    v_gross := NULL;
    v_discount := NULL;
  END IF;

  SELECT (
      COALESCE(sum(adjustment.amount_total), 0)
      + COALESCE((
          SELECT sum(old_return.refund_amount)
          FROM public.sale_returns AS old_return
          WHERE old_return.sale_id = v_sale.id
            AND old_return.status = 'completed'
            AND NOT EXISTS (
              SELECT 1 FROM public.sale_adjustments AS linked
              WHERE linked.store_id = v_sale.store_id
                AND linked.sale_id = v_sale.id
                AND linked.source_type = 'return'
                AND linked.source_id = old_return.id
            )
        ), 0)
    )::numeric(14,2)
  INTO v_credit
  FROM public.sale_adjustments AS adjustment
  WHERE adjustment.store_id = v_sale.store_id
    AND adjustment.sale_id = v_sale.id
    AND adjustment.status = 'posted';

  SELECT COALESCE(sum(payment.amount) FILTER (
           WHERE (payment.event_kind = 'capture'
             OR (payment.event_kind IS NULL AND payment.status = 'captured'))
             AND payment.amount > 0
         ), 0)::numeric(14,2),
         COALESCE(sum(abs(payment.amount)) FILTER (
           WHERE (payment.event_kind IN ('refund', 'void_reversal')
             OR (payment.event_kind IS NULL AND payment.status = 'refunded'))
             AND payment.amount < 0
         ), 0)::numeric(14,2)
  INTO v_captured, v_refunded
  FROM public.sale_payments AS payment
  WHERE payment.store_id = v_sale.store_id
    AND payment.sale_id = v_sale.id;

  v_settlement_unknown := COALESCE(v_classification.settled_cash_unknown, false)
    OR (v_sale.status = 'voided' AND v_refunded = 0);

  RETURN QUERY SELECT
    v_sale.id,
    v_sale.store_id,
    COALESCE(v_sale.accounting_version, v_classification.accounting_version),
    v_basis,
    (v_basis <> 'legacy_unknown' AND v_line_count > 0),
    v_unclassified,
    v_gross,
    v_discount,
    (v_sale.total - v_credit)::numeric(14,2),
    v_credit,
    v_captured,
    v_refunded,
    (v_captured - v_refunded)::numeric(14,2),
    GREATEST(v_credit - v_refunded, 0)::numeric(14,2),
    v_settlement_unknown;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_financial_facts(p_sale_id uuid)
RETURNS TABLE (
  sale_id uuid,
  store_id uuid,
  accounting_version smallint,
  line_amount_basis text,
  financial_complete boolean,
  unclassified_count integer,
  gross_billed numeric(14,2),
  sale_discount numeric(14,2),
  net_billed numeric(14,2),
  posted_credits numeric(14,2),
  captured_payments numeric(14,2),
  confirmed_refunds numeric(14,2),
  net_paid numeric(14,2),
  refund_due numeric(14,2),
  settlement_unknown boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    RAISE EXCEPTION 'A valid MFA session is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales AS sale
    JOIN public.store_users AS membership
      ON membership.store_id = sale.store_id
     AND membership.profile_id = (SELECT auth.uid())
    WHERE sale.id = p_sale_id
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM private.sale_financial_facts(p_sale_id);
END;
$function$;

CREATE OR REPLACE FUNCTION private.create_sale_credit(
  p_store_id uuid,
  p_sale_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_source_type text,
  p_source_id uuid,
  p_reason text,
  p_approved_by uuid,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_operation public.pos_operations%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_approver_role text;
  v_adjustment_id uuid;
  v_existing_id uuid;
  v_input jsonb;
  v_output jsonb := '[]'::jsonb;
  v_line public.sale_items%ROWTYPE;
  v_line_id uuid;
  v_source_item_id uuid;
  v_quantity integer;
  v_prior_quantity integer;
  v_cumulative_quantity integer;
  v_prior_amount numeric(14,2);
  v_prior_discount numeric(14,2);
  v_prior_vat numeric(14,2);
  v_prior_base_quantity numeric(14,6);
  v_prior_cogs numeric(14,2);
  v_line_amount numeric(14,2);
  v_discount_share numeric(14,2);
  v_vat_share numeric(14,2);
  v_base_quantity numeric(14,6);
  v_cogs_recovered numeric(14,2);
  v_cogs_capacity numeric(14,2);
  v_requested_amount numeric(14,2);
  v_total_amount numeric(14,2) := 0;
  v_total_vat numeric(14,2) := 0;
  v_existing_vat numeric(14,2) := 0;
  v_existing_credit numeric(14,2) := 0;
  v_tax_cents numeric;
  v_weight_total numeric;
  v_vat_line_cents bigint;
  v_allowed_capability text;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_source_type IS NULL
    OR p_kind NOT IN ('return_credit', 'void_credit', 'goodwill_credit')
    OR p_source_type NOT IN ('return', 'void', 'goodwill')
    OR (p_source_type = 'return' AND p_kind <> 'return_credit')
    OR (p_source_type = 'void' AND p_kind <> 'void_credit')
    OR (p_source_type = 'goodwill' AND p_kind <> 'goodwill_credit')
    OR p_source_id IS NULL
    OR p_store_id IS NULL
    OR p_sale_id IS NULL
    OR p_operation_id IS NULL
    OR p_approved_by IS NULL
    OR p_items IS NULL
    OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Sale credit request is invalid.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Sale credit lines must be an array.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale credit requires at least one line.' USING ERRCODE = '22023';
  END IF;
  IF p_kind <> 'goodwill_credit' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS line(value)
    GROUP BY line.value->>'sale_item_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A sale item may appear only once in a credit operation.' USING ERRCODE = '22023';
  END IF;

  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.store_id = p_store_id AND operation.id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.actor_id <> v_actor_id OR v_operation.status <> 'processing' THEN
    RAISE EXCEPTION 'Sale credit operation is not active for this actor.' USING ERRCODE = '42501';
  END IF;

  SELECT adjustment.id INTO v_existing_id
  FROM public.sale_adjustments AS adjustment
  WHERE adjustment.store_id = p_store_id
    AND adjustment.operation_id = p_operation_id
    AND adjustment.kind = p_kind;
  IF FOUND THEN
    RETURN v_existing_id;
  END IF;

  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.store_id = p_store_id AND sale.id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale does not belong to the operation store.' USING ERRCODE = '42501';
  END IF;

  IF v_sale.accounting_version IS DISTINCT FROM 5
    OR v_sale.status IN ('voided', 'refunded')
    OR NOT EXISTS (SELECT 1 FROM public.sale_items AS item WHERE item.sale_id = p_sale_id)
    OR EXISTS (
      SELECT 1 FROM public.sale_items AS item
      WHERE item.sale_id = p_sale_id
        AND (item.accounting_version IS DISTINCT FROM 5
          OR item.line_amount_basis IS DISTINCT FROM 'net_item_discounted')
    ) THEN
    RAISE EXCEPTION 'Legacy or unclassified sales require financial reconciliation before credit.'
      USING ERRCODE = 'P0001', DETAIL = '{"business_code":"LEGACY_RECONCILIATION_REQUIRED"}';
  END IF;

  SELECT profile.role::text INTO v_approver_role
  FROM public.profiles AS profile
  JOIN public.store_users AS membership
    ON membership.profile_id = profile.id AND membership.store_id = p_store_id
  WHERE profile.id = p_approved_by;
  IF v_approver_role IS NULL THEN
    RAISE EXCEPTION 'Credit approver must be assigned to this store.' USING ERRCODE = '42501';
  END IF;
  v_allowed_capability := CASE p_kind
    WHEN 'return_credit' THEN 'approve_return'
    WHEN 'void_credit' THEN 'approve_void'
    ELSE 'approve_refund'
  END;
  IF v_approver_role <> 'admin' AND NOT (
    v_approver_role = 'cashier' AND EXISTS (
      SELECT 1 FROM public.store_capability_grants AS grant_row
      WHERE grant_row.store_id = p_store_id
        AND grant_row.profile_id = p_approved_by
        AND grant_row.target_profile_id = p_approved_by
        AND grant_row.capability = v_allowed_capability
        AND grant_row.revoked_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Credit approver does not have the required store authority.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(adjustment.amount_total), 0)::numeric(14,2),
         COALESCE(sum(adjustment.vat_total), 0)::numeric(14,2)
  INTO v_existing_credit, v_existing_vat
  FROM public.sale_adjustments AS adjustment
  WHERE adjustment.store_id = p_store_id AND adjustment.sale_id = p_sale_id;
  v_existing_credit := v_existing_credit + COALESCE((
    SELECT sum(old_return.refund_amount)::numeric(14,2)
    FROM public.sale_returns AS old_return
    WHERE old_return.sale_id = p_sale_id AND old_return.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_adjustments AS linked
        WHERE linked.store_id = p_store_id AND linked.sale_id = p_sale_id
          AND linked.source_type = 'return' AND linked.source_id = old_return.id
      )
  ), 0);

  SELECT round(v_sale.tax * 100)::numeric,
         COALESCE(sum(round(item.line_total * 100)), 0)::numeric
  INTO v_tax_cents, v_weight_total
  FROM public.sale_items AS item WHERE item.sale_id = p_sale_id;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items) AS entry(value)
  LOOP
    IF jsonb_typeof(v_input) IS DISTINCT FROM 'object'
      OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_input) AS key(name)
        WHERE key.name <> ALL (ARRAY['sale_item_id', 'source_item_id', 'quantity_credited', 'amount', 'cogs_recovered'])
      ) THEN
      RAISE EXCEPTION 'Credit line contains unsupported fields.' USING ERRCODE = '22023';
    END IF;

    v_source_item_id := NULLIF(v_input->>'source_item_id', '')::uuid;
    IF p_kind = 'goodwill_credit' THEN
      IF NULLIF(v_input->>'sale_item_id', '') IS NOT NULL
        OR COALESCE(NULLIF(v_input->>'quantity_credited', '')::integer, 0) <> 0
        OR v_source_item_id IS NOT NULL THEN
        RAISE EXCEPTION 'Goodwill credit lines must not claim returned units.' USING ERRCODE = '22023';
      END IF;
      v_requested_amount := round((v_input->>'amount')::numeric, 2);
      IF v_requested_amount <= 0 THEN
        RAISE EXCEPTION 'Goodwill credit amount must be positive.' USING ERRCODE = '22023';
      END IF;
      v_line_id := NULL;
      v_quantity := 0;
      v_base_quantity := 0;
      v_line_amount := v_requested_amount;
      v_discount_share := 0;
      v_vat_share := CASE WHEN v_sale.total > 0
        THEN round(v_sale.tax * v_requested_amount / v_sale.total, 2) ELSE 0 END;
      v_cogs_recovered := 0;
    ELSE
      IF v_source_item_id IS NULL THEN
        RAISE EXCEPTION 'A physical credit line requires a source item.' USING ERRCODE = '22023';
      END IF;
      v_line_id := (v_input->>'sale_item_id')::uuid;
      v_quantity := (v_input->>'quantity_credited')::integer;
      IF v_line_id IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'A physical credit line requires a sale item and positive quantity.' USING ERRCODE = '22023';
      END IF;
      SELECT item.* INTO v_line
      FROM public.sale_items AS item
      WHERE item.id = v_line_id AND item.sale_id = p_sale_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Credit line does not belong to the sale.' USING ERRCODE = '42501';
      END IF;

      SELECT COALESCE(sum(item.quantity_credited), 0)::integer,
             COALESCE(sum(item.amount), 0)::numeric(14,2),
             COALESCE(sum(item.original_discount_share), 0)::numeric(14,2),
             COALESCE(sum(item.vat_share), 0)::numeric(14,2),
             COALESCE(sum(item.base_quantity_credited), 0)::numeric(14,6),
             COALESCE(sum(item.cogs_recovered), 0)::numeric(14,2)
      INTO v_prior_quantity, v_prior_amount, v_prior_discount, v_prior_vat,
           v_prior_base_quantity, v_prior_cogs
      FROM public.sale_adjustment_items AS item
      WHERE item.store_id = p_store_id AND item.sale_id = p_sale_id
        AND item.sale_item_id = v_line_id
        AND item.source_type IN ('return_item', 'void_item');

      v_cumulative_quantity := v_prior_quantity + v_quantity;
      IF v_cumulative_quantity > v_line.quantity THEN
        RAISE EXCEPTION 'Credit quantity exceeds the sold quantity.'
          USING ERRCODE = 'P0001', DETAIL = '{"business_code":"CREDIT_LIMIT"}';
      END IF;
      v_line_amount := round(v_line.line_total * v_cumulative_quantity / v_line.quantity, 2) - v_prior_amount;
      v_discount_share := round(v_line.item_discount_amount * v_cumulative_quantity / v_line.quantity, 2) - v_prior_discount;
      v_base_quantity := round(v_line.base_unit_quantity * v_cumulative_quantity / v_line.quantity, 6) - v_prior_base_quantity;
      v_cogs_capacity := round(COALESCE(v_line.cogs, 0) * v_cumulative_quantity / v_line.quantity, 2) - v_prior_cogs;
      v_cogs_recovered := round(COALESCE(NULLIF(v_input->>'cogs_recovered', '')::numeric, 0), 2);
      IF v_cogs_recovered < 0 OR v_cogs_recovered > GREATEST(v_cogs_capacity, 0) THEN
        RAISE EXCEPTION 'COGS recovery exceeds the line entitlement.' USING ERRCODE = '22023';
      END IF;

      IF v_weight_total > 0 AND v_tax_cents > 0 THEN
        WITH weights AS (
          SELECT item.id, round(item.line_total * 100)::numeric AS weight
          FROM public.sale_items AS item WHERE item.sale_id = p_sale_id
        ), raw AS (
          SELECT weights.id,
            floor(v_tax_cents * weights.weight / v_weight_total)::bigint AS floor_cents,
            mod(v_tax_cents * weights.weight, v_weight_total) AS remainder
          FROM weights
        ), ranked AS (
          SELECT raw.id, raw.floor_cents, raw.remainder,
            row_number() OVER (ORDER BY raw.remainder DESC, raw.id ASC) AS remainder_rank,
            sum(raw.floor_cents) OVER () AS floor_total
          FROM raw
        )
        SELECT (ranked.floor_cents + CASE
          WHEN ranked.remainder_rank <= v_tax_cents - ranked.floor_total THEN 1 ELSE 0 END)
        INTO v_vat_line_cents
        FROM ranked WHERE ranked.id = v_line_id;
      ELSE
        v_vat_line_cents := 0;
      END IF;
      v_vat_share := round(v_vat_line_cents::numeric * v_cumulative_quantity / v_line.quantity / 100, 2) - v_prior_vat;
      v_vat_share := LEAST(GREATEST(v_vat_share, 0), GREATEST(v_sale.tax - v_prior_vat, 0));
    END IF;

    IF v_line_amount < 0 OR v_discount_share < 0 OR v_vat_share < 0 THEN
      RAISE EXCEPTION 'Cumulative credit allocation would reverse a prior amount.' USING ERRCODE = '23514';
    END IF;
    v_total_amount := v_total_amount + v_line_amount;
    v_total_vat := v_total_vat + v_vat_share;
    v_output := v_output || jsonb_build_array(jsonb_build_object(
      'sale_item_id', v_line_id,
      'source_type', CASE p_source_type WHEN 'return' THEN 'return_item' WHEN 'void' THEN 'void_item' ELSE 'goodwill' END,
      'source_id', v_source_item_id,
      'quantity_credited', v_quantity,
      'base_quantity_credited', v_base_quantity,
      'amount', v_line_amount,
      'original_discount_share', v_discount_share,
      'vat_share', v_vat_share,
      'cogs_recovered', v_cogs_recovered
    ));
  END LOOP;

  IF v_existing_credit + v_total_amount > v_sale.total THEN
    RAISE EXCEPTION 'Cumulative commercial credit exceeds the original sale total.'
      USING ERRCODE = 'P0001', DETAIL = '{"business_code":"CREDIT_LIMIT"}';
  END IF;
  IF v_existing_vat + v_total_vat > v_sale.tax THEN
    RAISE EXCEPTION 'Cumulative credited VAT exceeds the original sale VAT.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.sale_adjustments (
    store_id, sale_id, operation_id, source_type, source_id, kind, status,
    reason, approved_by, approved_at, amount_total, vat_total, created_by
  ) VALUES (
    p_store_id, p_sale_id, p_operation_id, p_source_type, p_source_id, p_kind, 'posted',
    v_reason, p_approved_by, now(), v_total_amount, v_total_vat, v_actor_id
  ) RETURNING id INTO v_adjustment_id;

  FOR v_input IN SELECT value FROM jsonb_array_elements(v_output) AS entry(value)
  LOOP
    INSERT INTO public.sale_adjustment_items (
      store_id, adjustment_id, sale_id, sale_item_id, source_type, source_id,
      quantity_credited, base_quantity_credited, amount, original_discount_share,
      vat_share, cogs_recovered
    ) VALUES (
      p_store_id, v_adjustment_id, p_sale_id,
      NULLIF(v_input->>'sale_item_id', '')::uuid,
      v_input->>'source_type', NULLIF(v_input->>'source_id', '')::uuid,
      (v_input->>'quantity_credited')::integer,
      (v_input->>'base_quantity_credited')::numeric,
      (v_input->>'amount')::numeric,
      (v_input->>'original_discount_share')::numeric,
      (v_input->>'vat_share')::numeric,
      (v_input->>'cogs_recovered')::numeric
    );
  END LOOP;

  RETURN v_adjustment_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.reject_sale_financial_fact_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_sale_payment_event_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_sale_financial_snapshot() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_sale_payment_event_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_sale_adjustment_totals() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sale_financial_facts(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.create_sale_credit(uuid, uuid, uuid, text, text, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_sale_financial_facts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_financial_facts(uuid) TO authenticated;

COMMENT ON COLUMN public.sales.accounting_version IS
  'Canonical financial contract version. NULL is legacy and is not auto-classified.';
COMMENT ON COLUMN public.sale_items.line_amount_basis IS
  'Whether line_total is already net of item discount. Existing rows default to legacy_unknown without changing receipt values.';
COMMENT ON COLUMN public.sale_payments.event_kind IS
  'NULL preserves legacy status semantics; normalized rows identify capture, refund, or void_reversal explicitly.';
COMMENT ON TABLE public.sale_adjustments IS
  'Append-only posted commercial credits. Refund and physical cash facts remain separate.';
COMMENT ON TABLE public.legacy_financial_classifications IS
  'Evidence-backed legacy financial basis; migration intentionally inserts no inferred classifications.';

