-- Migration 23: persisted end-to-end notifications

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text NOT NULL,
  target_roles text[] NOT NULL DEFAULT ARRAY['admin']::text[],
  source_table text,
  source_id uuid,
  entity_type text,
  entity_id uuid,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  selling_option_id uuid REFERENCES public.product_selling_options(id) ON DELETE SET NULL,
  stock_source text,
  current_stock numeric(12,3),
  threshold numeric(12,3),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_severity_check
    CHECK (severity IN ('info', 'success', 'warning', 'critical', 'error')),
  CONSTRAINT notifications_target_roles_check
    CHECK (target_roles <@ ARRAY['admin', 'cashier', 'super_admin']::text[]),
  CONSTRAINT notifications_title_nonempty CHECK (length(trim(title)) > 0),
  CONSTRAINT notifications_message_nonempty CHECK (length(trim(message)) > 0)
);

CREATE TABLE IF NOT EXISTS public.notification_user_states (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS notifications_store_created_idx
  ON public.notifications(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_created_idx
  ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_product_option_idx
  ON public.notifications(product_id, selling_option_id);
DROP INDEX IF EXISTS notifications_unresolved_dedupe_idx;
CREATE UNIQUE INDEX notifications_unresolved_dedupe_idx
  ON public.notifications(store_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_user_states_user_idx
  ON public.notification_user_states(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notification_user_states_unread_idx
  ON public.notification_user_states(user_id, notification_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_user_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_id_idx
  ON public.notification_preferences(user_id);

DROP POLICY IF EXISTS "notification_preferences: own read" ON public.notification_preferences;
CREATE POLICY "notification_preferences: own read" ON public.notification_preferences
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notification_preferences: own insert" ON public.notification_preferences;
CREATE POLICY "notification_preferences: own insert" ON public.notification_preferences
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notification_preferences: own update" ON public.notification_preferences;
CREATE POLICY "notification_preferences: own update" ON public.notification_preferences
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_notification_user_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_notification_user_state_trigger ON public.notification_user_states;
CREATE TRIGGER touch_notification_user_state_trigger
  BEFORE UPDATE ON public.notification_user_states
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_notification_user_state();

CREATE OR REPLACE FUNCTION public.notification_visible_to_user(
  p_store_id uuid,
  p_target_roles text[],
  p_type text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE(public.current_user_role()::text, '') = ANY(COALESCE(p_target_roles, ARRAY[]::text[]))
    AND (p_store_id IS NULL OR public.user_belongs_to_store(p_store_id))
    AND CASE
      WHEN p_type = 'low_stock' THEN COALESCE((
        SELECT np.low_stock
        FROM public.notification_preferences np
        WHERE np.user_id = auth.uid()
      ), true)
      WHEN p_type = 'out_of_stock' THEN COALESCE((
        SELECT np.out_of_stock
        FROM public.notification_preferences np
        WHERE np.user_id = auth.uid()
      ), true)
      ELSE true
    END;
$$;

DROP POLICY IF EXISTS "notifications: scoped read" ON public.notifications;
CREATE POLICY "notifications: scoped read" ON public.notifications
FOR SELECT TO authenticated
USING (public.notification_visible_to_user(store_id, target_roles, type));

DROP POLICY IF EXISTS "notification_user_states: own read" ON public.notification_user_states;
CREATE POLICY "notification_user_states: own read" ON public.notification_user_states
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notification_user_states: own insert" ON public.notification_user_states;
CREATE POLICY "notification_user_states: own insert" ON public.notification_user_states
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.id = notification_user_states.notification_id
      AND public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
  )
);

DROP POLICY IF EXISTS "notification_user_states: own update" ON public.notification_user_states;
CREATE POLICY "notification_user_states: own update" ON public.notification_user_states
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.id = notification_user_states.notification_id
      AND public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.id = notification_user_states.notification_id
      AND public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
  )
);

DROP POLICY IF EXISTS "notification_user_states: own delete" ON public.notification_user_states;
CREATE POLICY "notification_user_states: own delete" ON public.notification_user_states
FOR DELETE TO authenticated
USING (user_id = auth.uid());

GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_user_states TO authenticated;

CREATE OR REPLACE FUNCTION public.create_notification(
  p_store_id uuid,
  p_type text,
  p_severity text,
  p_title text,
  p_message text,
  p_target_roles text[] DEFAULT ARRAY['admin']::text[],
  p_source_table text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_selling_option_id uuid DEFAULT NULL,
  p_stock_source text DEFAULT NULL,
  p_current_stock numeric DEFAULT NULL,
  p_threshold numeric DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RAISE EXCEPTION 'Notification type is required';
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Notification title is required';
  END IF;

  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'Notification message is required';
  END IF;

  IF p_severity NOT IN ('info', 'success', 'warning', 'critical', 'error') THEN
    RAISE EXCEPTION 'Invalid notification severity %', p_severity;
  END IF;

  IF p_target_roles IS NULL OR array_length(p_target_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one target role is required';
  END IF;

  IF NOT p_target_roles <@ ARRAY['admin', 'cashier', 'super_admin']::text[] THEN
    RAISE EXCEPTION 'Invalid notification target role';
  END IF;

  IF p_dedupe_key IS NOT NULL THEN
    SELECT id
    INTO v_id
    FROM public.notifications
    WHERE store_id IS NOT DISTINCT FROM p_store_id
      AND dedupe_key = p_dedupe_key
      AND resolved_at IS NULL
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.notifications
      SET
        type = p_type,
        severity = p_severity,
        title = p_title,
        message = p_message,
        target_roles = p_target_roles,
        source_table = p_source_table,
        source_id = p_source_id,
        entity_type = p_entity_type,
        entity_id = p_entity_id,
        product_id = p_product_id,
        selling_option_id = p_selling_option_id,
        stock_source = p_stock_source,
        current_stock = p_current_stock,
        threshold = p_threshold,
        metadata = COALESCE(p_metadata, '{}'::jsonb)
      WHERE id = v_id;

      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.notifications (
    store_id,
    type,
    severity,
    title,
    message,
    target_roles,
    source_table,
    source_id,
    entity_type,
    entity_id,
    product_id,
    selling_option_id,
    stock_source,
    current_stock,
    threshold,
    metadata,
    dedupe_key
  )
  VALUES (
    p_store_id,
    p_type,
    p_severity,
    p_title,
    p_message,
    p_target_roles,
    p_source_table,
    p_source_id,
    p_entity_type,
    p_entity_id,
    p_product_id,
    p_selling_option_id,
    p_stock_source,
    p_current_stock,
    p_threshold,
    COALESCE(p_metadata, '{}'::jsonb),
    p_dedupe_key
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_stock_notification(p_store_id uuid, p_dedupe_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_dedupe_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.notifications
  SET resolved_at = now()
  WHERE store_id IS NOT DISTINCT FROM p_store_id
    AND dedupe_key = p_dedupe_key
    AND resolved_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.stock_option_display_label(
  p_kind text,
  p_label text,
  p_unit_label text,
  p_quantity_value numeric,
  p_quantity_unit text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_kind = 'sack' AND p_quantity_value IS NOT NULL THEN
      trim(trailing ' ' from (
        trim(trailing '.' from trim(trailing '0' from p_quantity_value::text))
        || ' ' || COALESCE(NULLIF(p_quantity_unit, ''), 'kg')
        || ' ' || COALESCE(NULLIF(p_unit_label, ''), 'sack')
      ))
    ELSE COALESCE(NULLIF(p_label, ''), NULLIF(p_unit_label, ''), 'unit')
  END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_selling_option_stock_notification(p_option_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_option public.product_selling_options%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_category_name text;
  v_stock numeric;
  v_threshold numeric;
  v_dedupe_key text;
  v_is_rice boolean;
  v_display text;
  v_type text;
  v_severity text;
  v_title text;
  v_message text;
BEGIN
  SELECT *
  INTO v_option
  FROM public.product_selling_options
  WHERE id = p_option_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = v_option.product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT c.name
  INTO v_category_name
  FROM public.categories c
  WHERE c.id = v_product.category_id;

  v_dedupe_key := 'stock:' || v_option.product_id::text || ':' || v_option.id::text;

  IF NOT v_option.is_active THEN
    PERFORM public.resolve_stock_notification(v_option.store_id, v_dedupe_key);
    RETURN;
  END IF;

  v_stock := COALESCE(v_option.stock_quantity, 0);
  v_threshold := COALESCE(v_option.low_stock_threshold, 0);

  IF v_stock > 0 AND (v_threshold <= 0 OR v_stock > v_threshold) THEN
    PERFORM public.resolve_stock_notification(v_option.store_id, v_dedupe_key);
    RETURN;
  END IF;

  v_is_rice := lower(COALESCE(v_product.name, '') || ' ' || COALESCE(v_category_name, '')) LIKE '%rice%';
  v_display := public.stock_option_display_label(
    v_option.kind,
    v_option.label,
    v_option.unit_label,
    v_option.quantity_value,
    v_option.quantity_unit
  );

  IF v_stock <= 0 THEN
    v_type := 'out_of_stock';
    v_severity := 'critical';
    IF v_is_rice AND v_option.kind = 'kilo' THEN
      v_title := 'Rice kilo stock is out';
    ELSIF v_is_rice AND v_option.kind = 'sack' THEN
      v_title := 'Rice ' || v_display || ' stock is out';
    ELSE
      v_title := v_product.name || ' is out of stock';
    END IF;
    v_message := v_product.name || ' (' || v_display || ') has no stock remaining.';
  ELSE
    v_type := 'low_stock';
    v_severity := 'warning';
    IF v_is_rice AND v_option.kind = 'kilo' THEN
      v_title := 'Rice kilo stock low';
    ELSIF v_is_rice AND v_option.kind = 'sack' THEN
      v_title := 'Rice ' || v_display || ' stock low';
    ELSE
      v_title := 'Low stock: ' || v_product.name;
    END IF;
    v_message := v_product.name || ' (' || v_display || ') has ' || v_stock::text ||
      ' left; threshold is ' || v_threshold::text || '.';
  END IF;

  PERFORM public.create_notification(
    v_option.store_id,
    v_type,
    v_severity,
    v_title,
    v_message,
    ARRAY['admin']::text[],
    'product_selling_options',
    v_option.id,
    'product',
    v_product.id,
    v_product.id,
    v_option.id,
    'selling_option',
    v_stock,
    v_threshold,
    jsonb_build_object(
      'productName', v_product.name,
      'categoryName', COALESCE(v_category_name, 'Uncategorized'),
      'sellingOptionLabel', v_display,
      'kind', v_option.kind,
      'unitLabel', v_option.unit_label,
      'packageSize', v_option.quantity_value,
      'packageUnit', v_option.quantity_unit
    ),
    v_dedupe_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_product_stock_notification(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_category_name text;
  v_dedupe_key text;
  v_type text;
  v_severity text;
  v_title text;
  v_message text;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.product_selling_options pso
    WHERE pso.product_id = p_product_id
      AND pso.is_active
  ) THEN
    RETURN;
  END IF;

  v_dedupe_key := 'stock:' || v_product.id::text || ':product';

  IF v_product.current_stock > 0
    AND (v_product.min_stock_level <= 0 OR v_product.current_stock > v_product.min_stock_level) THEN
    PERFORM public.resolve_stock_notification(v_product.store_id, v_dedupe_key);
    RETURN;
  END IF;

  SELECT c.name
  INTO v_category_name
  FROM public.categories c
  WHERE c.id = v_product.category_id;

  IF v_product.current_stock <= 0 THEN
    v_type := 'out_of_stock';
    v_severity := 'critical';
    v_title := v_product.name || ' is out of stock';
    v_message := v_product.name || ' has no stock remaining.';
  ELSE
    v_type := 'low_stock';
    v_severity := 'warning';
    v_title := 'Low stock: ' || v_product.name;
    v_message := v_product.name || ' has ' || v_product.current_stock::text ||
      ' left; threshold is ' || v_product.min_stock_level::text || '.';
  END IF;

  PERFORM public.create_notification(
    v_product.store_id,
    v_type,
    v_severity,
    v_title,
    v_message,
    ARRAY['admin']::text[],
    'products',
    v_product.id,
    'product',
    v_product.id,
    v_product.id,
    NULL,
    'product',
    v_product.current_stock,
    v_product.min_stock_level,
    jsonb_build_object(
      'productName', v_product.name,
      'categoryName', COALESCE(v_category_name, 'Uncategorized'),
      'sellingOptionLabel', COALESCE(NULLIF(v_product.unit, ''), 'unit'),
      'unitLabel', COALESCE(NULLIF(v_product.unit, ''), 'unit')
    ),
    v_dedupe_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_evaluate_selling_option_stock_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.evaluate_selling_option_stock_notification(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evaluate_selling_option_stock_notification_trigger ON public.product_selling_options;
CREATE TRIGGER evaluate_selling_option_stock_notification_trigger
  AFTER INSERT OR UPDATE OF stock_quantity, low_stock_threshold, is_active, label, unit_label, quantity_value, quantity_unit, kind
  ON public.product_selling_options
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_evaluate_selling_option_stock_notification();

CREATE OR REPLACE FUNCTION public.trg_evaluate_product_stock_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.evaluate_product_stock_notification(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evaluate_product_stock_notification_trigger ON public.products;
CREATE TRIGGER evaluate_product_stock_notification_trigger
  AFTER UPDATE OF current_stock, min_stock_level, unit
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_evaluate_product_stock_notification();

CREATE OR REPLACE FUNCTION public.trg_notify_stock_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name text;
  v_label text;
  v_severity text;
BEGIN
  IF COALESCE(NEW.stock_source, '') = 'conversion' THEN
    IF NEW.quantity_delta < 0 THEN
      SELECT name INTO v_product_name
      FROM public.products
      WHERE id = NEW.product_id;

      v_label := public.stock_option_display_label(
        'sack',
        NEW.selling_option_label,
        NEW.unit_label,
        NEW.package_size,
        NEW.package_unit
      );

      PERFORM public.create_notification(
        NEW.store_id,
        'sack_conversion',
        'info',
        'Sack opened into kilo stock',
        COALESCE(v_product_name, 'Product') || ': opened ' || abs(NEW.quantity_delta)::text ||
          ' ' || v_label || ' into kilo stock.',
        ARRAY['admin']::text[],
        'stock_adjustments',
        NEW.id,
        'stock_adjustment',
        NEW.id,
        NEW.product_id,
        NEW.selling_option_id,
        'conversion',
        NEW.stock_after,
        NULL,
        jsonb_build_object(
          'productName', COALESCE(v_product_name, 'Unknown product'),
          'sellingOptionLabel', v_label,
          'quantityDelta', NEW.quantity_delta,
          'stockBefore', NEW.stock_before,
          'stockAfter', NEW.stock_after,
          'note', NEW.note
        ),
        NULL
      );
    END IF;
    RETURN NEW;
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = NEW.product_id;

  v_label := COALESCE(NULLIF(NEW.selling_option_label, ''), NULLIF(NEW.unit_label, ''), 'stock');
  v_severity := CASE WHEN NEW.quantity_delta < 0 THEN 'warning' ELSE 'info' END;

  PERFORM public.create_notification(
    NEW.store_id,
    'stock_adjustment',
    v_severity,
    'Stock adjusted: ' || COALESCE(v_product_name, 'Unknown product'),
    COALESCE(v_product_name, 'Product') || ' (' || v_label || ') changed from ' ||
      NEW.stock_before::text || ' to ' || NEW.stock_after::text || '.',
    ARRAY['admin']::text[],
    'stock_adjustments',
    NEW.id,
    'stock_adjustment',
    NEW.id,
    NEW.product_id,
    NEW.selling_option_id,
    COALESCE(NEW.stock_source, CASE WHEN NEW.selling_option_id IS NULL THEN 'product' ELSE 'selling_option' END),
    NEW.stock_after,
    NULL,
    jsonb_build_object(
      'productName', COALESCE(v_product_name, 'Unknown product'),
      'sellingOptionLabel', v_label,
      'unitLabel', NEW.unit_label,
      'packageSize', NEW.package_size,
      'packageUnit', NEW.package_unit,
      'reason', NEW.reason,
      'quantityDelta', NEW.quantity_delta,
      'stockBefore', NEW.stock_before,
      'stockAfter', NEW.stock_after,
      'note', NEW.note
    ),
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_stock_adjustment_trigger ON public.stock_adjustments;
CREATE TRIGGER notify_stock_adjustment_trigger
  AFTER INSERT ON public.stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_stock_adjustment();

CREATE OR REPLACE FUNCTION public.trg_notify_sale_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_severity text;
  v_title text;
  v_message text;
  v_receipt text;
  v_actor_name text;
  v_amount text;
BEGIN
  IF NEW.event_type NOT IN ('completed', 'voided', 'refunded', 'returned') THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.actor_id;

  v_receipt := COALESCE(NEW.metadata->>'receiptNumber', NEW.sale_id::text);
  v_amount := 'PHP ' || to_char(COALESCE(NEW.amount, 0), 'FM999G999G999G990D00');

  IF NEW.event_type = 'completed' THEN
    v_type := 'sale_completed';
    v_severity := 'success';
    v_title := 'Sale completed';
    v_message := 'Receipt ' || v_receipt || ' completed for ' || v_amount || '.';
  ELSIF NEW.event_type = 'voided' THEN
    v_type := 'sale_voided';
    v_severity := 'warning';
    v_title := 'Sale voided';
    v_message := 'Receipt ' || v_receipt || ' was voided for ' || v_amount || '.';
  ELSIF NEW.event_type = 'refunded' THEN
    v_type := 'sale_refunded';
    v_severity := 'warning';
    v_title := 'Refund processed';
    v_message := 'Refund of ' || v_amount || ' was processed for receipt ' || v_receipt || '.';
  ELSE
    v_type := 'sale_returned';
    v_severity := 'warning';
    v_title := 'Return processed';
    v_message := 'Return/refund of ' || v_amount || ' was processed for receipt ' || v_receipt || '.';
  END IF;

  PERFORM public.create_notification(
    NEW.store_id,
    v_type,
    v_severity,
    v_title,
    v_message,
    ARRAY['admin']::text[],
    'sale_events',
    NEW.id,
    'sale',
    NEW.sale_id,
    NULL,
    NULL,
    NULL,
    NEW.amount,
    NULL,
    COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'saleId', NEW.sale_id,
      'eventType', NEW.event_type,
      'amount', NEW.amount,
      'reason', NEW.reason,
      'actorName', COALESCE(v_actor_name, 'Unknown user')
    ),
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_sale_event_trigger ON public.sale_events;
CREATE TRIGGER notify_sale_event_trigger
  AFTER INSERT ON public.sale_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_sale_event();

CREATE OR REPLACE FUNCTION public.trg_notify_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.create_notification(
    NEW.store_id,
    'system_error',
    'error',
    'Important system error',
    NEW.source || ': ' || left(NEW.message, 180),
    ARRAY['admin', 'super_admin']::text[],
    'error_logs',
    NEW.id,
    'error_log',
    NEW.id,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'source', NEW.source,
      'message', NEW.message,
      'actorId', NEW.actor_id,
      'context', NEW.context
    ),
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_error_log_trigger ON public.error_logs;
CREATE TRIGGER notify_error_log_trigger
  AFTER INSERT ON public.error_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_error_log();

CREATE OR REPLACE FUNCTION public.get_notifications(
  p_store_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  store_id uuid,
  type text,
  severity text,
  title text,
  message text,
  metadata jsonb,
  source_table text,
  source_id uuid,
  entity_type text,
  entity_id uuid,
  product_id uuid,
  product_name text,
  selling_option_id uuid,
  selling_option_label text,
  unit_label text,
  package_size numeric,
  package_unit text,
  current_stock numeric,
  threshold numeric,
  is_read boolean,
  read_at timestamptz,
  dismissed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    n.id,
    n.store_id,
    n.type,
    n.severity,
    n.title,
    n.message,
    n.metadata,
    n.source_table,
    n.source_id,
    n.entity_type,
    n.entity_id,
    n.product_id,
    p.name AS product_name,
    n.selling_option_id,
    COALESCE(n.metadata->>'sellingOptionLabel', pso.label) AS selling_option_label,
    COALESCE(n.metadata->>'unitLabel', pso.unit_label) AS unit_label,
    COALESCE((n.metadata->>'packageSize')::numeric, pso.quantity_value) AS package_size,
    COALESCE(n.metadata->>'packageUnit', pso.quantity_unit) AS package_unit,
    n.current_stock,
    n.threshold,
    ns.read_at IS NOT NULL AS is_read,
    ns.read_at,
    ns.dismissed_at,
    n.resolved_at,
    n.created_at
  FROM public.notifications n
  LEFT JOIN public.notification_user_states ns
    ON ns.notification_id = n.id
    AND ns.user_id = auth.uid()
  LEFT JOIN public.products p
    ON p.id = n.product_id
  LEFT JOIN public.product_selling_options pso
    ON pso.id = n.selling_option_id
  WHERE public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
    AND (p_store_id IS NULL OR n.store_id = p_store_id OR n.store_id IS NULL)
    AND ns.dismissed_at IS NULL
  ORDER BY n.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_store_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.notifications n
  LEFT JOIN public.notification_user_states ns
    ON ns.notification_id = n.id
    AND ns.user_id = auth.uid()
  WHERE public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
    AND (p_store_id IS NULL OR n.store_id = p_store_id OR n.store_id IS NULL)
    AND ns.dismissed_at IS NULL
    AND ns.read_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.id = p_notification_id
      AND public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
  ) THEN
    RAISE EXCEPTION 'Notification is not accessible';
  END IF;

  INSERT INTO public.notification_user_states(notification_id, user_id, read_at)
  VALUES (p_notification_id, auth.uid(), now())
  ON CONFLICT (notification_id, user_id) DO UPDATE
  SET
    read_at = COALESCE(public.notification_user_states.read_at, EXCLUDED.read_at),
    updated_at = now()
  WHERE public.notification_user_states.dismissed_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_store_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  WITH visible_notifications AS (
    SELECT n.id
    FROM public.notifications n
    LEFT JOIN public.notification_user_states ns
      ON ns.notification_id = n.id
      AND ns.user_id = auth.uid()
    WHERE public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
      AND (p_store_id IS NULL OR n.store_id = p_store_id OR n.store_id IS NULL)
      AND ns.dismissed_at IS NULL
      AND ns.read_at IS NULL
  ),
  upserted AS (
    INSERT INTO public.notification_user_states(notification_id, user_id, read_at)
    SELECT id, auth.uid(), now()
    FROM visible_notifications
    ON CONFLICT (notification_id, user_id) DO UPDATE
    SET
      read_at = COALESCE(public.notification_user_states.read_at, EXCLUDED.read_at),
      updated_at = now()
    WHERE public.notification_user_states.dismissed_at IS NULL
    RETURNING notification_id
  )
  SELECT COUNT(*)::integer INTO v_count
  FROM upserted;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_notification(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.id = p_notification_id
      AND public.notification_visible_to_user(n.store_id, n.target_roles, n.type)
  ) THEN
    RAISE EXCEPTION 'Notification is not accessible';
  END IF;

  INSERT INTO public.notification_user_states(notification_id, user_id, read_at, dismissed_at)
  VALUES (p_notification_id, auth.uid(), now(), now())
  ON CONFLICT (notification_id, user_id) DO UPDATE
  SET
    read_at = COALESCE(public.notification_user_states.read_at, EXCLUDED.read_at),
    dismissed_at = now(),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.record_report_export_notification(
  p_store_id uuid DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_file_name text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(COALESCE(NULLIF(p_status, ''), 'completed'));
  v_type text;
  v_severity text;
  v_title text;
  v_message text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_user_role()::text NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only reporting users can record report export notifications';
  END IF;

  IF p_store_id IS NOT NULL AND NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF v_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Report export status must be completed or failed';
  END IF;

  IF v_status = 'completed' THEN
    v_type := 'report_export_completed';
    v_severity := 'success';
    v_title := 'Report export completed';
    v_message := COALESCE(NULLIF(p_file_name, ''), 'Report export') || ' finished successfully.';
  ELSE
    v_type := 'report_export_failed';
    v_severity := 'error';
    v_title := 'Report export failed';
    v_message := COALESCE(NULLIF(p_file_name, ''), 'Report export') || ' failed' ||
      CASE WHEN p_error IS NULL OR p_error = '' THEN '.' ELSE ': ' || left(p_error, 160) END;
  END IF;

  RETURN public.create_notification(
    p_store_id,
    v_type,
    v_severity,
    v_title,
    v_message,
    ARRAY['admin', 'super_admin']::text[],
    'report_export',
    NULL,
    'report_export',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'fileName', p_file_name,
      'status', v_status,
      'error', p_error,
      'filters', COALESCE(p_filters, '{}'::jsonb)
    ),
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text, text[], text, uuid, text, uuid, uuid, uuid, text, numeric, numeric, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_stock_notification(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_selling_option_stock_notification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_product_stock_notification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_evaluate_selling_option_stock_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_evaluate_product_stock_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_notify_stock_adjustment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_notify_sale_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_notify_error_log() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_notifications(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_unread_notification_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_notification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_report_export_notification(uuid, text, text, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_notifications(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_report_export_notification(uuid, text, text, text, jsonb) TO authenticated;

SELECT public.evaluate_selling_option_stock_notification(id)
FROM public.product_selling_options
WHERE is_active;

SELECT public.evaluate_product_stock_notification(p.id)
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.product_selling_options pso
  WHERE pso.product_id = p.id
    AND pso.is_active
);
