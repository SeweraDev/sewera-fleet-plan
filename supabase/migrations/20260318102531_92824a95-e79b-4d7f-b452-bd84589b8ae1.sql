
ALTER TABLE public.flota_zewnetrzna
  ADD COLUMN IF NOT EXISTS ladownosc_kg INT,
  ADD COLUMN IF NOT EXISTS kierowca VARCHAR(80),
  ADD COLUMN IF NOT EXISTS tel VARCHAR(20),
  ADD COLUMN IF NOT EXISTS oddzial_id INT REFERENCES oddzialy(id),
  ADD COLUMN IF NOT EXISTS aktywny BOOLEAN NOT NULL DEFAULT true;

UPDATE public.flota_zewnetrzna
SET ladownosc_kg = 12000,
    kierowca = 'Andrzej Nowak',
    tel = '662000000',
    oddzial_id = (SELECT id FROM oddzialy WHERE nazwa='Katowice')
WHERE nr_rej = 'SL52567A';
