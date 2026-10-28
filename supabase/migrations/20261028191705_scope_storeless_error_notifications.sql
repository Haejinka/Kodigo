-- Storeless client errors remain in error_logs for diagnostics but must not be
-- broadcast as notifications to every admin in every tenant.
CREATE OR REPLACE FUNCTION public.notification_visible_to_user(
  p_store_id uuid,
  p_target_roles text[],
  p_type text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND COALESCE(public.current_user_role()::text, '') <> 'super_admin'
    AND COALESCE(public.current_user_role()::text, '') = ANY(COALESCE(p_target_roles, ARRAY[]::text[]))
    AND (p_type IS DISTINCT FROM 'system_error' OR p_store_id IS NOT NULL)
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
$function$;

-- Keep global client errors in the diagnostic table, but create user-facing
-- error notifications only when the report identifies an authorized store.
CREATE OR REPLACE FUNCTION public.trg_notify_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.store_id IS NULL THEN
    RETURN NEW;
  END IF;

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
$function$;
