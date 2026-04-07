-- Dodanie pojazdów zewnętrznych do floty
-- Uruchom w Supabase SQL Editor

-- Sosnowiec: SD11651W, HDS 12T, Trans, Jan Nowak
INSERT INTO flota (nr_rej, typ, ladownosc_kg, max_palet, objetosc_m3, aktywny, oddzial_id)
SELECT 'SD11651W', 'HDS 12T', 12000, 12, NULL, true, id FROM oddzialy WHERE nazwa = 'Sosnowiec';

-- D.Górnicza: SK2156W, HDS 12T, Speed, Kazimierz Wolny
INSERT INTO flota (nr_rej, typ, ladownosc_kg, max_palet, objetosc_m3, aktywny, oddzial_id)
SELECT 'SK2156W', 'HDS 12T', 12000, 12, NULL, true, id FROM oddzialy WHERE nazwa = 'Dąbrowa Górnicza';

-- Gliwice: SG5898, Dostawczy 1,2t, Delta, Jan Kowalski
INSERT INTO flota (nr_rej, typ, ladownosc_kg, max_palet, objetosc_m3, aktywny, oddzial_id)
SELECT 'SG5898', 'Dostawczy 1,2t', 1500, 8, 12, true, id FROM oddzialy WHERE nazwa = 'Gliwice';

-- Gliwice: SG1258986, HDS 12T, Logistyka, Paweł
INSERT INTO flota (nr_rej, typ, ladownosc_kg, max_palet, objetosc_m3, aktywny, oddzial_id)
SELECT 'SG1258986', 'HDS 12T', 12000, 12, NULL, true, id FROM oddzialy WHERE nazwa = 'Gliwice';

-- Oświęcim: KCH566W, HDS 12T, Transporty, Andrzej Iksiński
INSERT INTO flota (nr_rej, typ, ladownosc_kg, max_palet, objetosc_m3, aktywny, oddzial_id)
SELECT 'KCH566W', 'HDS 12T', 12000, 12, NULL, true, id FROM oddzialy WHERE nazwa = 'Oświęcim';
