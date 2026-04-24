import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAddress, getKmProstaFromOddzial } from '@/lib/oddzialy-geo';

export interface OdcinekTechniczny {
  id: string;
  opis: string;
  km: number;
}

export interface KursDto {
  id: string;
  numer: string | null;
  status: string;
  ts_wyjazd: string | null;
  ts_powrot: string | null;
  nr_rej_zewn: string | null;
  kierowca_nazwa: string | null;
  kierowca_id: string | null;
  nr_rej: string;
  pojazd_typ: string;
  ladownosc_kg: number;
  objetosc_m3: number | null;
  max_palet: number | null;
  kierowca_tel: string | null;
  godzina_start: string | null;
  /** Override km kółka (z drogomierza) — jeśli null, używamy km OSRM */
  km_rozliczeniowe: number | null;
  /** Odcinki techniczne (serwis, tankowanie) — dodatkowe km bez punktu rozliczeniowego */
  odcinki_techniczne: OdcinekTechniczny[];
}

export interface PrzystanekDto {
  id: string;
  kurs_id: string;
  kolejnosc: number;
  prz_status: string;
  zlecenie_id: string | null;
  zl_numer: string;
  odbiorca: string;
  adres: string;
  masa_kg: number;
  objetosc_m3: number;
  ilosc_palet: number;
  numer_wz: string;
  nr_zamowienia: string;
  tel: string;
  uwagi: string;
  preferowana_godzina: string;
  km_prosta: number | null; // linia prosta od oddziału do adresu (Haversine)
  klasyfikacja: string | null; // klasyfikacja rozliczeniowa WZ (A/B/C/D/E/F/H)
  wartosc_netto: number | null; // wartość netto dokumentu (do rozdziału kosztów)
}

