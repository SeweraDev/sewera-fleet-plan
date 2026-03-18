
-- Oddziały (branches)
CREATE TABLE public.oddzialy (
  id SERIAL PRIMARY KEY,
  nazwa TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.oddzialy ENABLE ROW LEVEL SECURITY;

-- Flota własna
CREATE TABLE public.flota (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nr_rej TEXT NOT NULL UNIQUE,
  typ TEXT NOT NULL DEFAULT 'ciezarowy',
  ladownosc_kg NUMERIC NOT NULL DEFAULT 0,
  objetosc_m3 NUMERIC NOT NULL DEFAULT 0,
  oddzial_id INT REFERENCES public.oddzialy(id),
  aktywny BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.flota ENABLE ROW LEVEL SECURITY;

-- Flota zewnętrzna
CREATE TABLE public.flota_zewnetrzna (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma TEXT NOT NULL,
  nr_rej TEXT NOT NULL UNIQUE,
  typ TEXT NOT NULL DEFAULT 'ciezarowy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.flota_zewnetrzna ENABLE ROW LEVEL SECURITY;

-- Zlecenia
CREATE TABLE public.zlecenia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numer TEXT NOT NULL UNIQUE,
  oddzial_id INT REFERENCES public.oddzialy(id),
  status TEXT NOT NULL DEFAULT 'robocza',
  typ_pojazdu TEXT,
  dzien DATE NOT NULL DEFAULT CURRENT_DATE,
  preferowana_godzina TEXT,
  kurs_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.zlecenia ENABLE ROW LEVEL SECURITY;

-- Zlecenia WZ (dokumenty WZ per zlecenie)
CREATE TABLE public.zlecenia_wz (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zlecenie_id UUID REFERENCES public.zlecenia(id) ON DELETE CASCADE NOT NULL,
  numer_wz TEXT,
  masa_kg NUMERIC NOT NULL DEFAULT 0,
  objetosc_m3 NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.zlecenia_wz ENABLE ROW LEVEL SECURITY;

-- Kursy
CREATE TABLE public.kursy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dzien DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'zaplanowany',
  nr_rej_zewn TEXT,
  kierowca_id UUID,
  kierowca_nazwa TEXT,
  oddzial_id INT REFERENCES public.oddzialy(id),
  godzina_start TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.kursy ENABLE ROW LEVEL SECURITY;

-- Kurs przystanki
CREATE TABLE public.kurs_przystanki (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kurs_id UUID REFERENCES public.kursy(id) ON DELETE CASCADE NOT NULL,
  zlecenie_id UUID REFERENCES public.zlecenia(id),
  kolejnosc INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'oczekuje',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.kurs_przystanki ENABLE ROW LEVEL SECURITY;

-- RLS: zarzad + admin can read all transport tables
CREATE POLICY "zarzad_select_oddzialy" ON public.oddzialy FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'zarzad') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "zarzad_select_flota" ON public.flota FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'zarzad') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "zarzad_select_flota_zewnetrzna" ON public.flota_zewnetrzna FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'zarzad') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "zarzad_select_zlecenia" ON public.zlecenia FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'zarzad') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "zarzad_select_zlecenia_wz" ON public.zlecenia_wz FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'zarzad') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "zarzad_select_kursy" ON public.kursy FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'zarzad') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "zarzad_select_kurs_przystanki" ON public.kurs_przystanki FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'zarzad') OR public.has_role(auth.uid(), 'admin'));

-- Also allow dyspozytor and sprzedawca to read relevant tables
CREATE POLICY "dyspozytor_select_kursy" ON public.kursy FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_select_zlecenia" ON public.zlecenia FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_select_oddzialy" ON public.oddzialy FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_select_flota" ON public.flota FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_select_flota_zewn" ON public.flota_zewnetrzna FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_select_kurs_przystanki" ON public.kurs_przystanki FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dyspozytor'));
CREATE POLICY "dyspozytor_select_zlecenia_wz" ON public.zlecenia_wz FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dyspozytor'));

CREATE POLICY "sprzedawca_select_oddzialy" ON public.oddzialy FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'sprzedawca'));
CREATE POLICY "sprzedawca_select_zlecenia" ON public.zlecenia FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'sprzedawca'));

-- Enable realtime for kursy
ALTER PUBLICATION supabase_realtime ADD TABLE public.kursy;
