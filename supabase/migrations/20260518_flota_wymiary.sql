-- Migracja: wymiary paki + miejsca paletowe + limit styropianu (XPS/EPS)
-- Sesja 18.05.2026. Dane z pliku "wymiary pojazdów.ods" (33 auta + Winda MAX).
-- UWAGA: Lovable sync NIE wykonuje migracji — wklej ręcznie w Supabase SQL Editor.

-- 1. Nowe kolumny w flota
ALTER TABLE flota ADD COLUMN IF NOT EXISTS miejsc_paletowych           INTEGER;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS miejsc_paletowych_bez_widel INTEGER;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS xps_paczek                  INTEGER;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS eps_paczek                  INTEGER;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS dl_paki_cm                  INTEGER;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS szer_paki_cm                INTEGER;
ALTER TABLE flota ADD COLUMN IF NOT EXISTS wys_paki_cm                 INTEGER;

COMMENT ON COLUMN flota.miejsc_paletowych           IS 'Liczba miejsc paletowych euro 1200x800 z widłami/paleciakiem';
COMMENT ON COLUMN flota.miejsc_paletowych_bez_widel IS 'Liczba miejsc bez wideł (gdy się różni — typowo +1 dla 6,3t)';
COMMENT ON COLUMN flota.xps_paczek                  IS 'Limit paczek styropianu XPS (mieszczących się na aucie)';
COMMENT ON COLUMN flota.eps_paczek                  IS 'Limit paczek styropianu EPS';
COMMENT ON COLUMN flota.dl_paki_cm                  IS 'Długość paki wewnętrznej w cm (np. 8,1m = 810)';
COMMENT ON COLUMN flota.szer_paki_cm                IS 'Szerokość paki wewnętrznej w cm';
COMMENT ON COLUMN flota.wys_paki_cm                 IS 'Wysokość paki wewnętrznej w cm — NULL dla HDS (otwarta naczepa)';

-- 2. UPDATE per nr_rej
-- HDS-y (~8-10t, otwarta naczepa — wys paki NULL, brak styropianu)
UPDATE flota SET miejsc_paletowych=14, miejsc_paletowych_bez_widel=14, dl_paki_cm=640, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK2952G';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK0355J';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK6839G';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK7839G';
UPDATE flota SET miejsc_paletowych=14, miejsc_paletowych_bez_widel=14, dl_paki_cm=650, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK8690M';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK2116V';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK901CU';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=595, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK2427N';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=NULL WHERE nr_rej='SK2114V';
UPDATE flota SET miejsc_paletowych=12, miejsc_paletowych_bez_widel=12, dl_paki_cm=640, szer_paki_cm=250, wys_paki_cm=NULL WHERE nr_rej='SK726PY';
-- SK8691M: prawie pusty rekord — tylko ładowność + miejsca paletowe
UPDATE flota SET miejsc_paletowych=10, miejsc_paletowych_bez_widel=10 WHERE nr_rej='SK8691M';

-- Windy 6,3t (~5,8-6,3t, kryta paka)
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=220 WHERE nr_rej='SK3022G';
UPDATE flota SET miejsc_paletowych=14, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=560, szer_paki_cm=250, wys_paki_cm=220 WHERE nr_rej='SK528MC';
UPDATE flota SET miejsc_paletowych=14, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=560, szer_paki_cm=250, wys_paki_cm=220 WHERE nr_rej='SK7457G';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=88, eps_paczek=96, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=220 WHERE nr_rej='SK2115V';
UPDATE flota SET miejsc_paletowych=14, miejsc_paletowych_bez_widel=15, xps_paczek=96, eps_paczek=120, dl_paki_cm=630, szer_paki_cm=240, wys_paki_cm=250 WHERE nr_rej='SK2641K';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=220 WHERE nr_rej='SK0703J';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=220 WHERE nr_rej='SK0356J';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=600, szer_paki_cm=250, wys_paki_cm=240 WHERE nr_rej='SK1037N';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=90, eps_paczek=90, dl_paki_cm=600, szer_paki_cm=245, wys_paki_cm=220 WHERE nr_rej='SK7513W';
UPDATE flota SET miejsc_paletowych=16, miejsc_paletowych_bez_widel=16, xps_paczek=100, eps_paczek=100, dl_paki_cm=700, szer_paki_cm=240, wys_paki_cm=240 WHERE nr_rej='SK55023';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=590, szer_paki_cm=240, wys_paki_cm=230 WHERE nr_rej='SK1035N';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=590, szer_paki_cm=240, wys_paki_cm=230 WHERE nr_rej='SK1036N';
UPDATE flota SET miejsc_paletowych=13, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=590, szer_paki_cm=240, wys_paki_cm=230 WHERE nr_rej='SK1038N';
UPDATE flota SET miejsc_paletowych=14, miejsc_paletowych_bez_widel=14, xps_paczek=96, eps_paczek=96, dl_paki_cm=640, szer_paki_cm=248, wys_paki_cm=200 WHERE nr_rej='SK53013';