export function useKursyDnia(oddzialId: number | null, dzien: string, dzienDo?: string) {
  const [kursy, setKursy] = useState<KursDto[]>([]);
  const [przystanki, setPrzystanki] = useState<PrzystanekDto[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setKursy([]); setPrzystanki([]); setLoading(false); return; }
    setLoading(true);

    let query = supabase
      .from('kursy')
      .select('id, numer, status, godzina_start, nr_rej_zewn, kierowca_nazwa, kierowca_id, ts_wyjazd, ts_powrot, flota_id, km_rozliczeniowe')
      .eq('oddzial_id', oddzialId);

    if (dzienDo && dzienDo !== dzien) {
      query = query.gte('dzien', dzien).lte('dzien', dzienDo);
    } else {
      query = query.eq('dzien', dzien);
    }

    const { data: kursyData } = await query;

    // Get flota info for vehicles
    const flotaIds = (kursyData || []).map(k => (k as any).flota_id).filter(Boolean);
    let flotaMap = new Map<string, { nr_rej: string; typ: string; ladownosc_kg: number; objetosc_m3: number | null; max_palet: number | null }>();
    if (flotaIds.length > 0) {
      const { data: flotaData } = await supabase
        .from('flota')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
        .in('id', flotaIds);
      (flotaData || []).forEach(f => flotaMap.set(f.id, { nr_rej: f.nr_rej, typ: f.typ, ladownosc_kg: Number(f.ladownosc_kg), objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null, max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null }));
    }

    // Get flota_zewnetrzna info for external vehicles
    const zewNrRej = (kursyData || []).filter(k => !(k as any).flota_id && k.nr_rej_zewn).map(k => k.nr_rej_zewn!);
    let flotaZewMap = new Map<string, { typ: string; ladownosc_kg: number; objetosc_m3: number | null; max_palet: number | null }>();
    if (zewNrRej.length > 0) {
      const { data: zewData } = await supabase
        .from('flota_zewnetrzna')
        .select('nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
        .in('nr_rej', zewNrRej);
      (zewData || []).forEach(f => flotaZewMap.set(f.nr_rej, {
        typ: f.typ,
        ladownosc_kg: Number(f.ladownosc_kg),
        objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
        max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
      }));
    }

    // Fetch kierowcy phone numbers
    const kierowcaIds = (kursyData || []).map(k => k.kierowca_id).filter(Boolean) as string[];
    let kierowcaMap = new Map<string, { tel: string | null }>();
    if (kierowcaIds.length > 0) {
      const { data: kierowcyData } = await supabase
        .from('kierowcy')
        .select('id, tel')
        .in('id', kierowcaIds);
      (kierowcyData || []).forEach(k => kierowcaMap.set(k.id, { tel: k.tel }));
    }

    // Odcinki techniczne per kurs (serwis, tankowanie itp.)
    const kursyIdList = (kursyData || []).map(k => k.id);
    const odcinkiMap = new Map<string, OdcinekTechniczny[]>();
    if (kursyIdList.length > 0) {
      const { data: odcinkiData } = await supabase
        .from('kurs_odcinki_techniczne')
        .select('id, kurs_id, opis, km')
        .in('kurs_id', kursyIdList)
        .order('created_at');
      (odcinkiData || []).forEach((o: any) => {
        const list = odcinkiMap.get(o.kurs_id) || [];
        list.push({ id: o.id, opis: o.opis, km: Number(o.km) });
        odcinkiMap.set(o.kurs_id, list);
      });
    }

    const mapped: KursDto[] = (kursyData || []).map(k => {
      const f = flotaMap.get((k as any).flota_id || '');
      const fz = k.nr_rej_zewn ? flotaZewMap.get(k.nr_rej_zewn) : null;
      const kier = k.kierowca_id ? kierowcaMap.get(k.kierowca_id) : null;
      return {
        id: k.id,
        numer: (k as any).numer,
        status: k.status,
        ts_wyjazd: (k as any).ts_wyjazd,
        ts_powrot: (k as any).ts_powrot,
        nr_rej_zewn: k.nr_rej_zewn,
        kierowca_nazwa: k.kierowca_nazwa,
        kierowca_id: k.kierowca_id,
        nr_rej: f?.nr_rej || k.nr_rej_zewn || '',
        pojazd_typ: f?.typ || fz?.typ || '',
        ladownosc_kg: f?.ladownosc_kg || fz?.ladownosc_kg || 0,
        objetosc_m3: f?.objetosc_m3 ?? fz?.objetosc_m3 ?? null,
        max_palet: f?.max_palet ?? fz?.max_palet ?? null,
        kierowca_tel: kier?.tel ?? null,
        godzina_start: (k as any).godzina_start || null,
        km_rozliczeniowe: (k as any).km_rozliczeniowe != null ? Number((k as any).km_rozliczeniowe) : null,
        odcinki_techniczne: odcinkiMap.get(k.id) || [],
      };
    });
    setKursy(mapped);

    // Fetch przystanki
    const kursIds = mapped.map(k => k.id);
    if (kursIds.length > 0) {
      const { data: przData } = await supabase
        .from('kurs_przystanki')
        .select('id, kurs_id, kolejnosc, status, zlecenie_id')
        .in('kurs_id', kursIds)
        .order('kolejnosc');

      const zlecenieIds = (przData || []).map(p => p.zlecenie_id).filter(Boolean) as string[];
      const zlecMap = new Map<string, { numer: string; preferowana_godzina: string | null }>();
      const wzListMap = new Map<string, any[]>();

      if (zlecenieIds.length > 0) {
        const { data: zlData } = await supabase
          .from('zlecenia')
          .select('id, numer, preferowana_godzina')
          .in('id', zlecenieIds);
        (zlData || []).forEach(z => zlecMap.set(z.id, { numer: z.numer, preferowana_godzina: z.preferowana_godzina }));

        const { data: wzData } = await supabase
          .from('zlecenia_wz')
          .select('zlecenie_id, odbiorca, adres, masa_kg, objetosc_m3, ilosc_palet, numer_wz, nr_zamowienia, tel, uwagi, klasyfikacja, wartosc_netto')
          .in('zlecenie_id', zlecenieIds);
        (wzData || []).forEach(w => {
          const list = wzListMap.get(w.zlecenie_id) || [];
          list.push(w);
          wzListMap.set(w.zlecenie_id, list);
        });
      }

      // Rozwiń przystanki: jeden wiersz per WZ (nie per zlecenie)
      const expandedPrz: PrzystanekDto[] = [];
      (przData || []).forEach(p => {
        const zl = zlecMap.get(p.zlecenie_id || '');
        const wzList = wzListMap.get(p.zlecenie_id || '') || [];
        if (wzList.length === 0) {
          // Brak WZ — pokaż pusty wiersz
          expandedPrz.push({
            id: p.id, kurs_id: p.kurs_id, kolejnosc: p.kolejnosc, prz_status: p.status,
            zlecenie_id: p.zlecenie_id, zl_numer: zl?.numer || '',
            odbiorca: '', adres: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0,
            numer_wz: '', nr_zamowienia: '', tel: '', uwagi: '', preferowana_godzina: zl?.preferowana_godzina || '',
            km_prosta: null,
            klasyfikacja: null,
            wartosc_netto: null,
          });
        } else {
          wzList.forEach((w, i) => {
            const wAny = w as any;
            expandedPrz.push({
              id: `${p.id}_wz${i}`, kurs_id: p.kurs_id, kolejnosc: p.kolejnosc,
              prz_status: p.status, zlecenie_id: p.zlecenie_id, zl_numer: zl?.numer || '',
              odbiorca: wAny.odbiorca || '', adres: wAny.adres || '',
              masa_kg: Number(w.masa_kg) || 0, objetosc_m3: Number(w.objetosc_m3) || 0,
              ilosc_palet: Number(wAny.ilosc_palet) || 0, numer_wz: wAny.numer_wz || '',
              nr_zamowienia: wAny.nr_zamowienia || '', tel: wAny.tel || '', uwagi: wAny.uwagi || '',
              preferowana_godzina: zl?.preferowana_godzina || '',
              km_prosta: null,
              klasyfikacja: wAny.klasyfikacja || null,
              wartosc_netto: wAny.wartosc_netto != null ? Number(wAny.wartosc_netto) : null,
            });
          });
        }
      });
      // Sortuj przystanki wg godziny dostawy (rosnąco) wewnątrz każdego kursu.
      // Parser obsługuje sloty ("do 8:00"), konkretne godziny ("08:00", "7:30"), "dowolna" / pusto.
      const parseGodzinaMin = (g: string | null | undefined): number => {
        if (!g) return 9999;
        const s = g.trim().toLowerCase();
        if (s === 'dowolna' || s === '') return 9999;
        const m = s.match(/(\d{1,2})[:.](\d{2})/);
        if (!m) return 9999;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      };
      expandedPrz.sort((a, b) => {
        if (a.kurs_id !== b.kurs_id) return 0; // nie mieszaj kursów
        const am = parseGodzinaMin(a.preferowana_godzina);
        const bm = parseGodzinaMin(b.preferowana_godzina);
        if (am !== bm) return am - bm;
        // W obrębie tej samej godziny: grupuj WZ tego samego przystanku razem
        return a.kolejnosc - b.kolejnosc;
      });
      setPrzystanki(expandedPrz);

      // Wylicz linię prostą od oddziału do adresu w tle (Photon 1 req/adres, jest cache).
      // Najpierw pobierz nazwę oddziału dla getKmProstaFromOddzial.
      (async () => {
        const { data: odzData } = await supabase
          .from('oddzialy')
          .select('nazwa')
          .eq('id', oddzialId)
          .maybeSingle();
        const oddzialNazwa = (odzData as any)?.nazwa;
        if (!oddzialNazwa) return;

        const uniqueAddresses = Array.from(
          new Set(expandedPrz.map(p => p.adres).filter(a => a && a.length > 4))
        );
        const coordsByAdres = new Map<string, { lat: number; lng: number } | null>();
        for (const adres of uniqueAddresses) {
          const c = await geocodeAddress(adres);
          coordsByAdres.set(adres, c);
        }
        setPrzystanki(prev => prev.map(p => {
          if (!p.adres || p.km_prosta != null) return p;
          const c = coordsByAdres.get(p.adres);
          if (!c) return p;
          const km = getKmProstaFromOddzial(oddzialNazwa, c.lat, c.lng);
          return km != null ? { ...p, km_prosta: km } : p;
        }));
      })();
    } else {
      setPrzystanki([]);
    }

    setLoading(false);
  }, [oddzialId, dzien, dzienDo]);

  useEffect(() => {
    refetch();
    const channel = supabase
      .channel(`dyspozytor-kursy-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kursy' }, () => refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kurs_przystanki' }, () => refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kurs_odcinki_techniczne' }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  return { kursy, przystanki, loading, refetch };
}
