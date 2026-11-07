-- One scan code resolves to one product/base unit or selling option per store.
ALTER TABLE public.product_selling_options ADD COLUMN barcode text;

-- A shared unique key prevents races between writes to the two catalog tables.
-- This registry is internal; clients continue using the existing RLS-protected tables.
CREATE TABLE private.product_barcode_registry (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  barcode text NOT NULL CHECK (barcode <> '' AND barcode = btrim(barcode)),
  source_table text NOT NULL CHECK (source_table IN ('products', 'product_selling_options')),
  source_id uuid NOT NULL,
  PRIMARY KEY (store_id, barcode),
  UNIQUE (source_table, source_id)
);
ALTER TABLE private.product_barcode_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.product_barcode_registry FROM PUBLIC, anon, authenticated;

INSERT INTO private.product_barcode_registry (store_id, barcode, source_table, source_id)
SELECT store_id, btrim(barcode), 'products', id
FROM public.products WHERE nullif(btrim(barcode), '') IS NOT NULL;

CREATE FUNCTION private.sync_product_barcode_registry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  scan_code text;
BEGIN
  -- Access to catalog rows remains governed by their existing RLS policies.
  -- The definer only maintains a private unique-key registry after an authorized write.
  IF TG_OP <> 'DELETE' AND auth.uid() IS NOT NULL
    AND NOT public.user_belongs_to_store(NEW.store_id) THEN
    RAISE EXCEPTION 'Barcode assignment is not allowed in this store' USING ERRCODE = '42501';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    DELETE FROM private.product_barcode_registry
    WHERE source_table = TG_TABLE_NAME AND source_id = OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF TG_TABLE_NAME = 'product_selling_options' THEN
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id) THEN
      RAISE EXCEPTION 'Selling option must belong to its product store' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.is_active THEN RETURN NEW; END IF;
  END IF;

  scan_code := nullif(btrim(NEW.barcode), '');
  IF scan_code IS NOT NULL THEN
    INSERT INTO private.product_barcode_registry(store_id, barcode, source_table, source_id)
    VALUES (NEW.store_id, scan_code, TG_TABLE_NAME, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_product_barcode_registry() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_product_barcode_registry
AFTER INSERT OR UPDATE OF barcode, store_id OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.sync_product_barcode_registry();
CREATE TRIGGER sync_selling_option_barcode_registry
AFTER INSERT OR UPDATE OF barcode, store_id, product_id, is_active OR DELETE ON public.product_selling_options
FOR EACH ROW EXECUTE FUNCTION private.sync_product_barcode_registry();

CREATE INDEX product_selling_options_barcode_idx
ON public.product_selling_options (store_id, barcode)
WHERE barcode IS NOT NULL AND is_active;

-- The shared registry replaces the legacy global constraint with store-scoped uniqueness.
ALTER TABLE public.products DROP CONSTRAINT products_barcode_key;
