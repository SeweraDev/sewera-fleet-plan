import { supabase } from '@/integrations/supabase/client';

/** Ikony per typ powiadomienia */
export const POWIADOMIENIE_IKONY: Record<string, string> = {
  nowe_zlecenie: '\u{1F4E6}',
  zlecenie_w_kursie: '\u{1F69B}',
  zlecenie_w_trasie: '\u{1F6E3}\uFE0F',
  zlecenie_dostarczone: '\u2705',
  zlecenie_anulowane: '\u26A0\uFE0F',
  brak_wz_deadline: '\u23F0',
};

export function ikonaPowiadomienia(typ: string): string {
  return POWIADOMIENIE_IKONY[typ] || '\u{1F514}';
}

/** Wyślij powiadomienie do jednego użytkownika */
export async function wyslijPowiadomienie(params: {
  user_id: string;
  typ: string;
  tresc: string;
  zlecenie_id?: string;
}) {
  if (!params.user_id) return;
  await supabase.from('powiadomienia').insert({
    user_id: params.user_id,
    typ: params.typ,
    tresc: params.tresc,
    zlecenie_id: params.zlecenie_id || null,
    przeczytane: false,
  });
}

/** Wyślij powiadomienie do wszystkich dyspozytorów danego oddziału */
export async function wyslijDoDyspozytorów(
  oddzialNazwa: string,
  typ: string,
  tresc: string,
  zlecenieId?: string,
) {
  // Pobierz user_ids dyspozytorów z tego oddziału
  const { data: dyspozytorzy } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'dyspozytor');

  if (!dyspozytorzy || dyspozytorzy.length === 0) return;

  // Filtruj po oddziale — sprawdź profiles.branch
  const userIds = dyspozytorzy.map(d => d.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id')
    .in('id', userIds)
    .eq('branch', oddzialNazwa);

  if (!profiles || profiles.length === 0) return;

  const rows = profiles.map(p => ({
    user_id: p.id,
    typ,
    tresc,
    zlecenie_id: zlecenieId || null,
    przeczytane: false,
  }));

  await supabase.from('powiadomienia').insert(rows);
}
