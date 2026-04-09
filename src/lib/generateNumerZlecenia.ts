import { supabase } from '@/integrations/supabase/client';

// Mapowanie oddziałów na kody (hardcoded — nie wymaga migracji DB)
const ODDZIAL_KOD: Record<string, string> = {
  'Katowice': 'KAT',
  'Sosnowiec': 'SOS',
  'Gliwice': 'GL',
  'Tarnowskie Góry': 'TG',
  'Chrzanów': 'CH',
  'Dąbrowa Górnicza': 'DG',
  'Oświęcim': 'OS',
  'Redystrybucja': 'R',
};

// Pobierz kod oddziału po ID
async function getOddzialKod(oddzialId: number): Promise<string> {
  const { data: oddzial } = await supabase
    .from('oddzialy')
    .select('nazwa')
    .eq('id', oddzialId)
    .single();
  return oddzial ? (ODDZIAL_KOD[oddzial.nazwa] || 'XX') : 'XX';
}

/**
 * Generuje numer zlecenia w formacie ZL-KAT/26/04/001
 * Client-side — nie wymaga funkcji DB ani migracji.
 */
export async function generateNumerZlecenia(oddzialId: number): Promise<string> {
  const kod = await getOddzialKod(oddzialId);
  const now = new Date();
  const rok = String(now.getFullYear()).slice(2);
  const mies = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `ZL-${kod}/${rok}/${mies}/`;

  const { data: existing } = await supabase
    .from('zlecenia')
    .select('numer')
    .like('numer', `${prefix}%`)
    .order('numer', { ascending: false })
    .limit(1);

  let seq = 1;
  if (existing && existing.length > 0) {
    const lastSeq = parseInt(existing[0].numer.split('/').pop() || '0', 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/**
 * Generuje numer kursu w formacie K-GL/26/04/001
 * Analogicznie do zleceń, ale z prefixem K-.
 */
export async function generateNumerKursu(oddzialId: number): Promise<string> {
  const kod = await getOddzialKod(oddzialId);
  const now = new Date();
  const rok = String(now.getFullYear()).slice(2);
  const mies = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `K-${kod}/${rok}/${mies}/`;

  const { data: existing } = await supabase
    .from('kursy')
    .select('numer')
    .like('numer', `${prefix}%`)
    .order('numer', { ascending: false })
    .limit(1);

  let seq = 1;
  if (existing && existing.length > 0) {
    const lastSeq = parseInt((existing[0].numer || '').split('/').pop() || '0', 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, '0')}`;
}
