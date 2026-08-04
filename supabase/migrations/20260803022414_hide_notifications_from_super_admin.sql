-- Super admins manage invite codes only. Store operations, report exports, and
-- system-error notifications must remain visible to store admins instead.

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
    (SELECT auth.uid()) IS NOT NULL
    AND COALESCE(public.current_user_role()::text, '') <> 'super_admin'
    AND COALESCE(public.current_user_role()::text, '') = ANY(COALESCE(p_target_roles, ARRAY[]::text[]))
    AND (p_store_id IS NULL OR public.user_belongs_to_store(p_store_id))
    AND CASE
      WHEN p_type = 'low_stock' THEN COALESCE((
        SELECT np.low_stock
        FROM public.notification_preferences np
        WHERE np.user_id = (SELECT auth.uid())
      ), true)
      WHEN p_type = 'out_of_stock' THEN COALESCE((
        SELECT np.out_of_stock
        FROM public.notification_preferences np
        WHERE np.user_id = (SELECT auth.uid())
      ), true)
      ELSE true
    END;
$$;

-- Remove super_admin from already-created notification audiences. Existing
-- store admins keep their notification history.
UPDATE public.notifications
SET target_roles = array_remove(target_roles, 'super_admin')
WHERE 'super_admin' = ANY(target_roles);

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
    ARRAY['admin']::text[],
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

-- Future report-export notifications are store-admin-only.
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
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can record report export notifications';
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
    ARRAY['admin']::text[],
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
