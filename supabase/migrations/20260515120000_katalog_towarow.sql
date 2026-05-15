-- Migration: katalog_towarow
-- Baza towarow z Ekonom (XLSX/CSV) - kod -> m3, dzial, producent, waga, EAN, flaga HDS
-- Uzywana przy imporcie WZ do wzbogacenia pozycji o m3 i flagi materialow ciezkich.
-- Aktualizacja: raz/miesiac przez panel admina (upload pliku, nadpisuje całość).

CREATE TABLE IF NOT EXISTS katalog_towarow (
  kod text PRIMARY KEY,
  kod_producenta text,
  ean text,
  nazwa text NOT NULL,
  nazwa_dodatkowa text,
  jm text,
  m3_per_szt numeric,
  -- Flaga: m3 wyglada podejrzanie (m3>5 dla SZT, m3==waga, m3>0.5 dla produktow ml/L).
  -- Parser WZ ignoruje takie wartosci i wraca do regexu z opisu pozycji.
  m3_podejrzany boolean NOT NULL DEFAULT false,
  dzial text,
  producent text,
  kg_per_szt numeric,
  -- Liczba sztuk na palecie (np. dachowka 240 szt/paleta, bloczek 60, papa 22).
  -- Parser WZ uzywa do wyliczenia palet i m3 gdy m3_per_szt nieznane:
  --   palety = ceil(ilosc_z_WZ / szt_na_palecie), m3 = palety * m3_per_paleta
  szt_na_palecie integer,
  -- Objetosc palety (domyslnie 1.1 m3 — standard paletowy). Mozna nadpisac dla
  -- towarow o niestandardowych paletach (np. mala kostka 1.4, plyta tarasowa 0.9).
  m3_per_paleta numeric DEFAULT 1.1,
  -- Flaga: towar wymagaja HDS przy dostawie (cegly, bloczki, dachowki, kostka, MFP).
  -- Kolumna HDS z CSV: 'tak' -> true, inaczej false.
  wymaga_hds boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indeksy na klucze lookupu (parser probuje po kolei: kod -> kod_producenta -> ean)
CREATE INDEX IF NOT EXISTS idx_katalog_kod_producenta ON katalog_towarow(kod_producenta) WHERE kod_producenta IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_katalog_ean ON katalog_towarow(ean) WHERE ean IS NOT NULL;
-- Indeks na wymaga_hds dla szybkich filtrow statystyk
CREATE INDEX IF NOT EXISTS idx_katalog_wymaga_hds ON katalog_towarow(wymaga_hds) WHERE wymaga_hds = true;

ALTER TABLE katalog_towarow ENABLE ROW LEVEL SECURITY;

-- Wszyscy zalogowani moga czytac (parser WZ uzywa to przy imporcie)
DROP POLICY IF EXISTS "anyone_read_katalog" ON katalog_towarow;
CREATE POLICY "anyone_read_katalog" ON katalog_towarow
  FOR SELECT TO authenticated USING (true);

-- Modyfikacja: tylko admin (uploady, korekty podejrzanych m3)
DROP POLICY IF EXISTS "admin_write_katalog" ON katalog_towarow;
CREATE POLICY "admin_write_katalog" ON katalog_towarow
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

COMMENT ON TABLE katalog_towarow IS 'Baza towarow z systemu Ekonom (Sewera). Aktualizacja raz/miesiac przez /admin/katalog-towarow.';
COMMENT ON COLUMN katalog_towarow.m3_podejrzany IS 'true gdy m3 wyglada na bug w bazie (m3>5 dla SZT, m3==waga). Parser WZ ignoruje.';
COMMENT ON COLUMN katalog_towarow.wymaga_hds IS 'true gdy towar wymaga HDS przy dostawie (cegly, bloczki, dachowki, kostka).';
