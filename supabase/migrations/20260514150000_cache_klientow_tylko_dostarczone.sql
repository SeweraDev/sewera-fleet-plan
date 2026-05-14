-- ====================================================================
-- CACHE KLIENTOW: tylko adresy gdzie POJECHALISMY (status='dostarczona')
-- ====================================================================
-- Decyzja usera (14.05.2026): autocomplete w wycenie ma proponowac TYLKO
-- klientow, do ktorych Sewera faktycznie pojechala i dostarczyla.
--
-- Wczesniej widok agregowal WSZYSTKIE WZ-ki (rowniez anulowane, robocze,
-- w trasie). To zaczyszczalo cache "nibyklientami" do ktorych nigdy nie
-- pojechalismy — np. WZ pomylkowo dodane do zlecenia ktore potem anulowano.
--
-- Po zmianie: JOIN z `zlecenia` po `zlecenie_id` + filtr `status='dostarczona'`.
-- "liczba_dostaw" teraz odzwierciedla realna liczbe zrealizowanych kursow,
-- a nie liczbe wystawionych WZ.
-- ====================================================================

CREATE OR REPLACE VIEW public.publiczny_cache_klientow AS
SELECT
  TRIM(wz.odbiorca) AS odbiorca,
  TRIM(wz.adres) AS adres,
  COUNT(*)::integer AS liczba_dostaw,
  MAX(wz.created_at) AS ostatnia_dostawa
FROM public.zlecenia_wz wz
JOIN public.zlecenia z ON z.id = wz.zlecenie_id
WHERE
  wz.odbiorca IS NOT NULL
  AND TRIM(wz.odbiorca) <> ''
  AND wz.adres IS NOT NULL
  AND TRIM(wz.adres) <> ''
  AND z.status = 'dostarczona'
GROUP BY TRIM(wz.odbiorca), TRIM(wz.adres);

COMMENT ON VIEW public.publiczny_cache_klientow IS
  'Cache klientow Sewery: TYLKO zrealizowane dostawy (zlecenia.status=dostarczona). Bez pol wrazliwych. Uzywane przez autocomplete w wycenie.';

-- View jest jak poprzednio dostepny dla anon i authenticated
GRANT SELECT ON public.publiczny_cache_klientow TO anon, authenticated;

-- ====================================================================
-- KROKI DO WYKONANIA RECZNIE W SUPABASE DASHBOARD
-- ====================================================================
--
-- Lovable nie synchronizuje migracji DB. Wklej caly ten plik do:
--   Supabase Dashboard → SQL Editor → New query → Wklej → Run
--
-- Test po wykonaniu:
--   SELECT COUNT(*) FROM publiczny_cache_klientow;
--   -- powinno byc mniej niz przed (tylko dostarczone)
--
-- ====================================================================
