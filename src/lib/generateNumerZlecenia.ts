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

/**
 * Generuje numer zlecenia w formacie ZL-KAT/26/04/001
 * Client-side — nie wymaga funkcji DB ani migracji.
 */
export async function generateNumerZlecenia(oddzialId: number): Promise<string> {
  // 1. Pobierz nazwę oddziału
  const { data: oddzial } = await supabase
    .from('oddzialy')
    .select('nazwa')
    .eq('id', oddzialId)
    .single();

  const kod = oddzial ? (ODDZIAL_KOD[oddzial.nazwa] || 'XX') : 'XX';

  // 2. Rok i miesiąc
  const now = new Date();
  const rok = String(now.getFullYear()).slice(2); // "26"
  const mies = String(now.getMonth() + 1).padStart(2, '0'); // "04"
  const prefix = `ZL-${kod}/${rok}/${mies}/`;

  // 3. Znajdź max istniejący numer dla tego oddziału/miesiąca
  const { data: existing } = await supabase
    .from('zlecenia')
    .select('numer')
    .like('numer', `${prefix}%`)
    .order('numer', { ascending: false })
    .limit(1);

  let seq = 1;
  if (existing && existing.length > 0) {
    const lastNumer = existing[0].numer;
    const lastSeq = parseInt(lastNumer.split('/').pop() || '0', 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, '0')}`;
}
