-- Keep the entered supplier price for each restocking package. Reconstructing
-- it from a rounded per-base-unit cost changes the amount on product edits.
ALTER TABLE public.product_restocking_options
  ADD COLUMN last_purchase_price numeric(14, 2)
    CHECK (last_purchase_price IS NULL OR last_purchase_price >= 0);
