-- Sales written by process_pos_sale_v4 without an operation already store line_total
-- net of item discounts (since 20261021 fix_pos_item_discount_snapshots), but cannot carry
-- an accounting_version, so they were reported as legacy_unknown with no revenue.
-- Treat unclassified, unversioned sales from that date onward as net_item_discounted.

CREATE OR REPLACE FUNCTION private.sale_financial_facts(p_sale_id uuid)
 RETURNS TABLE(sale_id uuid, store_id uuid, accounting_version smallint, line_amount_basis text, financial_complete boolean, unclassified_count integer, gross_billed numeric, sale_discount numeric, net_billed numeric, posted_credits numeric, captured_payments numeric, confirmed_refunds numeric, net_paid numeric, refund_due numeric, settlement_unknown boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  ELSIF v_basis = 'legacy_unknown'
    AND v_sale.accounting_version IS NULL
    AND v_sale.operation_id IS NULL
    AND v_line_count > 0
    AND v_sale.created_at >= timestamptz '2026-10-21 00:00:00+00' THEN
    v_basis := 'net_item_discounted';
    v_unclassified := 0;
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
