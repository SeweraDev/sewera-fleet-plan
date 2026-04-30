import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Pobiera flotę wszystkich oddziałów (własną + zewnętrzną) i zwraca:
 * - typyPerOddzial: Map<oddzial_id, Set<typ>> — jakie typy aut ma każdy oddział
 * - nazwyOddzialow: Map<oddzial_id, nazwa>
 *
 * Używane do sugestii cross-branch: gdy zlecenie ma typ_pojazdu wpisany,
 * a oddział macierzysty go nie ma — pokazujemy "↗ Przekaż do X".
 */

const TYP_NORMALIZE: Record<string, string> = { 'HDS 12T': 'HDS 12,0t' };

export function useFlotaWszystkichOddzialow() {
  const [typyPerOddzial, setTypyPerOddzial] = useState<Map<number, Set<string>>>(new Map());
  const [nazwyOddzialow, setNazwyOddzialow] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let canceled = false;
    (async () => {
      setLoading(true);
      const [resOdd, resWlasna, resZew] = await Promise.all([
        supabase.from('oddzialy').select('id, nazwa'),
        supabase
          .from('flota')
          .select('typ, oddzial_id, aktywny')
          .eq('aktywny', true),
        supabase
          .from('flota_zewnetrzna')
          .select('typ, oddzial_id, aktywny')
          .eq('aktywny', true),
      ]);

      if (canceled) return;

      const nazwy = new Map<number, string>();
      for (const o of resOdd.data || []) {
        nazwy.set(o.id, o.nazwa);
      }

      const typy = new Map<number, Set<string>>();
      const dodaj = (oddzialId: number | null, typ: string) => {
        if (oddzialId == null) return;
        const set = typy.get(oddzialId) || new Set<string>();
        set.add(TYP_NORMALIZE[typ] || typ);
        typy.set(oddzialId, set);
      };
      for (const f of resWlasna.data || []) dodaj(f.oddzial_id, f.typ);
      for (const f of resZew.data || []) dodaj(f.oddzial_id, f.typ);

      setNazwyOddzialow(nazwy);
      setTypyPerOddzial(typy);
      setLoading(false);
    })();
    return () => { canceled = true; };
  }, []);

  return { typyPerOddzial, nazwyOddzialow, loading };
}

/**
 * Znajdź pierwszy oddział, który ma dany typ pojazdu we flocie.
 * Pomija oddział macierzysty (excludeOddzialId).
 *
 * Preferuje parę KAT/R (ten sam adres bazy) — jeśli source = R,
 * a KAT ma typ → KAT jest naturalnym targetem (bez logistyki).
 *
 * @returns {oddzial_id, nazwa} albo null gdy żaden inny oddział nie ma tego typu
 */
export function findOddzialZTypem(
  typ: string,
  excludeOddzialId: number | null,
  typyPerOddzial: Map<number, Set<string>>,
  nazwyOddzialow: Map<number, string>,
): { oddzial_id: number; nazwa: string } | null {
  if (!typ) return null;

  const normTyp = TYP_NORMALIZE[typ] || typ;
  const excludeNazwa = excludeOddzialId != null ? nazwyOddzialow.get(excludeOddzialId) : null;

  // Preferowany partner KAT↔R (ten sam adres) — sprawdź najpierw
  let preferowany: { oddzial_id: number; nazwa: string } | null = null;
  if (excludeNazwa === 'Katowice' || excludeNazwa === 'Redystrybucja') {
    const partner = excludeNazwa === 'Katowice' ? 'Redystrybucja' : 'Katowice';
    for (const [id, nazwa] of nazwyOddzialow) {
      if (nazwa === partner) {
        const ts = typyPerOddzial.get(id);
        if (ts && ts.has(normTyp)) {
          preferowany = { oddzial_id: id, nazwa };
          break;
        }
      }
    }
  }
  if (preferowany) return preferowany;

  // Inne oddziały — pierwszy z brzegu
  for (const [oddzialId, typySet] of typyPerOddzial) {
    if (oddzialId === excludeOddzialId) continue;
    if (typySet.has(normTyp)) {
      return {
        oddzial_id: oddzialId,
        nazwa: nazwyOddzialow.get(oddzialId) || `#${oddzialId}`,
      };
    }
  }

  return null;
}
