import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ZlecenieOddzialuDto {
  id: string;
  numer: string;
  status: string;
  dzien: string;
  typ_pojazdu: string | null;
  preferowana_godzina: string | null;
  kurs_numer: string | null;
  suma_kg: number;
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

export function useZleceniaOddzialu(oddzialId: number | null, pastOnly = false) {
  const [zlecenia, setZlecenia] = useState<ZlecenieOddzialuDto[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setZlecenia([]); return; }
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];
    let query = supabase
      .from('zlecenia')
      .select('id, numer, status, dzien, typ_pojazdu, preferowana_godzina, kurs_id')
      .eq('oddzial_id', oddzialId)
      .order('created_at', { ascending: false });

    if (pastOnly) {
      query = query.lt('dzien', today);
    }

    const { data: zlData } = await query;

    // Get kurs numery
    const kursIds = (zlData || []).map(z => z.kurs_id).filter(Boolean) as string[];
    let kursMap = new Map<string, string>();
    if (kursIds.length > 0) {
      const { data: kData } = await supabase
        .from('kursy')
        .select('id, numer')
        .in('id', kursIds);
      (kData || []).forEach(k => kursMap.set(k.id, (k as any).numer || k.id.slice(0, 8)));
    }

    // Get WZ sums
    const ids = (zlData || []).map(z => z.id);
    let wzMap = new Map<string, number>();
    if (ids.length > 0) {
      const { data: wzData } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, masa_kg')
        .in('zlecenie_id', ids);
      (wzData || []).forEach(w => {
        wzMap.set(w.zlecenie_id, (wzMap.get(w.zlecenie_id) || 0) + Number(w.masa_kg));
      });
    }

    setZlecenia((zlData || []).map(z => ({
      id: z.id,
      numer: z.numer,
      status: z.status,
      dzien: z.dzien,
      typ_pojazdu: z.typ_pojazdu,
      preferowana_godzina: z.preferowana_godzina,
      kurs_numer: z.kurs_id ? (kursMap.get(z.kurs_id) || z.kurs_id.slice(0, 8)) : null,
      suma_kg: wzMap.get(z.id) || 0,
    })));
    setLoading(false);
  }, [oddzialId]);

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
