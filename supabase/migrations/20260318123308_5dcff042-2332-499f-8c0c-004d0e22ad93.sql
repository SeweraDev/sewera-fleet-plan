
-- Add missing columns to flota_zewnetrzna
ALTER TABLE public.flota_zewnetrzna
  ADD COLUMN IF NOT EXISTS max_palet INTEGER,
  ADD COLUMN IF NOT EXISTS objetosc_m3 NUMERIC(6,2);

-- RLS policies for dyspozytor/admin CRUD
CREATE POLICY "flota_zewn_insert_dysp" ON public.flota_zewnetrzna
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "flota_zewn_update_dysp" ON public.flota_zewnetrzna
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "flota_zewn_delete_dysp" ON public.flota_zewnetrzna
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );
