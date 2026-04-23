import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { NAZWA_TO_KOD } from '@/lib/oddzialy-geo';

// Kanoniczne typy pojazdu używane w kolumnach tabeli
export const TYPY_KANONICZNE = [
  'Dostawczy 1,2t',
  'Winda 1,8t',
  'Winda 6,3t',
  'Winda MAX 15,8t',
  'HDS 9,0t',
  'HDS 12,0t',
] as const;
export const TYP_BEZ_PREF = 'bez_preferencji';
export type TypKanoniczny = typeof TYPY_KANONICZNE[number] | typeof TYP_BEZ_PREF;

// Mapowanie raw typu (z flota/zlecenia) → kanonicznego
const TYP_NORM: Record<string, TypKanoniczny> = {
  'Dostawczy 1,2t': 'Dostawczy 1,2t',
  'Winda 1,8t': 'Winda 1,8t',
  'Winda 6,3t': 'Winda 6,3t',
  'Winda MAX 15,8t': 'Winda MAX 15,8t',
  'HDS 8,9t': 'HDS 9,0t',
  'HDS 9,0t': 'HDS 9,0t',
  'HDS 9,1t': 'HDS 9,0t',
  'HDS 11,7t': 'HDS 12,0t',
  'HDS 12,0t': 'HDS 12,0t',
  'HDS 12T': 'HDS 12,0t',
};

function normalizujTyp(raw: string | null | undefined): TypKanoniczny {
  if (!raw) return TYP_BEZ_PREF;
  if (raw === 'bez_preferencji' || raw === 'zewnetrzny') return TYP_BEZ_PREF;
  const clean = raw.startsWith('zew:') ? raw.slice(4) : raw;
  return TYP_NORM[clean] || TYP_BEZ_PREF;
}

export interface PozycjaDto {
  zl_id: string;
  zl_numer: string;
  oddzial_kod: string;
  oddzial_nazwa: string;
  typ_kanoniczny: TypKanoniczny;
  typ_raw: string | null; // oryginalny typ (z kursu jeśli w kursie, inaczej z zlecenia)
  w_kursie: boolean;
  kurs_numer: string | null;
  kurs_nr_rej: string | null;
  odbiorca: string | null;
  adres: string | null;
  suma_kg: number;
  suma_palet: number;
  status: string;
  dzien: string;
  preferowana_godzina: string | null;
}

/**
 * Pobiera wszystkie zlecenia wszystkich oddziałów w zakresie dat + informacje
 * o ich kursach (jeśli przypisane) i normalizuje typ pojazdu do kanonicznego
 * (7 wartości: 6 typów + bez_preferencji).
 *
 * @param dzien — data początkowa (YYYY-MM-DD)
 * @param dzienDo — data końcowa; jeśli brak, bierzemy tylko `dzien`
 */
