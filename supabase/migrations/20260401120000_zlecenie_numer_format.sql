-- Krok 1: Dodaj kolumnę kod do oddzialy
ALTER TABLE public.oddzialy ADD COLUMN IF NOT EXISTS kod TEXT;

UPDATE oddzialy SET kod = CASE nazwa
  WHEN 'Katowice' THEN 'KAT'
  WHEN 'Sosnowiec' THEN 'SOS'
  WHEN 'Gliwice' THEN 'GL'
  WHEN 'Tarnowskie Góry' THEN 'TG'
  WHEN 'Chrzanów' THEN 'CH'
  WHEN 'Dąbrowa Górnicza' THEN 'DG'
  WHEN 'Oświęcim' THEN 'OS'
  WHEN 'Redystrybucja' THEN 'R'
END
WHERE kod IS NULL;

ALTER TABLE public.oddzialy ALTER COLUMN kod SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oddzialy_kod_unique') THEN
    ALTER TABLE public.oddzialy ADD CONSTRAINT oddzialy_kod_unique UNIQUE (kod);
  END IF;
END $$;

-- Krok 2: Funkcja generowania numeru zlecenia
CREATE OR REPLACE FUNCTION generuj_numer_zlecenia(p_oddzial_id INT)
RETURNS TEXT AS $$
DECLARE
  v_kod TEXT;
  v_rok TEXT;
  v_mies TEXT;
  v_seq INT;
  v_numer TEXT;
BEGIN
  SELECT kod INTO v_kod FROM oddzialy WHERE id = p_oddzial_id;
  IF v_kod IS NULL THEN
    RAISE EXCEPTION 'Oddział o id % nie istnieje lub nie ma kodu', p_oddzial_id;
  END IF;

  v_rok := to_char(now(), 'YY');
  v_mies := to_char(now(), 'MM');

  -- Atomic: max existing sequence number for this oddział+year+month
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(numer, '/', 4) AS INT)
  ), 0) + 1 INTO v_seq
  FROM zlecenia
  WHERE numer LIKE 'ZL-' || v_kod || '/' || v_rok || '/' || v_mies || '/%';

  v_numer := 'ZL-' || v_kod || '/' || v_rok || '/' || v_mies || '/' || LPAD(v_seq::TEXT, 3, '0');
  RETURN v_numer;
END;
$$ LANGUAGE plpgsql;

-- Krok 3: Przenumeruj istniejące zlecenia
WITH numbered AS (
  SELECT z.id, o.kod,
    to_char(z.created_at, 'YY') as rok,
    to_char(z.created_at, 'MM') as mies,
    ROW_NUMBER() OVER (
      PARTITION BY z.oddzial_id, to_char(z.created_at, 'YYMM')
      ORDER BY z.created_at
    ) as seq
  FROM zlecenia z
  JOIN oddzialy o ON o.id = z.oddzial_id
)
UPDATE zlecenia SET numer = 'ZL-' || n.kod || '/' || n.rok || '/' || n.mies || '/' || LPAD(n.seq::TEXT, 3, '0')
FROM numbered n WHERE zlecenia.id = n.id;
