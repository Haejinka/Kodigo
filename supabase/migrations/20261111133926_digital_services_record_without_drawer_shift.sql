-- Cash handling for a digital service is part of its own immutable service
-- transaction and clearing record. A drawer shift is optional; when present,
-- the cash leg is also posted to that drawer's cash ledger.
ALTER TABLE public.digital_service_transactions
  ALTER COLUMN shift_id DROP NOT NULL,
  ALTER COLUMN terminal_id DROP NOT NULL;

COMMENT ON COLUMN public.digital_service_transactions.shift_id IS
  'Optional cashier shift. Null when the digital service was recorded outside a drawer shift.';
COMMENT ON COLUMN public.digital_service_transactions.terminal_id IS
  'Optional POS terminal associated with the cashier shift.';
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
  IF (v_operation.shift_id IS NULL) <> (v_operation.terminal_id IS NULL) THEN
    PERFORM private.raise_pos_operation_error('INVALID_SHIFT_CONTEXT', 'A cashier shift and terminal must be supplied together.');
  END IF;
  IF v_operation.shift_id IS NOT NULL THEN
    SELECT shift.* INTO v_shift FROM public.cashier_shifts AS shift
    WHERE shift.store_id = v_operation.store_id AND shift.id = v_operation.shift_id FOR UPDATE;
    IF NOT FOUND OR v_shift.terminal_id <> v_operation.terminal_id OR v_shift.state <> 'active'
      OR (v_shift.cashier_id <> v_actor AND (SELECT profile.role::text FROM public.profiles AS profile WHERE profile.id = v_actor) <> 'admin') THEN
      PERFORM private.raise_pos_operation_error('SHIFT_NOT_ACTIVE', 'The selected shift is not active for this cashier and terminal.');
    END IF;
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
  IF v_shift.id IS NOT NULL THEN
    v_cash := private.post_cash_movement(
      v_operation.store_id, v_shift.drawer_id, v_shift.id, v_operation.id,
      'digital-service-cash/' || v_service.id::text, 'digital_service', v_service.id,
      CASE WHEN v_cash_delta < 0 THEN 'digital_cash_out' ELSE 'digital_cash_in' END,
      v_cash_amount, v_cash_delta, 'Manual ' || v_service_kind || ' cash leg', v_operation.local_occurred_at
    );
  END IF;
  INSERT INTO public.service_clearing_events (store_id, service_id, operation_id, source_key, leg_kind, signed_amount, cash_movement_id)
  VALUES (v_service.store_id, v_service.id, v_operation.id, 'cash-principal', 'cash_principal',
    v_cash_delta, v_cash.id);
  IF v_service_kind = 'digital_product' THEN
    UPDATE public.digital_service_transactions AS service
    SET state = 'completed', cash_leg_state = 'confirmed', version = service.version + 1,
        updated_at = pg_catalog.clock_timestamp(), completed_at = v_now
    WHERE service.store_id = v_service.store_id AND service.id = v_service.id
    RETURNING * INTO v_service;
    INSERT INTO public.digital_service_events (store_id, service_id, operation_id, event_kind, step, actor_id, details)
    VALUES (v_service.store_id, v_service.id, v_operation.id, 'completed', 'manual_delivery', v_actor,
      pg_catalog.jsonb_build_object('cash_delta', v_cash_delta::text, 'cash_movement_id', v_cash.id, 'delivery_evidence_ref', v_evidence,
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
      pg_catalog.jsonb_build_object('cash_delta', v_cash_delta::text, 'external_event_id', v_external.id, 'cash_movement_id', v_cash.id,
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
    'cash_delta', v_cash_delta::text, 'cash_movement_id', v_cash.id,
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
          'cash_delta', service.quote_snapshot->>'cash_delta',
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
