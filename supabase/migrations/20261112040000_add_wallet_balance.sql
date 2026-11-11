-- One-step "add balance" for a store admin (e.g. buying load from the supplier).
-- The second-admin approval flow (request/decide/apply) remains available for stores that want it.
CREATE OR REPLACE FUNCTION public.add_wallet_balance(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_amount numeric(14,2);
  v_note text;
  v_wallet public.wallet_accounts%ROWTYPE;
  v_movement public.wallet_movements%ROWTYPE;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('add_wallet_balance', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 3
    OR NOT (v_payload ?& ARRAY['wallet_id', 'amount', 'note'])
    OR pg_catalog.jsonb_typeof(v_payload->'wallet_id') <> 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'amount') <> 'string'
    OR (v_payload->'note' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'note') <> 'string') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Wallet balance fields are invalid.');
  END IF;
  IF (v_payload->>'amount') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Amount must be a positive number with at most two decimals.');
  END IF;
  v_amount := (v_payload->>'amount')::numeric;
  IF v_amount <= 0 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Amount must be greater than zero.');
  END IF;
  v_note := NULLIF(pg_catalog.btrim(COALESCE(v_payload->>'note', '')), '');
  IF v_note IS NOT NULL AND (pg_catalog.length(v_note) > 300 OR v_note ~ '[[:cntrl:]]') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Note is too long or invalid.');
  END IF;
  SELECT wallet.* INTO v_wallet FROM public.wallet_accounts AS wallet
  WHERE wallet.store_id = v_operation.store_id AND wallet.id = (v_payload->>'wallet_id')::uuid AND wallet.active;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('WALLET_NOT_FOUND', 'An active wallet for this store is required.', '23503');
  END IF;
  v_movement := private.post_digital_wallet_movement(
    v_operation.store_id, v_wallet.id, v_operation.id, NULL,
    'wallet-add-balance/' || v_operation.id::text, 'topup', v_amount, NULL,
    COALESCE(v_note, 'Balance added by store admin')
  );
  v_result := pg_catalog.jsonb_build_object('wallet_id', v_wallet.id, 'added', v_amount::text,
    'balance_after', v_movement.balance_after::text);
  RETURN private.finish_pos_operation(v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'wallet_account', v_wallet.id::text,
    v_wallet.version + 1, v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.add_wallet_balance(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_wallet_balance(jsonb) TO authenticated;
