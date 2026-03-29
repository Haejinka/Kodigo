-- Migration 13: Fix Store Creation Logic

CREATE OR REPLACE FUNCTION public.create_store_with_owner(
    p_name text,
    p_address text,
    p_tax_rate numeric
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_store public.stores;
    v_role text;
BEGIN
    -- Look up the exact role of the acting user
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    
    -- Restrict explicitly to admins (super_admins only manage invites, cashiers run registers)
    IF v_role IS NULL OR v_role NOT IN ('admin') THEN
        RAISE EXCEPTION 'Only admins can create stores (Detected profile role: %)', coalesce(v_role, 'none');
    END IF;

    -- Insert the new store
    INSERT INTO public.stores (name, address, tax_rate)
    VALUES (p_name, p_address, p_tax_rate)
    RETURNING * INTO new_store;

    -- Map the current admin to the new store automatically
    INSERT INTO public.store_users (store_id, profile_id)
    VALUES (new_store.id, auth.uid());

    RETURN new_store;
END;
$$;