-- Windy 1,8t
UPDATE flota SET miejsc_paletowych=7, miejsc_paletowych_bez_widel=8, xps_paczek=48, eps_paczek=48, dl_paki_cm=420, szer_paki_cm=205, wys_paki_cm=215 WHERE nr_rej='SK829CX';
UPDATE flota SET miejsc_paletowych=7, miejsc_paletowych_bez_widel=8, xps_paczek=48, eps_paczek=48, dl_paki_cm=420, szer_paki_cm=205, wys_paki_cm=215 WHERE nr_rej='SK7450M';

-- Dostawcze 1,2t
UPDATE flota SET miejsc_paletowych=5, miejsc_paletowych_bez_widel=5, xps_paczek=50, eps_paczek=50, dl_paki_cm=410, szer_paki_cm=230, wys_paki_cm=210 WHERE nr_rej='SD0729G';
UPDATE flota SET miejsc_paletowych=6, miejsc_paletowych_bez_widel=6, xps_paczek=40, eps_paczek=40, dl_paki_cm=350, szer_paki_cm=210, wys_paki_cm=210 WHERE nr_rej='SK159PW';
UPDATE flota SET miejsc_paletowych=7, miejsc_paletowych_bez_widel=7, xps_paczek=48, eps_paczek=48, dl_paki_cm=420, szer_paki_cm=210, wys_paki_cm=210 WHERE nr_rej='SK137VM';
UPDATE flota SET miejsc_paletowych=7, miejsc_paletowych_bez_widel=7, xps_paczek=48, eps_paczek=48, dl_paki_cm=420, szer_paki_cm=210, wys_paki_cm=210 WHERE nr_rej='SK627SP';
UPDATE flota SET miejsc_paletowych=7, miejsc_paletowych_bez_widel=7, xps_paczek=48, eps_paczek=48, dl_paki_cm=420, szer_paki_cm=210, wys_paki_cm=210 WHERE nr_rej='SK862XS';
UPDATE flota SET miejsc_paletowych=7, miejsc_paletowych_bez_widel=7, xps_paczek=48, eps_paczek=48, dl_paki_cm=420, szer_paki_cm=210, wys_paki_cm=210 WHERE nr_rej='SK720KH';

-- Winda MAX (15,8t) — UWAGA: w pliku nie podano nr_rej; updateujemy WHERE typ
-- Jeśli macie wiele Wind MAX z różnymi parametrami — zamień na konkretne nr_rej.
UPDATE flota SET miejsc_paletowych=22, miejsc_paletowych_bez_widel=22, dl_paki_cm=890, szer_paki_cm=248, wys_paki_cm=275 WHERE typ='Winda MAX 15,8t' OR typ='Winda MAX';

-- 3. Sprawdź wynik
SELECT nr_rej, typ, ladownosc_kg, miejsc_paletowych, miejsc_paletowych_bez_widel,
       xps_paczek, eps_paczek, dl_paki_cm, szer_paki_cm, wys_paki_cm
FROM flota
WHERE aktywny = true
ORDER BY ladownosc_kg DESC, nr_rej;
