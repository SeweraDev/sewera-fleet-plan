-- Archiwum WZ: kolumna na sciezke do JPEG w Supabase Storage
-- Format: 'YYYY-MM/{wz_id}.jpg' np. '2026-04/abc-123-def.jpg'
ALTER TABLE public.zlecenia_wz
  ADD COLUMN IF NOT EXISTS archiwum_path TEXT;

COMMENT ON COLUMN public.zlecenia_wz.archiwum_path IS
  'Sciezka w bucket wz-archiwum, format YYYY-MM/{wz_id}.jpg. NULL = brak archiwum (np. WZ wpisane recznie).';

-- ====================================================================
-- KROKI DO WYKONANIA RECZNIE W SUPABASE DASHBOARD (Lovable nie sync DB)
-- ====================================================================
--
-- 1) Utworzyc bucket: Storage > New bucket
--    - Name: wz-archiwum
--    - Public: NIE (private)
--    - File size limit: 500 KB (opcjonalnie)
--    - Allowed MIME types: image/jpeg
--
-- 2) RLS policies dla bucket (Storage > Policies > New policy):
--
-- Policy SELECT (zalogowani moga ogladac):
--   CREATE POLICY "authenticated_select_wz_archiwum"
--   ON storage.objects FOR SELECT TO authenticated
--   USING (bucket_id = 'wz-archiwum');
--
-- Policy INSERT (zalogowani moga uploadowac):
--   CREATE POLICY "authenticated_insert_wz_archiwum"
--   ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'wz-archiwum');
--
-- Policy DELETE (zalogowani moga usuwac - dla cleanup starszych miesiecy):
--   CREATE POLICY "authenticated_delete_wz_archiwum"
--   ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'wz-archiwum');
