
CREATE TABLE IF NOT EXISTS public.dostepnosc_blokady (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  typ VARCHAR(10) NOT NULL,
  zasob_id UUID NOT NULL,
  dzien DATE NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (typ, zasob_id, dzien)
);

ALTER TABLE public.dostepnosc_blokady ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_blokady_authenticated" ON public.dostepnosc_blokady
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_blokady_dyspozytor_admin" ON public.dostepnosc_blokady
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "delete_blokady_dyspozytor_admin" ON public.dostepnosc_blokady
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'dyspozytor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
