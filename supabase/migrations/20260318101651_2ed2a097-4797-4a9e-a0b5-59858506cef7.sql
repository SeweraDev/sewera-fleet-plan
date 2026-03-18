
CREATE POLICY "oddzialy_select_authenticated" ON public.oddzialy FOR SELECT TO authenticated USING (true);
CREATE POLICY "flota_select_authenticated" ON public.flota FOR SELECT TO authenticated USING (true);
CREATE POLICY "flota_zewn_select_authenticated" ON public.flota_zewnetrzna FOR SELECT TO authenticated USING (true);
CREATE POLICY "kierowcy_select_authenticated" ON public.kierowcy FOR SELECT TO authenticated USING (true);
