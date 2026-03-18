import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
}

export function useKursyDnia(oddzialId: number | null, dzien: string) {
  const [kursy, setKursy] = useState<KursDto[]>([]);
  const [przystanki, setPrzystanki] = useState<PrzystanekDto[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setKursy([]); setPrzystanki([]); setLoading(false); return; }
    setLoading(true);

    const { data: kursyData } = await supabase
      .from('kursy')
      .select('id, numer, status, godzina_start, nr_rej_zewn, kierowca_nazwa, kierowca_id, ts_wyjazd, ts_powrot, flota_id')
      .eq('oddzial_id', oddzialId)
      .eq('dzien', dzien);

    // Get flota info for vehicles
    const flotaIds = (kursyData || []).map(k => (k as any).flota_id).filter(Boolean);
    let flotaMap = new Map<string, { nr_rej: string; typ: string; ladownosc_kg: number; objetosc_m3: number | null }>();
    if (flotaIds.length > 0) {
      const { data: flotaData } = await supabase
        .from('flota')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3')
        .in('id', flotaIds);
      (flotaData || []).forEach(f => flotaMap.set(f.id, { nr_rej: f.nr_rej, typ: f.typ, ladownosc_kg: Number(f.ladownosc_kg), objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null }));
    }

    const mapped: KursDto[] = (kursyData || []).map(k => {
      const f = flotaMap.get((k as any).flota_id || '');
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
        pojazd_typ: f?.typ || '',
        ladownosc_kg: f?.ladownosc_kg || 0,
        objetosc_m3: f?.objetosc_m3 ?? null,
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
      let zlecMap = new Map<string, { numer: string }>();
      let wzMap = new Map<string, { odbiorca: string; adres: string; masa_kg: number; objetosc_m3: number; ilosc_palet: number }>();

      if (zlecenieIds.length > 0) {
        const { data: zlData } = await supabase
          .from('zlecenia')
          .select('id, numer')
          .in('id', zlecenieIds);
        (zlData || []).forEach(z => zlecMap.set(z.id, { numer: z.numer }));

        const { data: wzData } = await supabase
          .from('zlecenia_wz')
          .select('zlecenie_id, odbiorca, adres, masa_kg, objetosc_m3, ilosc_palet')
          .in('zlecenie_id', zlecenieIds);
        (wzData || []).forEach(w => {
          const cur = wzMap.get(w.zlecenie_id) || { odbiorca: '', adres: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0 };
          wzMap.set(w.zlecenie_id, {
            odbiorca: (w as any).odbiorca || cur.odbiorca,
            adres: (w as any).adres || cur.adres,
            masa_kg: cur.masa_kg + Number(w.masa_kg),
            objetosc_m3: cur.objetosc_m3 + Number(w.objetosc_m3),
            ilosc_palet: cur.ilosc_palet + Number((w as any).ilosc_palet || 0),
          });
        });
      }

      setPrzystanki((przData || []).map(p => {
        const zl = zlecMap.get(p.zlecenie_id || '');
        const wz = wzMap.get(p.zlecenie_id || '');
        return {
          id: p.id,
          kurs_id: p.kurs_id,
          kolejnosc: p.kolejnosc,
          prz_status: p.status,
          zlecenie_id: p.zlecenie_id,
          zl_numer: zl?.numer || '',
          odbiorca: wz?.odbiorca || '',
          adres: wz?.adres || '',
          masa_kg: wz?.masa_kg || 0,
          objetosc_m3: wz?.objetosc_m3 || 0,
        };
      }));
    } else {
      setPrzystanki([]);
    }

    setLoading(false);
  }, [oddzialId, dzien]);

  useEffect(() => {
    refetch();
    const channel = supabase
      .channel('dyspozytor-kursy')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kursy' }, () => refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kurs_przystanki' }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  return { kursy, przystanki, loading, refetch };
}
