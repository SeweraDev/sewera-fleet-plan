-- Aktualizacja floty: max_palet i objetosc_m3 per pojazd
-- Uruchom w Supabase SQL Editor
-- Dane od Grzegorza 03.04.2026

-- Dostawczy 1,2t
UPDATE flota SET max_palet = 2, objetosc_m3 = 18.5 WHERE nr_rej = 'SK4946W';
UPDATE flota SET max_palet = 2, objetosc_m3 = 18.5 WHERE nr_rej = 'SK709SJ';
UPDATE flota SET max_palet = 6, objetosc_m3 = 18.5 WHERE nr_rej = 'SK159PW';
UPDATE flota SET max_palet = 7, objetosc_m3 = 18.5 WHERE nr_rej = 'SK627SP';
UPDATE flota SET max_palet = 7, objetosc_m3 = 18.5 WHERE nr_rej = 'SK720KH';
UPDATE flota SET max_palet = 7, objetosc_m3 = 18.5 WHERE nr_rej = 'SK862XS';
UPDATE flota SET max_palet = 5, objetosc_m3 = 18.5 WHERE nr_rej = 'SD0792G';
UPDATE flota SET max_palet = 7, objetosc_m3 = 18.5 WHERE nr_rej = 'SK137VM';

-- HDS
UPDATE flota SET max_palet = 12 WHERE nr_rej = 'SK726PY';
UPDATE flota SET max_palet = 12 WHERE nr_rej = 'SK0355J';
UPDATE flota SET max_palet = 12 WHERE nr_rej = 'SK2427N';
UPDATE flota SET max_palet = 12 WHERE nr_rej = 'SK6839G';
UPDATE flota SET max_palet = 12 WHERE nr_rej = 'SK7839G';
UPDATE flota SET max_palet = 12 WHERE nr_rej = 'SK901CU';
UPDATE flota SET max_palet = 12 WHERE nr_rej = 'SK2116V';

-- Winda 6,3t
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK0356J';
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK0703J';
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK1035N';
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK1037N';
UPDATE flota SET max_palet = 14, objetosc_m3 = 30 WHERE nr_rej = 'SK2641K';
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK3022G';
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK7513W';
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK1036N';
UPDATE flota SET max_palet = 13, objetosc_m3 = 32 WHERE nr_rej = 'SK2115V';
UPDATE flota SET max_palet = 14, objetosc_m3 = 30 WHERE nr_rej = 'SK528MC';
UPDATE flota SET max_palet = 14, objetosc_m3 = 30 WHERE nr_rej = 'SK7457G';

-- Winda 1,8t
UPDATE flota SET max_palet = 7, objetosc_m3 = 18 WHERE nr_rej = 'SK829CX';

-- Winda MAX 15,8t
UPDATE flota SET max_palet = 22, objetosc_m3 = 60 WHERE nr_rej = 'SK8G013';

-- Aktualizacja ładowności (niektóre auta mają inne kg)
UPDATE flota SET ladownosc_kg = 1100 WHERE nr_rej = 'SK627SP';
UPDATE flota SET ladownosc_kg = 1100 WHERE nr_rej = 'SK720KH';
UPDATE flota SET ladownosc_kg = 990 WHERE nr_rej = 'SK862XS';
UPDATE flota SET ladownosc_kg = 980 WHERE nr_rej = 'SK137VM';
UPDATE flota SET ladownosc_kg = 9100 WHERE nr_rej = 'SK2427N';
UPDATE flota SET ladownosc_kg = 5800 WHERE nr_rej = 'SK2641K';
