import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calculateDistance } from '@/lib/oddzialy-geo';

export interface ZlecenieOddzialuDto {
  id: string;
  numer: string;
  status: string;
  dzien: string;
  typ_pojazdu: string | null;
  preferowana_godzina: string | null;
  kurs_numer: string | null;
  kurs_nrrej: string | null;
  oddział_nadawcy: string | null;
  odbiorca: string | null;
  adres: string | null;
  suma_kg: number;
  suma_m3: number;
  suma_palet: number;
  dystans_km: number | null;
  deadline_wz: string | null;
  ma_wz: boolean;
  flaga_brak_wz: boolean;
}

export interface WzDto {
  id: string;
  numer_wz: string | null;
  odbiorca: string | null;
  adres: string | null;
  masa_kg: number;
  objetosc_m3: number;
  ilosc_palet: number;
  nr_zamowienia: string | null;
  uwagi: string | null;
}

export function useZleceniaOddzialu(oddzialId: number | null, pastOnly = false, dzien?: string) {
  const [zlecenia, setZlecenia] = useState<ZlecenieOddzialuDto[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setZlecenia([]); return; }
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];
    let query = supabase
      .from('zlecenia')
      .select('id, numer, status, dzien, typ_pojazdu, preferowana_godzina, kurs_id, oddzial_id, deadline_wz, ma_wz, flaga_brak_wz')
      .eq('oddzial_id', oddzialId)
      .order('dzien', { ascending: true })
      .order('created_at', { ascending: true });

    if (dzien) {
      query = query.eq('dzien', dzien);
    } else if (pastOnly) {
      query = query.lt('dzien', today);
    }

    const { data: zlData } = await query;

    // Get kurs info (numer + flota_id)
    const kursIds = (zlData || []).map(z => z.kurs_id).filter(Boolean) as string[];
    let kursMap = new Map<string, { numer: string; flota_id: string | null }>();
    if (kursIds.length > 0) {
      const { data: kData } = await supabase
        .from('kursy')
        .select('id, numer, flota_id')
        .in('id', kursIds);
      (kData || []).forEach(k => kursMap.set(k.id, {
        numer: (k as any).numer || k.id.slice(0, 8),
        flota_id: k.flota_id,
      }));
    }

    // Get flota nr_rej for kursy
    const flotaIds = Array.from(kursMap.values()).map(k => k.flota_id).filter(Boolean) as string[];
    let flotaNrRejMap = new Map<string, string>();
    if (flotaIds.length > 0) {
      const { data: fData } = await supabase
        .from('flota')
        .select('id, nr_rej')
        .in('id', flotaIds);
      (fData || []).forEach(f => flotaNrRejMap.set(f.id, f.nr_rej));
    }

    // Get oddzial names
    const oddzialIds = [...new Set((zlData || []).map(z => z.oddzial_id).filter(Boolean))];
    let oddzialMap = new Map<number, string>();
    if (oddzialIds.length > 0) {
      const { data: oData } = await supabase
        .from('oddzialy')
        .select('id, nazwa')
        .in('id', oddzialIds);
      (oData || []).forEach(o => oddzialMap.set(o.id, o.nazwa));
    }

    // Get WZ sums + first odbiorca
    const ids = (zlData || []).map(z => z.id);
    let wzMap = new Map<string, { suma_kg: number; suma_m3: number; suma_palet: number; odbiorca: string | null; adres: string | null }>();
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

    setZlecenia((zlData || []).map(z => {
      const kursInfo = z.kurs_id ? kursMap.get(z.kurs_id) : null;
      const kursNrRej = kursInfo?.flota_id ? flotaNrRejMap.get(kursInfo.flota_id) : null;
      const wzInfo = wzMap.get(z.id);
      return {
        id: z.id,
        numer: z.numer,
        status: z.status,
        dzien: z.dzien,
        typ_pojazdu: z.typ_pojazdu,
        preferowana_godzina: z.preferowana_godzina,
        kurs_numer: kursInfo?.numer || null,
        kurs_nrrej: kursNrRej || null,
        oddział_nadawcy: z.oddzial_id ? oddzialMap.get(z.oddzial_id) || null : null,
        odbiorca: wzInfo?.odbiorca || null,
        adres: wzInfo?.adres || null,
        suma_kg: wzInfo?.suma_kg || 0,
        suma_m3: wzInfo?.suma_m3 || 0,
        suma_palet: wzInfo?.suma_palet || 0,
        dystans_km: null,
        deadline_wz: (z as any).deadline_wz || null,
        ma_wz: !!(z as any).ma_wz,
        flaga_brak_wz: !!(z as any).flaga_brak_wz,
      };
    }));
    setLoading(false);

    // Oblicz dystans SEKWENCYJNIE w tle (Nominatim limit 1 req/s)
    const oddzialNazwa = oddzialId != null ? oddzialMap.get(oddzialId) || '' : '';
    if (oddzialNazwa) {
      const zlWithAddress = (zlData || []).filter(z => wzMap.get(z.id)?.adres);
      // Uruchom w tle — nie blokuj renderowania, ale sekwencyjnie (nie parallel)
      (async () => {
        for (const z of zlWithAddress) {
          const adres = wzMap.get(z.id)?.adres;
          if (!adres) continue;
          const km = await calculateDistance(oddzialNazwa, adres);
          if (km != null) {
            setZlecenia(prev => prev.map(zl => zl.id === z.id ? { ...zl, dystans_km: km } : zl));
          }
        }
      })();
    }
  }, [oddzialId, pastOnly, dzien]);

  useEffect(() => { refetch(); }, [refetch]);

  return { zlecenia, loading, refetch };
}

export function useZlecenieWz(zlecenieId: string | null) {
  const [wz, setWz] = useState<WzDto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!zlecenieId) { setWz([]); return; }
    setLoading(true);
    supabase
      .from('zlecenia_wz')
      .select('id, numer_wz, odbiorca, adres, masa_kg, objetosc_m3, ilosc_palet, nr_zamowienia, uwagi')
      .eq('zlecenie_id', zlecenieId)
      .then(({ data }) => {
        setWz((data || []).map(w => ({
          id: w.id,
          numer_wz: w.numer_wz,
          odbiorca: w.odbiorca,
          adres: w.adres,
          masa_kg: Number(w.masa_kg),
          objetosc_m3: Number(w.objetosc_m3),
          ilosc_palet: Number(w.ilosc_palet || 0),
          nr_zamowienia: w.nr_zamowienia,
          uwagi: w.uwagi,
        })));
        setLoading(false);
      });
  }, [zlecenieId]);

  return { wz, loading };
}
