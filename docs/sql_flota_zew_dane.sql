-- Dodanie kolumn dla transportu zewnętrznego + dane kierowców
-- Uruchom w Supabase SQL Editor

-- 1. Dodaj kolumny (jeśli nie istnieją)
ALTER TABLE flota ADD COLUMN IF NOT EXISTS firma_zew TEXT;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS kierowca_zew TEXT;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS telefon_zew TEXT;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS jest_zewnetrzny BOOLEAN DEFAULT false;

-- 2. Uzupełnij dane pojazdów zewnętrznych
UPDATE flota SET firma_zew = 'Trans', kierowca_zew = 'Jan Nowak', telefon_zew = '662200000', jest_zewnetrzny = true WHERE nr_rej = 'SD11651W';
UPDATE flota SET firma_zew = 'Speed', kierowca_zew = 'Kazimierz Wolny', telefon_zew = '503515145', jest_zewnetrzny = true WHERE nr_rej = 'SK2156W';
UPDATE flota SET firma_zew = 'Delta', kierowca_zew = 'Jan Kowalski', telefon_zew = '880256654', jest_zewnetrzny = true WHERE nr_rej = 'SG5898';
UPDATE flota SET firma_zew = 'Logistyka', kierowca_zew = 'Paweł', telefon_zew = '665325477', jest_zewnetrzny = true WHERE nr_rej = 'SG1258986';
UPDATE flota SET firma_zew = 'Transporty', kierowca_zew = 'Andrzej Iksiński', telefon_zew = '856633124', jest_zewnetrzny = true WHERE nr_rej = 'KCH566W';
