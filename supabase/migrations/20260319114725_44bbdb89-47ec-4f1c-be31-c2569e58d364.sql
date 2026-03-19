
-- Replace overly permissive insert policy with role-based ones
DROP POLICY IF EXISTS "service_insert_powiadomienia" ON powiadomienia;

CREATE POLICY "dyspozytor_insert_powiadomienia" ON powiadomienia
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
