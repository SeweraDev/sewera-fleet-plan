-- Migracja: pola do walidacji w dyspozytorze (po stronie B z planu A+B)
-- Sesja 18.05.2026b. Lovable NIE wykonuje migracji — wklej ręcznie w Supabase SQL Editor.
--
-- Cel: dyspozytor edytując zlecenie ma znać max wymiar towaru + liczbę paczek puchatego,
-- żeby pokazać ostrzeżenie "za krótka paka" / "limit styropianu" — analogicznie jak
-- sprzedawca w Kroku 2. Zapisy z parsera w trakcie tworzenia WZ.

ALTER TABLE zlecenia_wz ADD COLUMN IF NOT EXISTS max_wymiar_mm    INTEGER;
ALTER TABLE zlecenia_wz ADD COLUMN IF NOT EXISTS paczki_puchatego INTEGER;
ALTER TABLE zlecenia_wz ADD COLUMN IF NOT EXISTS typ_puchatego    TEXT
  CHECK (typ_puchatego IS NULL OR typ_puchatego IN ('XPS', 'EPS', 'WELNA', 'MIX'));

COMMENT ON COLUMN zlecenia_wz.max_wymiar_mm    IS 'Najdłuższy wymiar towaru w mm (max getMaxWymiarMm po pozycjach z parsera). NULL = brak danych.';
COMMENT ON COLUMN zlecenia_wz.paczki_puchatego IS 'Suma paczek (ilość) pozycji puchatego materiału w WZ (styropian/wełna).';
COMMENT ON COLUMN zlecenia_wz.typ_puchatego    IS 'Wykryty wariant puchatego: XPS/EPS/WELNA/MIX. NULL gdy brak puchatego.';

-- Stare WZ-y zostają z NULL (parser nie zapisał ich w czasie tworzenia).
-- Walidacja w dyspozytorze będzie pomijać te zlecenia (brak danych = brak ostrzeżenia).

-- Weryfikacja
SELECT
  COUNT(*) FILTER (WHERE max_wymiar_mm IS NOT NULL)    AS wz_z_wymiarem,
  COUNT(*) FILTER (WHERE paczki_puchatego IS NOT NULL) AS wz_z_paczkami,
  COUNT(*)                                              AS wszystkie
FROM zlecenia_wz;
