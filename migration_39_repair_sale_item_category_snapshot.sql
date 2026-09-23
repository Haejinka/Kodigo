-- Migration 39: repair partially-applied reporting snapshot columns.
--
-- Some environments have the newer process_pos_sale_v3 function but are
-- missing sale_items.category_id. Keep this migration idempotent so it is
-- safe to apply to both complete and partially-migrated databases.

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS category_id uuid
    REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sale_items_category_id_idx
  ON public.sale_items(category_id);

COMMENT ON COLUMN public.sale_items.category_id IS
  'Immutable category id snapshot captured at the time of sale when available.';
