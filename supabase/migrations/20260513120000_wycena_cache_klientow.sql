-- ====================================================================
-- WYCENA: cache klientow z historii zlecen + cache geocodingu + log wyszukiwan
-- ====================================================================
-- Dotyczy publicznej strony /wycena oraz wewnetrznej wyceny w aplikacji.
--
-- 1) publiczny_cache_klientow — widok agregujacy historyczne adresy dostaw
--    Sewery (z `zlecenia_wz`). Wpisujesz "Hadex" → lista adresow gdzie juz
--    wozimy + liczba dostaw + data ostatniej.
--
-- 2) geocode_cache — tabela cache wspolrzednych (lat/lng) dla adresow.
--    Lazy: gdy user kliknie z dropdown → geocode raz, potem szybko z cache.
--
-- 3) wyszukiwania_log — log do statystyk dla admina (codzienny raport mailowy).
-- ====================================================================

-- ====================================================================
-- 1. WIDOK publiczny_cache_klientow
-- ====================================================================
-- Agreguje historyczne adresy dostaw z zlecenia_wz. Pokazuje:
--   - odbiorca: nazwa firmy/osoby (np. "Hadex Sp. z o.o.")
--   - adres: pelny adres dostawy
--   - liczba_dostaw: ile razy wozono tam (sila glosu w sortowaniu)
--   - ostatnia_dostawa: kiedy ostatnio (do oznaczenia stalych klientow)
--
-- Bez pol wrazliwych (telefon, NIP, nr_rej). Bezpieczny dla anon na /wycena.

CREATE OR REPLACE VIEW public.publiczny_cache_klientow AS
SELECT
  TRIM(odbiorca) AS odbiorca,
  TRIM(adres) AS adres,
  COUNT(*)::integer AS liczba_dostaw,
  MAX(created_at) AS ostatnia_dostawa
FROM public.zlecenia_wz
WHERE
  odbiorca IS NOT NULL
  AND TRIM(odbiorca) <> ''
  AND adres IS NOT NULL
  AND TRIM(adres) <> ''
GROUP BY TRIM(odbiorca), TRIM(adres);

COMMENT ON VIEW public.publiczny_cache_klientow IS
  'Cache klientow Sewery: historyczne adresy dostaw zagregowane z zlecenia_wz. Uzywane przez autocomplete na /wycena. Bez pol wrazliwych.';

GRANT SELECT ON public.publiczny_cache_klientow TO anon, authenticated;

-- ====================================================================
-- 2. TABELA geocode_cache
-- ====================================================================
-- Trzyma wspolrzedne lat/lng dla adresow. Klucz: znormalizowany adres
-- (lowercase + trim). Po pierwszym geocode → tu siedzi, kazdy nastepny
-- request omija Photon.

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  adres_norm TEXT PRIMARY KEY,
  adres_oryginalny TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  has_house_number BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uses_count INTEGER NOT NULL DEFAULT 1
);

COMMENT ON TABLE public.geocode_cache IS
  'Cache wspolrzednych geocodingu. Klucz: adres_norm (lowercase + trim). Lazy populated z UI.';

CREATE INDEX IF NOT EXISTS idx_geocode_cache_last_used ON public.geocode_cache(last_used_at DESC);

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

-- Anon i authenticated moga czytac (publiczna /wycena)
DROP POLICY IF EXISTS "anyone_can_read_geocode_cache" ON public.geocode_cache;
CREATE POLICY "anyone_can_read_geocode_cache"
  ON public.geocode_cache FOR SELECT
  USING (true);

-- Anon i authenticated moga wpisywac (zeby /wycena bez logowania mogla dodawac cache)
DROP POLICY IF EXISTS "anyone_can_insert_geocode_cache" ON public.geocode_cache;
CREATE POLICY "anyone_can_insert_geocode_cache"
  ON public.geocode_cache FOR INSERT
  WITH CHECK (true);

-- Anon i authenticated moga aktualizowac (last_used_at, uses_count)
DROP POLICY IF EXISTS "anyone_can_update_geocode_cache" ON public.geocode_cache;
CREATE POLICY "anyone_can_update_geocode_cache"
  ON public.geocode_cache FOR UPDATE
  USING (true);

