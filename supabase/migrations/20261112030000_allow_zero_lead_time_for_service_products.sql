-- Non-stock service products are created with a 0-day lead time; the old check (> 0) rejected every one.
ALTER TABLE public.products DROP CONSTRAINT products_lead_time_days_check;
ALTER TABLE public.products ADD CONSTRAINT products_lead_time_days_check CHECK (lead_time_days >= 0);