export function usePrzegladOddzialow(dzien: string, dzienDo?: string) {
  const [pozycje, setPozycje] = useState<PozycjaDto[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const dataOd = dzien;
    const dataDo = dzienDo && dzienDo !== dzien ? dzienDo : dzien;

    // 1. Kursy z okresu (dla powiązań typu pojazdu)
    const { data: kursyRaw } = await supabase
      .from('kursy')
      .select('id, numer, status, flota_id, nr_rej_zewn, dzien')
      .gte('dzien', dataOd)
      .lte('dzien', dataDo)
      .neq('status', 'usuniety');

    const kursIds = (kursyRaw || []).map(k => k.id);

    // 2. Zlecenia: dzień w zakresie LUB kurs_id w zakresie
    let query = supabase
      .from('zlecenia')
      .select('id, numer, status, dzien, typ_pojazdu, preferowana_godzina, kurs_id, oddzial_id')
      .in('status', ['robocza', 'do_weryfikacji', 'potwierdzona', 'w_trasie'])
      .order('created_at', { ascending: true });

    const orParts = [`and(dzien.gte.${dataOd},dzien.lte.${dataDo})`];
    if (kursIds.length > 0) {
      orParts.push(`kurs_id.in.(${kursIds.join(',')})`);
    }
    query = query.or(orParts.join(','));

    const { data: zlData } = await query;
    const zlecenia = zlData || [];

    // 3. Oddziały — mapowanie id → nazwa
    const oddzialIds = new Set<number>();
    zlecenia.forEach(z => { if (z.oddzial_id) oddzialIds.add(z.oddzial_id); });
    const oddzialMap = new Map<number, string>();
    if (oddzialIds.size > 0) {
      const { data: oData } = await supabase
        .from('oddzialy').select('id, nazwa').in('id', [...oddzialIds]);
      (oData || []).forEach(o => oddzialMap.set(o.id, o.nazwa));
    }

    // 4. Flota własna — mapowanie id → typ
    const flotaIds = (kursyRaw || []).map(k => (k as any).flota_id).filter(Boolean) as string[];
    const flotaMap = new Map<string, { nr_rej: string; typ: string }>();
    if (flotaIds.length > 0) {
      const { data: fData } = await supabase
        .from('flota').select('id, nr_rej, typ').in('id', flotaIds);
      (fData || []).forEach(f => flotaMap.set(f.id, { nr_rej: f.nr_rej, typ: f.typ }));
    }

    // 5. Flota zewnętrzna — mapowanie nr_rej → typ
    const nrRejZewn = (kursyRaw || []).map(k => k.nr_rej_zewn).filter(Boolean) as string[];
    const flotaZewMap = new Map<string, string>();
    if (nrRejZewn.length > 0) {
      const { data: fzData } = await supabase
        .from('flota_zewnetrzna').select('nr_rej, typ').in('nr_rej', nrRejZewn);
      (fzData || []).forEach(fz => flotaZewMap.set(fz.nr_rej, fz.typ));
    }

    // 6. WZ per zlecenie — suma masy/palet + pierwszy odbiorca/adres
    const zlIds = zlecenia.map(z => z.id);
    const wzMap = new Map<string, { suma_kg: number; suma_palet: number; odbiorca: string | null; adres: string | null }>();
    if (zlIds.length > 0) {
      const { data: wzData } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, masa_kg, ilosc_palet, odbiorca, adres')
        .in('zlecenie_id', zlIds);
      (wzData || []).forEach(w => {
        const prev = wzMap.get(w.zlecenie_id) || { suma_kg: 0, suma_palet: 0, odbiorca: null, adres: null };
        prev.suma_kg += Number(w.masa_kg) || 0;
        prev.suma_palet += Number(w.ilosc_palet) || 0;
        if (!prev.odbiorca) prev.odbiorca = w.odbiorca;
        if (!prev.adres) prev.adres = w.adres;
        wzMap.set(w.zlecenie_id, prev);
      });
    }

    // 7. Kurs lookup by id
    const kursMap = new Map<string, { numer: string; flota_id: string | null; nr_rej_zewn: string | null }>();
    (kursyRaw || []).forEach(k => {
      kursMap.set(k.id, {
        numer: (k as any).numer || k.id.slice(0, 8),
        flota_id: (k as any).flota_id || null,
        nr_rej_zewn: k.nr_rej_zewn || null,
      });
    });

    // 8. Buduj pozycje
    const result: PozycjaDto[] = zlecenia.map(z => {
      const oddzial_nazwa = z.oddzial_id ? (oddzialMap.get(z.oddzial_id) || '') : '';
      const oddzial_kod = NAZWA_TO_KOD[oddzial_nazwa] || '';
      const wzInfo = wzMap.get(z.id) || { suma_kg: 0, suma_palet: 0, odbiorca: null, adres: null };

      // Typ: z kursu gdy w kursie, inaczej z zlecenia
      let typ_raw: string | null = z.typ_pojazdu || null;
      let kurs_numer: string | null = null;
      let kurs_nr_rej: string | null = null;
      if (z.kurs_id) {
        const kurs = kursMap.get(z.kurs_id);
        if (kurs) {
          kurs_numer = kurs.numer;
          if (kurs.flota_id) {
            const f = flotaMap.get(kurs.flota_id);
            if (f) { typ_raw = f.typ; kurs_nr_rej = f.nr_rej; }
          } else if (kurs.nr_rej_zewn) {
            kurs_nr_rej = kurs.nr_rej_zewn;
            const zewTyp = flotaZewMap.get(kurs.nr_rej_zewn);
            if (zewTyp) typ_raw = zewTyp;
          }
        }
      }

      return {
        zl_id: z.id,
        zl_numer: z.numer,
        oddzial_kod,
        oddzial_nazwa,
        typ_kanoniczny: normalizujTyp(typ_raw),
        typ_raw,
        w_kursie: !!z.kurs_id,
        kurs_numer,
        kurs_nr_rej,
        odbiorca: wzInfo.odbiorca,
        adres: wzInfo.adres,
        suma_kg: wzInfo.suma_kg,
        suma_palet: wzInfo.suma_palet,
        status: z.status,
        dzien: z.dzien,
        preferowana_godzina: z.preferowana_godzina,
      };
    });

    setPozycje(result);
    setLoading(false);
  }, [dzien, dzienDo]);

  useEffect(() => { refetch(); }, [refetch]);

  return { pozycje, loading, refetch };
}
