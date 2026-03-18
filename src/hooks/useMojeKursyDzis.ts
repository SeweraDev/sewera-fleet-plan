import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface KursKierowcy {
  id: string;
  numer: string | null;
  status: string;
  ts_wyjazd: string | null;
  ts_powrot: string | null;
  nr_rej: string;
  pojazd_typ: string;
  ladownosc_kg: number;
  oddzial_id: number | null;
  typ_pojazdu: string | null;
  przystanki: PrzystanekKierowcy[];
}

export interface PrzystanekKierowcy {
  id: string;
  kolejnosc: number;
  status: string;
  odbiorca: string;
  adres: string;
  tel: string;
  masa_kg: number;
  nr_wz: string;
  uwagi: string;
  ilosc_palet: number;
}

export function useMojeKursyDzis() {
  const { user } = useAuth();
  const [kursy, setKursy] = useState<KursKierowcy[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) return;

    // Find this user's kierowca record
    const { data: kierowcaData } = await supabase
      .from('kierowcy')
      .select('id')
      .eq('user_id', user.id);

    if (!kierowcaData?.length) {
      setKursy([]);
      setLoading(false);
      return;
    }

    const kierowcaId = kierowcaData[0].id;
    const today = new Date().toISOString().split('T')[0];

    const { data: kursyData } = await supabase
      .from('kursy')
      .select('id, numer, status, ts_wyjazd, ts_powrot, nr_rej_zewn, flota_id, oddzial_id')
      .eq('kierowca_id', kierowcaId)
      .eq('dzien', today);

    if (!kursyData?.length) {
      setKursy([]);
      setLoading(false);
      return;
    }

    // Get flota info
    const flotaIds = kursyData.map(k => (k as any).flota_id).filter(Boolean);
    let flotaMap = new Map<string, { nr_rej: string; typ: string; ladownosc_kg: number }>();
    if (flotaIds.length > 0) {
      const { data: flotaData } = await supabase.from('flota').select('id, nr_rej, typ, ladownosc_kg').in('id', flotaIds);
      (flotaData || []).forEach(f => flotaMap.set(f.id, { nr_rej: f.nr_rej, typ: f.typ, ladownosc_kg: Number(f.ladownosc_kg) }));
    }

    // Get przystanki
    const kursIds = kursyData.map(k => k.id);
    const { data: przData } = await supabase
      .from('kurs_przystanki')
      .select('id, kurs_id, kolejnosc, status, zlecenie_id')
      .in('kurs_id', kursIds)
      .order('kolejnosc');

    // Get WZ data
    const zlecenieIds = (przData || []).map(p => p.zlecenie_id).filter(Boolean) as string[];
    let wzMap = new Map<string, { odbiorca: string; adres: string; tel: string; masa_kg: number; nr_wz: string; uwagi: string; ilosc_palet: number }>();
    if (zlecenieIds.length > 0) {
      const { data: wzData } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, odbiorca, adres, tel, masa_kg, numer_wz, uwagi, ilosc_palet')
        .in('zlecenie_id', zlecenieIds);
      (wzData || []).forEach(w => {
        wzMap.set(w.zlecenie_id, {
          odbiorca: (w as any).odbiorca || '',
          adres: (w as any).adres || '',
          tel: (w as any).tel || '',
          masa_kg: Number(w.masa_kg),
          nr_wz: w.numer_wz || '',
          uwagi: (w as any).uwagi || '',
          ilosc_palet: Number((w as any).ilosc_palet || 0),
        });
      });
    }

    setKursy(kursyData.map(k => {
      const f = flotaMap.get((k as any).flota_id || '');
      const kPrz = (przData || []).filter(p => p.kurs_id === k.id);
      return {
        id: k.id,
        numer: (k as any).numer,
        status: k.status,
        ts_wyjazd: (k as any).ts_wyjazd,
        ts_powrot: (k as any).ts_powrot,
        nr_rej: f?.nr_rej || k.nr_rej_zewn || '',
        pojazd_typ: f?.typ || '',
        ladownosc_kg: f?.ladownosc_kg || 0,
        przystanki: kPrz.map(p => {
          const wz = wzMap.get(p.zlecenie_id || '');
          return {
            id: p.id,
            kolejnosc: p.kolejnosc,
            status: p.status,
            odbiorca: wz?.odbiorca || '',
            adres: wz?.adres || '',
            tel: wz?.tel || '',
            masa_kg: wz?.masa_kg || 0,
            nr_wz: wz?.nr_wz || '',
            uwagi: wz?.uwagi || '',
            ilosc_palet: wz?.ilosc_palet || 0,
          };
        }),
      };
    }));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refetch();
    const channel = supabase
      .channel('kierowca-kursy')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kursy' }, () => refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kurs_przystanki' }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  return { kursy, loading, refetch };
}
