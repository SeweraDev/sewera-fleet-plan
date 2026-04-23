import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAddress } from '@/lib/oddzialy-geo';

export interface MapaZlecenieDto {
  id: string;
  numer: string;
  status: string;
  dzien: string;
  typ_pojazdu: string | null;
  preferowana_godzina: string | null;
  oddzial_kod: string;
  oddzial_nazwa: string;
  kurs_id: string | null;
  kurs_numer: string | null;
  kurs_nr_rej: string | null;
  kurs_pojazd_typ: string | null;
  odbiorca: string | null;
  adres: string | null;
  suma_kg: number;
  suma_m3: number;
  suma_palet: number;
  lat: number | null;
  lng: number | null;
}

import { NAZWA_TO_KOD } from '@/lib/oddzialy-geo';

/**
 * Pobiera zlecenia WSZYSTKICH oddziałów na wybrany dzień (lub zakres)
 * z danymi WZ, kursów i geocodingiem.
 */
export function useMapaZlecen(dzien: string) {
  const [zlecenia, setZlecenia] = useState<MapaZlecenieDto[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);

    // 1a. Kursy z wybranego dnia — żeby zlecenia przypisane do nich też były
    //     widoczne, nawet jeśli ich zlecenia.dzien wskazuje na inny dzień
    //     (zlecenie mogło być planowane na wczoraj, a dziś jedzie w kursie).
    const { data: kursyDnia } = await supabase
      .from('kursy')
      .select('id')
      .eq('dzien', dzien);
    const kursIdsZDnia = (kursyDnia || []).map(k => k.id);

    // 1b. Zlecenia: (dzien == wybrany dzień)
    //          LUB (przypisane do kursu z wybranego dnia)
    //          LUB (bez kursu — zaległe/nieprzydzielone, niezależnie od daty)
    // Zlecenia bez kursu muszą być widoczne na mapie żeby dyspozytor mógł je
    // zaplanować — dotyczy to też zleceń przekazanych z innych oddziałów,
    // które trafiają bez kursu.
    let query = supabase
      .from('zlecenia')
      .select('id, numer, status, dzien, typ_pojazdu, preferowana_godzina, kurs_id, oddzial_id')
      .in('status', ['robocza', 'do_weryfikacji', 'potwierdzona', 'w_trasie'])
      .order('created_at', { ascending: true });

    const orParts = [`dzien.eq.${dzien}`, 'kurs_id.is.null'];
    if (kursIdsZDnia.length > 0) {
      orParts.push(`kurs_id.in.(${kursIdsZDnia.join(',')})`);
    }
    query = query.or(orParts.join(','));

    const { data: zlData } = await query;

    if (!zlData || zlData.length === 0) {
      setZlecenia([]);
      setLoading(false);
      return;
    }

    // 2. Oddziały
    const oddzialIds = [...new Set(zlData.map(z => z.oddzial_id).filter(Boolean))];
    const oddzialMap = new Map<number, string>();
    if (oddzialIds.length > 0) {
      const { data: oData } = await supabase
        .from('oddzialy')
        .select('id, nazwa')
        .in('id', oddzialIds);
      (oData || []).forEach(o => oddzialMap.set(o.id, o.nazwa));
    }

    // 3. Kursy
    const kursIds = zlData.map(z => z.kurs_id).filter(Boolean) as string[];
    const kursMap = new Map<string, { numer: string; flota_id: string | null; nr_rej_zewn: string | null }>();
    if (kursIds.length > 0) {
      const { data: kData } = await supabase
        .from('kursy')
        .select('id, numer, flota_id, nr_rej_zewn')
        .in('id', kursIds);
      (kData || []).forEach(k => kursMap.set(k.id, {
        numer: (k as any).numer || k.id.slice(0, 8),
        flota_id: (k as any).flota_id,
        nr_rej_zewn: k.nr_rej_zewn,
      }));
    }

    // 4. Flota (nr_rej + typ per kurs)
    const flotaIds = Array.from(kursMap.values()).map(k => k.flota_id).filter(Boolean) as string[];
    const flotaMap = new Map<string, { nr_rej: string; typ: string }>();
    if (flotaIds.length > 0) {
      const { data: fData } = await supabase
        .from('flota')
        .select('id, nr_rej, typ')
        .in('id', flotaIds);
      (fData || []).forEach(f => flotaMap.set(f.id, { nr_rej: f.nr_rej, typ: f.typ }));
    }

    // 5. Flota zewnętrzna
    const zewNrRej = Array.from(kursMap.values())
      .filter(k => !k.flota_id && k.nr_rej_zewn)
      .map(k => k.nr_rej_zewn!);
    const flotaZewMap = new Map<string, { typ: string }>();
    if (zewNrRej.length > 0) {
      const { data: zewData } = await supabase
        .from('flota_zewnetrzna')
        .select('nr_rej, typ')
        .in('nr_rej', zewNrRej);
      (zewData || []).forEach(f => flotaZewMap.set(f.nr_rej, { typ: f.typ }));
    }

    // 6. WZ sumy + odbiorca/adres
    const ids = zlData.map(z => z.id);
    const wzMap = new Map<string, { suma_kg: number; suma_m3: number; suma_palet: number; odbiorca: string | null; adres: string | null }>();
    if (ids.length > 0) {
      const { data: wzData } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, masa_kg, objetosc_m3, ilosc_palet, odbiorca, adres')
        .in('zlecenie_id', ids);
      (wzData || []).forEach(w => {
        const cur = wzMap.get(w.zlecenie_id);
        const wAny = w as any;
        wzMap.set(w.zlecenie_id, {
          suma_kg: (cur?.suma_kg || 0) + Number(w.masa_kg),
          suma_m3: (cur?.suma_m3 || 0) + Number(w.objetosc_m3 || 0),
          suma_palet: (cur?.suma_palet || 0) + Number(wAny.ilosc_palet || 0),
          odbiorca: cur?.odbiorca || wAny.odbiorca || null,
          adres: cur?.adres || wAny.adres || null,
        });
      });
    }

    // 7. Buduj DTOs
    const result: MapaZlecenieDto[] = zlData.map(z => {
      const oddzialNazwa = z.oddzial_id ? oddzialMap.get(z.oddzial_id) || '' : '';
      const oddzialKod = NAZWA_TO_KOD[oddzialNazwa] || '';
      const kursInfo = z.kurs_id ? kursMap.get(z.kurs_id) : null;
      const flotaInfo = kursInfo?.flota_id ? flotaMap.get(kursInfo.flota_id) : null;
      const flotaZewInfo = kursInfo?.nr_rej_zewn ? flotaZewMap.get(kursInfo.nr_rej_zewn) : null;
      const wzInfo = wzMap.get(z.id);

      return {
        id: z.id,
        numer: z.numer,
        status: z.status,
        dzien: z.dzien,
        typ_pojazdu: z.typ_pojazdu,
        preferowana_godzina: z.preferowana_godzina,
        oddzial_kod: oddzialKod,
        oddzial_nazwa: oddzialNazwa,
        kurs_id: z.kurs_id,
        kurs_numer: kursInfo?.numer || null,
        kurs_nr_rej: flotaInfo?.nr_rej || kursInfo?.nr_rej_zewn || null,
        kurs_pojazd_typ: flotaInfo?.typ || flotaZewInfo?.typ || null,
        odbiorca: wzInfo?.odbiorca || null,
        adres: wzInfo?.adres || null,
        suma_kg: wzInfo?.suma_kg || 0,
        suma_m3: wzInfo?.suma_m3 || 0,
        suma_palet: wzInfo?.suma_palet || 0,
        lat: null,
        lng: null,
      };
    });

    setZlecenia(result);
    setLoading(false);

    // 8. Geocoding w tle — sekwencyjnie
    const toGeocode = result.filter(z => z.adres && z.adres.trim().length >= 5);
    for (const z of toGeocode) {
      const coords = await geocodeAddress(z.adres!);
      if (coords) {
        setZlecenia(prev => prev.map(zl => zl.id === z.id ? { ...zl, lat: coords.lat, lng: coords.lng } : zl));
      }
    }
  }, [dzien]);

  useEffect(() => { refetch(); }, [refetch]);

  // Realtime — odśwież gdy zmienią się zlecenia lub kursy
  useEffect(() => {
    const channel = supabase
      .channel(`mapa-zlecen-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zlecenia' }, () => refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kursy' }, () => refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zlecenia_wz' }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  return { zlecenia, loading, refetch };
}
