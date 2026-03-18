
-- Use has_role function to avoid direct user_roles access in policies (preventing recursion issues)

CREATE POLICY "flota_insert_dysp" ON public.flota
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "flota_update_dysp" ON public.flota
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "flota_delete_dysp" ON public.flota
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "kierowcy_insert_dysp" ON public.kierowcy
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "kierowcy_update_dysp" ON public.kierowcy
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "kierowcy_delete_dysp" ON public.kierowcy
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
