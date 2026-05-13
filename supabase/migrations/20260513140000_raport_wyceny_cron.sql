-- ====================================================================
-- RAPORT WYCENY: pg_cron schedule dla automatycznych maili
-- ====================================================================
--
-- Wymagania:
--   1. Edge Function raport-wyceny wdrozona (Lovable to ogarnia automatycznie).
--   2. Secrets w Supabase Dashboard → Settings → Edge Functions → Secrets:
--      - RESEND_API_KEY      (klucz z resend.com — patrz instrukcje)
--      - RAPORT_EMAIL_TO     (np. grzegorz.sekienda@sewera.pl)
--      - RAPORT_EMAIL_FROM   (np. onboarding@resend.dev lub raporty@sewera.pl)
--   3. Service role key dostepny — w pg_cron uzywamy go do uwierzytelnienia.
--
-- ====================================================================

-- Wlacz potrzebne extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- USTAW SERVICE ROLE KEY jako Database Setting
-- ============================================================
-- WAZNE: zastap PASTE_TWOJ_SERVICE_ROLE_KEY_TUTAJ kluczem service_role
-- z Supabase Dashboard → Settings → API → service_role (klucz secret).
-- TEN KLUCZ ZWALCZA RLS — nie udostepniaj go.
--
-- Mozesz tez ustawic go raz przez SQL i potem korzystac:
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<klucz>';
-- Trzeba uruchomic z konta admin (postgres user).

-- Funkcja pomocnicza — wywoluje edge function z service_role auth
CREATE OR REPLACE FUNCTION public.wywolaj_raport_wyceny(okres text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
  v_request_id bigint;
BEGIN
  v_url := 'https://nnjsfeipkuesdxfljgul.supabase.co/functions/v1/raport-wyceny?okres=' || okres;

  -- Pobierz service role key z database setting
  v_key := current_setting('app.settings.service_role_key', true);

  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Brak app.settings.service_role_key — ustaw przez ALTER DATABASE.';
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- ============================================================
-- HARMONOGRAMY
-- ============================================================
-- Czasy w UTC (Supabase database ma UTC). 7:00 Polska = 5:00 UTC (zima) / 6:00 UTC (lato).
-- Wybieramy 5:00 UTC (czyli 7:00 w zimie i 7:00 w lato — w lato to 6:00 ale OK).
-- Ewentualnie zmien na '0 6 * * *' jak chcesz mocno 8:00 latem.

-- Codzienny raport (wczoraj) — 5:00 UTC = 7:00 PL zima / 6:00 PL lato (bliski "rano")
SELECT cron.unschedule('raport-wyceny-dzienny')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'raport-wyceny-dzienny');

SELECT cron.schedule(
  'raport-wyceny-dzienny',
  '0 5 * * *',  -- codziennie 5:00 UTC
  $$ SELECT public.wywolaj_raport_wyceny('dzien'); $$
);

-- Tygodniowy raport — poniedzialki 5:00 UTC
SELECT cron.unschedule('raport-wyceny-tygodniowy')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'raport-wyceny-tygodniowy');

SELECT cron.schedule(
  'raport-wyceny-tygodniowy',
  '0 5 * * 1',  -- poniedzialki 5:00 UTC
  $$ SELECT public.wywolaj_raport_wyceny('tydzien'); $$
);

-- Miesieczny raport — 1-szy dzien miesiaca 5:00 UTC
SELECT cron.unschedule('raport-wyceny-miesieczny')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'raport-wyceny-miesieczny');

SELECT cron.schedule(
  'raport-wyceny-miesieczny',
  '0 5 1 * *',  -- 1-szy dzien miesiaca 5:00 UTC
  $$ SELECT public.wywolaj_raport_wyceny('miesiac'); $$
);

-- ============================================================
-- KROKI RECZNE W SUPABASE DASHBOARD
-- ============================================================
--
-- 1) Ustaw service_role_key w database settings:
--    Database → SQL Editor:
--      ALTER DATABASE postgres SET app.settings.service_role_key = 'SKOPIUJ_TUTAJ_SERVICE_ROLE_KEY';
--    Service role key: Settings → API → service_role (secret).
--
-- 2) Dodaj secrets dla edge function:
--    Edge Functions → Secrets → New secret:
--      RESEND_API_KEY = re_XXXXXXX  (z resend.com)
--      RAPORT_EMAIL_TO = grzegorz.sekienda@sewera.pl
--      RAPORT_EMAIL_FROM = onboarding@resend.dev   (lub raporty@sewera.pl po weryfikacji domeny)
--
-- 3) Sprawdz ze harmonogram dziala:
--    SELECT * FROM cron.job;
--    -- Powinny byc 3 wpisy: raport-wyceny-dzienny / tygodniowy / miesieczny
--
-- 4) Test reczny — wyslij raport NATYCHMIAST (bez czekania na 7:00):
--    SELECT public.wywolaj_raport_wyceny('dzien');
--    -- Sprawdz w skrzynce + Resend Dashboard "Sent Emails"
--
-- ============================================================
