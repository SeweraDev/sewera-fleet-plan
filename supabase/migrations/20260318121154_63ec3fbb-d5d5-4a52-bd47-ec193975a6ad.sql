CREATE POLICY "zlecenia_wz_update_dysp" ON public.zlecenia_wz
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));