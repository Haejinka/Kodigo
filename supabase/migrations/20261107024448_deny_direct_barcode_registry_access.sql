-- Explicit deny policy documents the internal registry's access boundary.
-- No client role has table privileges; only the revoked private trigger writes it.
CREATE POLICY barcode_registry_internal_only
ON private.product_barcode_registry
FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);
