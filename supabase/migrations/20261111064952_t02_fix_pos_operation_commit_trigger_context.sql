-- Deferred commit validation must read the operation row after the API role's
-- direct table privileges have been revoked. Keep access inside the trigger,
-- use an empty search_path, and leave operation-table grants/RLS unchanged.
CREATE OR REPLACE FUNCTION private.assert_pos_operation_committed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT operation.status
  INTO v_status
  FROM public.pos_operations AS operation
  WHERE operation.id = NEW.id;

  IF v_status IS DISTINCT FROM 'committed' THEN
    RAISE EXCEPTION 'A POS operation cannot commit before its response is persisted'
      USING ERRCODE = '23514',
        CONSTRAINT = 'pos_operations_must_commit_with_response';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.assert_pos_operation_committed()
  FROM PUBLIC, anon, authenticated, service_role;
