-- Store-local customer profiles and explicit historical associations.
-- Receipt text snapshots stay untouched; customer contact retention/redaction
-- remains gated by HANDOFF decision D07.

ALTER TABLE public.sales
  ADD CONSTRAINT sales_store_id_id_unique UNIQUE (store_id, id);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  phone text,
  email text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  archived_at timestamptz,
  archived_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  archive_reason text,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT customers_store_id_id_unique UNIQUE (store_id, id),
  CONSTRAINT customers_display_name_valid CHECK (
    display_name = pg_catalog.btrim(display_name)
    AND pg_catalog.char_length(display_name) BETWEEN 1 AND 100
    AND display_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT customers_phone_valid CHECK (
    phone IS NULL OR (
      phone = pg_catalog.btrim(phone)
      AND pg_catalog.char_length(phone) BETWEEN 1 AND 40
      AND phone !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT customers_email_valid CHECK (
    email IS NULL OR (
      email = pg_catalog.btrim(email)
      AND pg_catalog.char_length(email) BETWEEN 1 AND 254
      AND email !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT customers_archive_fields_consistent CHECK (
    (active AND archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
    OR (
      NOT active AND archived_at IS NOT NULL AND archived_by IS NOT NULL
      AND archive_reason IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(archive_reason)) BETWEEN 3 AND 500
    )
  ),
  CONSTRAINT customers_version_positive CHECK (version > 0)
);

ALTER TABLE public.sales
  ADD COLUMN customer_id uuid,
  ADD CONSTRAINT sales_customer_same_store_fk
    FOREIGN KEY (store_id, customer_id)
    REFERENCES public.customers (store_id, id)
    ON DELETE RESTRICT;

CREATE TABLE public.customer_sale_links (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  link_type text NOT NULL,
  linked_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  reason text,
  CONSTRAINT customer_sale_links_sale_store_fk
    FOREIGN KEY (store_id, sale_id)
    REFERENCES public.sales (store_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_sale_links_customer_store_fk
    FOREIGN KEY (store_id, customer_id)
    REFERENCES public.customers (store_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_sale_links_operation_store_fk
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_sale_links_type_valid CHECK (link_type IN ('checkout', 'retroactive')),
  CONSTRAINT customer_sale_links_reason_valid CHECK (
    (link_type = 'checkout' AND reason IS NULL)
    OR (
      link_type = 'retroactive' AND reason IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 3 AND 500
    )
  ),
  CONSTRAINT customer_sale_links_one_effective_customer UNIQUE (store_id, sale_id),
  CONSTRAINT customer_sale_links_operation_unique UNIQUE (store_id, operation_id)
);

CREATE INDEX customers_store_name_prefix_idx
  ON public.customers (store_id, lower(display_name) text_pattern_ops)
  WHERE active;
CREATE INDEX customers_store_phone_idx
  ON public.customers (store_id, phone)
  WHERE phone IS NOT NULL;
CREATE INDEX customers_store_created_idx
  ON public.customers (store_id, created_at DESC, id DESC);
CREATE INDEX customers_created_by_idx
  ON public.customers (created_by, created_at DESC);
CREATE INDEX customers_archived_by_idx
  ON public.customers (archived_by, archived_at DESC)
  WHERE archived_by IS NOT NULL;
CREATE INDEX sales_store_customer_created_idx
  ON public.sales (store_id, customer_id, created_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX customer_sale_links_store_customer_linked_idx
  ON public.customer_sale_links (store_id, customer_id, linked_at DESC, id DESC);
CREATE INDEX customer_sale_links_linked_by_idx
  ON public.customer_sale_links (linked_by, linked_at DESC);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_sale_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_api_access_denied
  ON public.customers
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
CREATE POLICY customer_sale_links_api_access_denied
  ON public.customer_sale_links
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.customers, public.customer_sale_links
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reject_customer_sale_link_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Customer sale association history is immutable'
    USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER customer_sale_links_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.customer_sale_links
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.reject_customer_sale_link_mutation();

CREATE OR REPLACE FUNCTION private.apply_customer_command(
  p_kind text,
  p_command jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_store_id uuid;
  v_customer_id uuid;
  v_sale_id uuid;
  v_operation public.pos_operations%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_payload jsonb;
  v_expected_version bigint;
  v_key_count integer;
  v_name text;
  v_phone text;
  v_email text;
  v_reason text;
  v_link_id uuid;
  v_linked_at timestamptz;
  v_result jsonb;
  v_aggregate_type text;
  v_aggregate_id text;
  v_aggregate_version bigint;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN (
    'create_customer', 'update_customer', 'archive_customer', 'associate_sale_customer'
  ) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer command kind is unsupported.');
  END IF;
  IF p_command IS NULL
    OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(p_command->'store_id') IS DISTINCT FROM 'string'
    OR p_command->>'store_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer command store ID is invalid.');
  END IF;
  v_store_id := (p_command->>'store_id')::uuid;

  -- This excludes super_admin by design. Admins have the capability implicitly;
  -- cashiers need an active store-scoped manage_customers grant.
  v_actor_id := private.assert_store_capability(v_store_id, 'manage_customers');
  v_operation := private.begin_pos_operation(p_kind, p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;

  v_payload := p_command->'payload';
  SELECT pg_catalog.count(*)::integer INTO v_key_count
  FROM pg_catalog.jsonb_object_keys(v_payload);

  IF p_kind = 'create_customer' THEN
    IF v_key_count <> 3 OR NOT (v_payload ?& ARRAY['display_name', 'phone', 'email'])
      OR p_command->'expected_version' IS DISTINCT FROM 'null'::jsonb
      OR pg_catalog.jsonb_typeof(v_payload->'display_name') IS DISTINCT FROM 'string'
      OR (pg_catalog.jsonb_typeof(v_payload->'phone') NOT IN ('string', 'null'))
      OR (pg_catalog.jsonb_typeof(v_payload->'email') NOT IN ('string', 'null')) THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer create payload is invalid.');
    END IF;
    v_name := pg_catalog.btrim(v_payload->>'display_name');
    v_phone := NULLIF(pg_catalog.btrim(v_payload->>'phone'), '');
    v_email := NULLIF(pg_catalog.btrim(v_payload->>'email'), '');
    IF v_name = '' OR pg_catalog.char_length(v_name) > 100 OR v_name ~ '[[:cntrl:]]'
      OR (v_phone IS NOT NULL AND (pg_catalog.char_length(v_phone) > 40 OR v_phone ~ '[[:cntrl:]]'))
      OR (v_email IS NOT NULL AND (pg_catalog.char_length(v_email) > 254 OR v_email ~ '[[:cntrl:]]')) THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer profile fields exceed the allowed format.');
    END IF;

    INSERT INTO public.customers (store_id, display_name, phone, email, created_by)
    VALUES (v_store_id, v_name, v_phone, v_email, v_actor_id)
    RETURNING * INTO v_customer;
    v_customer_id := v_customer.id;
    v_aggregate_type := 'customer';
    v_aggregate_id := v_customer.id::text;
    v_aggregate_version := v_customer.version;
    v_result := pg_catalog.jsonb_build_object(
      'customer_id', v_customer.id,
      'version', v_customer.version
    );
  ELSIF p_kind = 'update_customer' THEN
    IF v_key_count <> 4 OR NOT (v_payload ?& ARRAY['customer_id', 'display_name', 'phone', 'email'])
      OR pg_catalog.jsonb_typeof(v_payload->'customer_id') IS DISTINCT FROM 'string'
      OR v_payload->>'customer_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(v_payload->'display_name') IS DISTINCT FROM 'string'
      OR (pg_catalog.jsonb_typeof(v_payload->'phone') NOT IN ('string', 'null'))
      OR (pg_catalog.jsonb_typeof(v_payload->'email') NOT IN ('string', 'null'))
      OR p_command->'expected_version' = 'null'::jsonb THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer update payload is invalid.');
    END IF;
    v_customer_id := (v_payload->>'customer_id')::uuid;
    v_expected_version := (p_command->>'expected_version')::bigint;
    v_name := pg_catalog.btrim(v_payload->>'display_name');
    v_phone := NULLIF(pg_catalog.btrim(v_payload->>'phone'), '');
    v_email := NULLIF(pg_catalog.btrim(v_payload->>'email'), '');
    IF v_name = '' OR pg_catalog.char_length(v_name) > 100 OR v_name ~ '[[:cntrl:]]'
      OR (v_phone IS NOT NULL AND (pg_catalog.char_length(v_phone) > 40 OR v_phone ~ '[[:cntrl:]]'))
      OR (v_email IS NOT NULL AND (pg_catalog.char_length(v_email) > 254 OR v_email ~ '[[:cntrl:]]')) THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer profile fields exceed the allowed format.');
    END IF;
    UPDATE public.customers AS customer
    SET display_name = v_name,
        phone = v_phone,
        email = v_email,
        updated_at = pg_catalog.clock_timestamp(),
        version = customer.version + 1
    WHERE customer.store_id = v_store_id
      AND customer.id = v_customer_id
      AND customer.active
      AND customer.version = v_expected_version
    RETURNING * INTO v_customer;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('CUSTOMER_VERSION_CONFLICT', 'Customer is unavailable or has changed.');
    END IF;
    v_aggregate_type := 'customer';
    v_aggregate_id := v_customer.id::text;
    v_aggregate_version := v_customer.version;
    v_result := pg_catalog.jsonb_build_object(
      'customer_id', v_customer.id,
      'version', v_customer.version
    );
  ELSIF p_kind = 'archive_customer' THEN
    IF v_key_count <> 2 OR NOT (v_payload ?& ARRAY['customer_id', 'reason'])
      OR pg_catalog.jsonb_typeof(v_payload->'customer_id') IS DISTINCT FROM 'string'
      OR v_payload->>'customer_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
      OR p_command->'expected_version' = 'null'::jsonb THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer archive payload is invalid.');
    END IF;
    v_customer_id := (v_payload->>'customer_id')::uuid;
    v_expected_version := (p_command->>'expected_version')::bigint;
    v_reason := pg_catalog.btrim(v_payload->>'reason');
    IF pg_catalog.char_length(v_reason) NOT BETWEEN 3 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Archive reason must contain 3 to 500 printable characters.');
    END IF;
    UPDATE public.customers AS customer
    SET active = false,
        archived_at = pg_catalog.clock_timestamp(),
        archived_by = v_actor_id,
        archive_reason = v_reason,
        updated_at = pg_catalog.clock_timestamp(),
        version = customer.version + 1
    WHERE customer.store_id = v_store_id
      AND customer.id = v_customer_id
      AND customer.active
      AND customer.version = v_expected_version
    RETURNING * INTO v_customer;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('CUSTOMER_VERSION_CONFLICT', 'Customer is unavailable or has changed.');
    END IF;
    v_aggregate_type := 'customer';
    v_aggregate_id := v_customer.id::text;
    v_aggregate_version := v_customer.version;
    v_result := pg_catalog.jsonb_build_object(
      'customer_id', v_customer.id,
      'version', v_customer.version
    );
  ELSE
    IF v_key_count <> 3 OR NOT (v_payload ?& ARRAY['customer_id', 'sale_id', 'reason'])
      OR pg_catalog.jsonb_typeof(v_payload->'customer_id') IS DISTINCT FROM 'string'
      OR v_payload->>'customer_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(v_payload->'sale_id') IS DISTINCT FROM 'string'
      OR v_payload->>'sale_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
      OR p_command->'expected_version' = 'null'::jsonb THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Sale association payload is invalid.');
    END IF;
    v_customer_id := (v_payload->>'customer_id')::uuid;
    v_sale_id := (v_payload->>'sale_id')::uuid;
    v_expected_version := (p_command->>'expected_version')::bigint;
    v_reason := pg_catalog.btrim(v_payload->>'reason');
    IF pg_catalog.char_length(v_reason) NOT BETWEEN 3 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Association reason must contain 3 to 500 printable characters.');
    END IF;

    SELECT sale.* INTO v_sale
    FROM public.sales AS sale
    WHERE sale.store_id = v_store_id AND sale.id = v_sale_id
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('SALE_NOT_FOUND', 'Sale is unavailable in this store.');
    END IF;
    IF v_sale.status::text = 'voided' THEN
      PERFORM private.raise_pos_operation_error('SALE_NOT_ELIGIBLE', 'Voided sales cannot be linked to a customer.');
    END IF;
    IF v_sale.customer_id IS NOT NULL THEN
      PERFORM private.raise_pos_operation_error('SALE_CUSTOMER_ALREADY_LINKED', 'Sale already has a customer association.');
    END IF;

    SELECT customer.* INTO v_customer
    FROM public.customers AS customer
    WHERE customer.store_id = v_store_id
      AND customer.id = v_customer_id
      AND customer.active
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('CUSTOMER_NOT_FOUND', 'Active customer is unavailable in this store.');
    END IF;
    IF v_customer.version <> v_expected_version THEN
      PERFORM private.raise_pos_operation_error('CUSTOMER_VERSION_CONFLICT', 'Customer has changed; reload before linking.');
    END IF;

    UPDATE public.sales AS sale
    SET customer_id = v_customer_id
    WHERE sale.store_id = v_store_id
      AND sale.id = v_sale_id
      AND sale.customer_id IS NULL;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('SALE_CUSTOMER_ALREADY_LINKED', 'Sale already has a customer association.');
    END IF;

    INSERT INTO public.customer_sale_links (
      store_id, sale_id, customer_id, operation_id, link_type, linked_by, reason
    )
    VALUES (
      v_store_id, v_sale_id, v_customer_id, v_operation.id, 'retroactive', v_actor_id, v_reason
    )
    RETURNING id, linked_at INTO v_link_id, v_linked_at;

    v_aggregate_type := 'sale_customer_link';
    v_aggregate_id := v_link_id::text;
    v_aggregate_version := 1;
    v_result := pg_catalog.jsonb_build_object(
      'link_id', v_link_id,
      'sale_id', v_sale_id,
      'customer_id', v_customer_id,
      'link_type', 'retroactive',
      'linked_at', v_linked_at
    );
  END IF;

  RETURN private.finish_pos_operation(
    v_store_id,
    v_operation.id,
    p_kind,
    v_operation.request_hash,
    'confirmed',
    v_aggregate_type,
    v_aggregate_id,
    v_aggregate_version,
    v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer(p_command jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.apply_customer_command('create_customer', p_command);
$function$;

CREATE OR REPLACE FUNCTION public.update_customer(p_command jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.apply_customer_command('update_customer', p_command);
$function$;

CREATE OR REPLACE FUNCTION public.archive_customer(p_command jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.apply_customer_command('archive_customer', p_command);
$function$;

CREATE OR REPLACE FUNCTION public.associate_sale_customer(p_command jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.apply_customer_command('associate_sale_customer', p_command);
$function$;

CREATE OR REPLACE FUNCTION public.search_customers(
  p_store_id uuid,
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_query text := pg_catalog.btrim(p_query);
BEGIN
  IF v_actor_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
  END IF;
  IF p_store_id IS NULL OR NOT public.user_belongs_to_store(p_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'cashier') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'This account cannot search customers.', '42501');
  END IF;
  IF v_query IS NULL OR pg_catalog.char_length(v_query) NOT BETWEEN 2 AND 80
    OR pg_catalog.strpos(v_query, '%') > 0
    OR pg_catalog.strpos(v_query, '_') > 0
    OR pg_catalog.strpos(v_query, E'\\') > 0
    OR v_query ~ '[[:cntrl:]]'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer search query or limit is invalid.');
  END IF;

  RETURN QUERY
  SELECT customer.id, customer.display_name
  FROM public.customers AS customer
  WHERE customer.store_id = p_store_id
    AND customer.active
    AND customer.archived_at IS NULL
    AND (
      pg_catalog.lower(customer.display_name) LIKE pg_catalog.lower(v_query) || '%'
      OR customer.phone = v_query
    )
  ORDER BY pg_catalog.lower(customer.display_name), customer.id
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer(
  p_store_id uuid,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
BEGIN
  PERFORM private.assert_store_capability(p_store_id, 'manage_customers');
  SELECT customer.* INTO v_customer
  FROM public.customers AS customer
  WHERE customer.store_id = p_store_id AND customer.id = p_customer_id;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('CUSTOMER_NOT_FOUND', 'Customer is unavailable in this store.');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_customer.id,
    'store_id', v_customer.store_id,
    'display_name', v_customer.display_name,
    'phone', v_customer.phone,
    'email', v_customer.email,
    'active', v_customer.active,
    'version', v_customer.version,
    'created_at', v_customer.created_at,
    'updated_at', v_customer.updated_at,
    'archived_at', v_customer.archived_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.reject_customer_sale_link_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.apply_customer_command(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_customer(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_customer(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.archive_customer(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.associate_sale_customer(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_customers(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_customer(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_customer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_customer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_customer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.associate_sale_customer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_customers(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer(uuid, uuid) TO authenticated;

COMMENT ON TABLE public.customers IS
  'Minimal store-scoped customer identity. Contact retention/redaction is gated by privacy decision D07.';
COMMENT ON TABLE public.customer_sale_links IS
  'Immutable, idempotent customer-to-sale association events; receipt identity snapshots are never rewritten.';
COMMENT ON COLUMN public.sales.customer_id IS
  'Optional customer profile association; legacy receipt name/TIN/address snapshots remain unchanged.';
