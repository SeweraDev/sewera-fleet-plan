// Hook dla modułu rozliczenia kosztów transportu — pobiera zakończone kursy
// w zadanym zakresie dat i oddziale, dla każdego liczy: km OSRM (kółko),
// km_prosta per punkt (Haversine), wywołuje rozliczKurs i zwraca gotowe wyniki.
//
// Tylko kursy z auto własnym (flota_id != null) są rozliczane tym algorytmem.
// Kursy zewnętrzne pomijamy (rozliczane po fakturach firm zew).

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { rozliczKurs, type WzDoRozliczenia, type RozliczenieKursu } from '@/lib/rozliczenie-kolka';
import { getKmProstaFromOddzial, geocodeAddress, calculateRouteTotal } from '@/lib/oddzialy-geo';

export interface RozliczenieKursuRow {
  kurs_id: string;
  numer: string;
  dzien: string;
  nr_rej: string;
  typ_pojazdu: string;
  kierowca: string;
  oddzial_nazwa: string;
  rozliczenie: RozliczenieKursu;
}

export function useRozliczenieKursow(oddzialId: number | null, dzienOd: string, dzienDo: string) {
  const [rows, setRows] = useState<RozliczenieKursuRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!oddzialId || !dzienOd || !dzienDo) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // Pobierz nazwę oddziału do get-km-prosta i OSRM
      const { data: odzData } = await supabase
        .from('oddzialy').select('nazwa').eq('id', oddzialId).maybeSingle();
      const oddzialNazwa = (odzData as any)?.nazwa || '';

      // Kursy zakończone w zakresie + własne auta (flota_id != null)
      // + info o pojeździe i kierowcy
      const { data: kursyData, error: errK } = await supabase
        .from('kursy')
        .select('id, numer, dzien, status, flota_id, kierowca_id')
        .eq('oddzial_id', oddzialId)
        .eq('status', 'zakonczony')
        .gte('dzien', dzienOd)
        .lte('dzien', dzienDo)
        .not('flota_id', 'is', null)
        .order('dzien', { ascending: false });
      if (errK) throw errK;

      if (!kursyData || kursyData.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const flotaIds = Array.from(new Set(kursyData.map(k => k.flota_id).filter(Boolean))) as string[];
      const kierowcaIds = Array.from(new Set(kursyData.map(k => k.kierowca_id).filter(Boolean))) as string[];

      const [flotaRes, kierRes] = await Promise.all([
        flotaIds.length ? supabase.from('flota').select('id, nr_rej, typ').in('id', flotaIds) : Promise.resolve({ data: [] as any[] }),
        kierowcaIds.length ? supabase.from('profiles').select('id, full_name').in('id', kierowcaIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const flotaMap = new Map((flotaRes.data || []).map((f: any) => [f.id, f]));
      const kierMap = new Map((kierRes.data || []).map((p: any) => [p.id, p.full_name]));

      // Przystanki + WZ dla wszystkich kursów
      const kursIds = kursyData.map(k => k.id);
      const { data: przData } = await supabase
        .from('kurs_przystanki')
        .select('id, kurs_id, kolejnosc, zlecenie_id')
        .in('kurs_id', kursIds)
        .order('kolejnosc');

      const zlIds = Array.from(new Set((przData || []).map(p => p.zlecenie_id).filter(Boolean))) as string[];
      const { data: wzData } = zlIds.length
        ? await supabase
            .from('zlecenia_wz')
            .select('id, zlecenie_id, odbiorca, adres, masa_kg, klasyfikacja, wartosc_netto, numer_wz')
            .in('zlecenie_id', zlIds)
        : { data: [] as any[] };

      const wzByZlec = new Map<string, any[]>();
      (wzData || []).forEach((w: any) => {
        const list = wzByZlec.get(w.zlecenie_id) || [];
        list.push(w);
        wzByZlec.set(w.zlecenie_id, list);
      });

      // Dla każdego kursa: geocoduj unikalne adresy, policz km OSRM kółka, wywołaj rozliczKurs
      const result: RozliczenieKursuRow[] = [];

      for (const k of kursyData) {
        const kursPrz = (przData || []).filter(p => p.kurs_id === k.id);
        const wzDoRozl: WzDoRozliczenia[] = [];
        const adresyUnique = new Set<string>();

        for (const p of kursPrz) {
          const wzy = p.zlecenie_id ? (wzByZlec.get(p.zlecenie_id) || []) : [];
          for (const w of wzy) {
            if (w.adres) adresyUnique.add(w.adres);
            wzDoRozl.push({
              id: w.id,
              numer_wz: w.numer_wz || '',
              odbiorca: w.odbiorca || '',
              adres: w.adres || '',
              klasyfikacja: w.klasyfikacja || null,
              masa_kg: Number(w.masa_kg) || 0,
              wartosc_netto: w.wartosc_netto != null ? Number(w.wartosc_netto) : null,
              kolejnosc: p.kolejnosc,
              km_prosta: null, // wypełnimy poniżej
            });
          }
        }

        // Geocode adresów → km_prosta
        const adresyArr = Array.from(adresyUnique);
        const prostyMap = new Map<string, number | null>();
        for (const adres of adresyArr) {
          if (!adres || adres.length < 4) { prostyMap.set(adres, null); continue; }
          const coords = await geocodeAddress(adres);
          if (!coords) { prostyMap.set(adres, null); continue; }
          prostyMap.set(adres, getKmProstaFromOddzial(oddzialNazwa, coords.lat, coords.lng));
        }
        wzDoRozl.forEach(w => { w.km_prosta = prostyMap.get(w.adres) ?? null; });

        // Km OSRM kółka: oddział → unikalne adresy → oddział
        const kmKolka = adresyArr.length > 0 ? (await calculateRouteTotal(oddzialNazwa, adresyArr)) || 0 : 0;

        const rozliczenie = rozliczKurs(kmKolka, wzDoRozl);

        const flota = flotaMap.get(k.flota_id!) as any;
        result.push({
          kurs_id: k.id,
          numer: k.numer || '',
          dzien: k.dzien,
          nr_rej: flota?.nr_rej || '?',
          typ_pojazdu: flota?.typ || '?',
          kierowca: (k.kierowca_id && kierMap.get(k.kierowca_id)) || '—',
          oddzial_nazwa: oddzialNazwa,
          rozliczenie,
        });
      }

      setRows(result);
    } catch (e: any) {
      setError(e.message || 'Błąd pobierania rozliczenia');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [oddzialId, dzienOd, dzienDo]);

  useEffect(() => { refetch(); }, [refetch]);

  return { rows, loading, error, refetch };
}
