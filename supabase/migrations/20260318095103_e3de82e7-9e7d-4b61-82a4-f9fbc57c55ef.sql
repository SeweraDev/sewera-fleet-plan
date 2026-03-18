
-- 1. Tabela kierowcy
CREATE TABLE public.kierowcy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imie_nazwisko text NOT NULL,
  uprawnienia text DEFAULT '',
  tel text DEFAULT '',
  oddzial_id integer REFERENCES public.oddzialy(id),
  aktywny boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kierowcy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dyspozytor_select_kierowcy" ON public.kierowcy FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "zarzad_select_kierowcy" ON public.kierowcy FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'zarzad') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "kierowca_select_own" ON public.kierowcy FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 2. Dodaj brakujące kolumny do kursy
ALTER TABLE public.kursy
  ADD COLUMN IF NOT EXISTS flota_id uuid REFERENCES public.flota(id),
  ADD COLUMN IF NOT EXISTS ts_wyjazd timestamptz,
  ADD COLUMN IF NOT EXISTS ts_powrot timestamptz,
  ADD COLUMN IF NOT EXISTS numer text;

-- RLS: dyspozytor INSERT/UPDATE kursy
CREATE POLICY "dyspozytor_insert_kursy" ON public.kursy FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_update_kursy" ON public.kursy FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'));
-- kierowca UPDATE own kursy
CREATE POLICY "kierowca_update_own_kursy" ON public.kursy FOR UPDATE TO authenticated
  USING (kierowca_id IN (SELECT id FROM public.kierowcy WHERE user_id = auth.uid()));
-- kierowca SELECT own kursy
CREATE POLICY "kierowca_select_own_kursy" ON public.kursy FOR SELECT TO authenticated
  USING (kierowca_id IN (SELECT id FROM public.kierowcy WHERE user_id = auth.uid()));

-- 3. Dodaj brakujące kolumny do zlecenia
ALTER TABLE public.zlecenia
  ADD COLUMN IF NOT EXISTS nadawca_id uuid REFERENCES auth.users(id);

-- RLS: sprzedawca INSERT zlecenia
CREATE POLICY "sprzedawca_insert_zlecenia" ON public.zlecenia FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'sprzedawca'));
-- dyspozytor UPDATE zlecenia
CREATE POLICY "dyspozytor_update_zlecenia" ON public.zlecenia FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'));
-- kierowca UPDATE zlecenia (for status changes)
CREATE POLICY "kierowca_update_zlecenia" ON public.zlecenia FOR UPDATE TO authenticated
  USING (kurs_id IN (SELECT k.id FROM public.kursy k JOIN public.kierowcy ki ON ki.id = k.kierowca_id WHERE ki.user_id = auth.uid()));

-- 4. Dodaj brakujące kolumny do zlecenia_wz
ALTER TABLE public.zlecenia_wz
  ADD COLUMN IF NOT EXISTS odbiorca text DEFAULT '',
  ADD COLUMN IF NOT EXISTS adres text DEFAULT '',
  ADD COLUMN IF NOT EXISTS tel text,
  ADD COLUMN IF NOT EXISTS uwagi text,
  ADD COLUMN IF NOT EXISTS nr_zamowienia text;

-- RLS: sprzedawca INSERT zlecenia_wz
CREATE POLICY "sprzedawca_insert_zlecenia_wz" ON public.zlecenia_wz FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'sprzedawca'));
-- sprzedawca SELECT own zlecenia_wz
CREATE POLICY "sprzedawca_select_zlecenia_wz" ON public.zlecenia_wz FOR SELECT TO authenticated
  USING (zlecenie_id IN (SELECT id FROM public.zlecenia WHERE nadawca_id = auth.uid()));

-- 5. RLS: dyspozytor INSERT/UPDATE kurs_przystanki
CREATE POLICY "dyspozytor_insert_kurs_przystanki" ON public.kurs_przystanki FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_update_kurs_przystanki" ON public.kurs_przystanki FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'));
-- kierowca UPDATE own kurs_przystanki
CREATE POLICY "kierowca_update_kurs_przystanki" ON public.kurs_przystanki FOR UPDATE TO authenticated
  USING (kurs_id IN (SELECT k.id FROM public.kursy k JOIN public.kierowcy ki ON ki.id = k.kierowca_id WHERE ki.user_id = auth.uid()));
-- kierowca SELECT own kurs_przystanki
CREATE POLICY "kierowca_select_kurs_przystanki" ON public.kurs_przystanki FOR SELECT TO authenticated
  USING (kurs_id IN (SELECT k.id FROM public.kursy k JOIN public.kierowcy ki ON ki.id = k.kierowca_id WHERE ki.user_id = auth.uid()));

-- 6. Realtime for kurs_przystanki
ALTER PUBLICATION supabase_realtime ADD TABLE public.kurs_przystanki;

-- 7. Add aktywny column to oddzialy for filtering
ALTER TABLE public.oddzialy ADD COLUMN IF NOT EXISTS aktywny boolean NOT NULL DEFAULT true;
