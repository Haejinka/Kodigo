-- GCash wallets never block a service for insufficient recorded balance.
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
  -- GCash balances are shared with the owner's personal use, so they are not tracked as a limit:
  -- if a debit exceeds the recorded balance, silently top the recorded balance up first.
  IF v_wallet.wallet_type = 'gcash' AND p_amount < 0 AND v_wallet.posted_balance < -p_amount THEN
    PERFORM pg_catalog.set_config('kodigo.wallet_writer', p_operation_id::text, true);
    INSERT INTO public.wallet_movements (
      store_id, wallet_account_id, operation_id, service_id, source_key, movement_kind,
      signed_amount, balance_before, balance_after, external_reference, reason, actor_id
    ) VALUES (
      p_store_id, p_wallet_id, p_operation_id, p_service_id, p_source_key || '/auto-balance', 'adjustment',
      -p_amount - v_wallet.posted_balance, v_wallet.posted_balance, -p_amount, NULL,
      'Automatic balance sync (GCash balance is not tracked)', (SELECT auth.uid())
    );
    UPDATE public.wallet_accounts AS wallet
    SET posted_balance = -p_amount, version = wallet.version + 1, updated_at = pg_catalog.clock_timestamp()
    WHERE wallet.store_id = p_store_id AND wallet.id = p_wallet_id;
    SELECT wallet.* INTO v_wallet FROM public.wallet_accounts AS wallet
    WHERE wallet.store_id = p_store_id AND wallet.id = p_wallet_id;
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
