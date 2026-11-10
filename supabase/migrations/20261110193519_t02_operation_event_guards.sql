-- Keep the composite event-to-operation foreign key indexable and make the
-- API's deny-by-default table access explicit for security review tooling.

CREATE INDEX pos_operation_events_operation_store_created_idx
  ON public.pos_operation_events (store_id, operation_id, created_at DESC, id DESC);

CREATE POLICY pos_operations_api_deny
  ON public.pos_operations
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY pos_operation_events_api_deny
  ON public.pos_operation_events
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
