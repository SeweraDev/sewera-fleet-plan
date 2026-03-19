
CREATE TABLE IF NOT EXISTS powiadomienia (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  typ         VARCHAR(50) NOT NULL,
  tresc       TEXT NOT NULL,
  zlecenie_id UUID REFERENCES zlecenia(id),
  przeczytane BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE powiadomienia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_powiadomienia" ON powiadomienia
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users_update_own_powiadomienia" ON powiadomienia
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "service_insert_powiadomienia" ON powiadomienia
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Enable realtime for powiadomienia
ALTER PUBLICATION supabase_realtime ADD TABLE public.powiadomienia;