GRANT SELECT, INSERT, UPDATE ON public.geocode_cache TO anon, authenticated;

-- ====================================================================
-- 3. TABELA wyszukiwania_log
-- ====================================================================
-- Log kazdego wyszukiwania w kalkulatorze wyceny (publiczna + wewnetrzna).
-- Bez danych osobowych (brak IP, brak user_agent). Tylko: co wpisano, co znaleziono,
-- z ktorego oddzialu, kiedy.
--
-- Wglad ma TYLKO admin (Grzegorz). Pozostali uzytkownicy moga tylko INSERT.

CREATE TABLE IF NOT EXISTS public.wyszukiwania_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  query TEXT NOT NULL,
  oddzial_kod TEXT,
  typ_pojazdu TEXT,
  znaleziono_adres TEXT,
  has_house_number BOOLEAN,
  name_match BOOLEAN,
  uzyto_cache_klientow BOOLEAN DEFAULT false,
  zrodlo TEXT NOT NULL DEFAULT 'publiczna_wycena',
  zalogowany BOOLEAN NOT NULL DEFAULT false,
  wynik_km INTEGER,
  wynik_koszt_netto NUMERIC(10,2)
);

COMMENT ON TABLE public.wyszukiwania_log IS
  'Log wyszukiwan w kalkulatorze wyceny — dla statystyk admina. Bez PII (IP, user_agent). Source: publiczna_wycena lub wewnetrzna.';
COMMENT ON COLUMN public.wyszukiwania_log.zrodlo IS
  'publiczna_wycena = ze strony /wycena bez logowania. wewnetrzna = z aplikacji glownej (zalogowany user).';
COMMENT ON COLUMN public.wyszukiwania_log.name_match IS
  'true = nazwa znalezionego obiektu pasowala do query. false = Photon trafil w cos innego (np. Urzad Gminy zamiast Romibud).';
COMMENT ON COLUMN public.wyszukiwania_log.uzyto_cache_klientow IS
  'true = user kliknal z autocomplete na historycznym adresie Sewery. false = wpisal recznie lub wybral z Photon.';

CREATE INDEX IF NOT EXISTS idx_wyszukiwania_log_created_at ON public.wyszukiwania_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wyszukiwania_log_oddzial ON public.wyszukiwania_log(oddzial_kod);
CREATE INDEX IF NOT EXISTS idx_wyszukiwania_log_zrodlo ON public.wyszukiwania_log(zrodlo);

ALTER TABLE public.wyszukiwania_log ENABLE ROW LEVEL SECURITY;

-- Anon i authenticated moga INSERT (zeby kalkulator zawsze mogl logowac, bez logowania)
DROP POLICY IF EXISTS "anyone_can_insert_log" ON public.wyszukiwania_log;
CREATE POLICY "anyone_can_insert_log"
  ON public.wyszukiwania_log FOR INSERT
  WITH CHECK (true);

-- SELECT tylko dla adminow (Grzegorz)
DROP POLICY IF EXISTS "admin_can_read_log" ON public.wyszukiwania_log;
CREATE POLICY "admin_can_read_log"
  ON public.wyszukiwania_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT INSERT ON public.wyszukiwania_log TO anon, authenticated;
GRANT SELECT ON public.wyszukiwania_log TO authenticated;
GRANT USAGE ON SEQUENCE public.wyszukiwania_log_id_seq TO anon, authenticated;

-- ====================================================================
-- KROKI DO WYKONANIA RECZNIE W SUPABASE DASHBOARD
-- ====================================================================
--
-- Lovable nie synchronizuje migracji DB. Wklej caly ten plik do:
--   Supabase Dashboard → SQL Editor → New query → Wklej → Run
--
-- Po wykonaniu sprawdz w Table Editor czy widzisz:
--   - View: publiczny_cache_klientow (Views section)
--   - Table: geocode_cache
--   - Table: wyszukiwania_log
--
-- ====================================================================
