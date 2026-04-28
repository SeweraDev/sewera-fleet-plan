import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface MojeZlecenieWz {
  id: string;
  numer_wz: string | null;
  odbiorca: string | null;
  adres: string | null;
  archiwum_path: string | null;
}

export interface MojeZlecenie {
  id: string;
  numer: string;
  status: string;
  dzien: string;
  preferowana_godzina: string | null;
  typ_pojazdu: string | null;
  oddzial: string;
  liczba_wz: number;
  suma_kg: number;
  suma_palet: number;
  deadline_wz: string | null;
  ma_wz: boolean;
  flaga_brak_wz: boolean;
  wz_lista: MojeZlecenieWz[];
}

export function useMojeZlecenia(statusFilter: string = 'wszystkie') {
  const { user } = useAuth();
  const [zlecenia, setZlecenia] = useState<MojeZlecenie[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from('zlecenia')
      .select(`
        id, numer, status, dzien, preferowana_godzina, typ_pojazdu,
        deadline_wz, ma_wz, flaga_brak_wz,
        oddzialy(nazwa)
      `)
      .eq('nadawca_id', user.id)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'wszystkie') {
      query = query.eq('status', statusFilter);
    }

    const { data: zleceniaData } = await query;

    // Get WZ list (z archiwum_path do podgladu) — dociagamy wszystkie pola potrzebne do listy
    const ids = (zleceniaData || []).map(z => z.id);
    let wzRows: { zlecenie_id: string; id: string; numer_wz: string | null; odbiorca: string | null; adres: string | null; archiwum_path: string | null; masa_kg: number; ilosc_palet: number }[] = [];
    if (ids.length > 0) {
      const { data } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, id, numer_wz, odbiorca, adres, archiwum_path, masa_kg, ilosc_palet')
        .in('zlecenie_id', ids);
      wzRows = (data || []).map(d => ({
        zlecenie_id: d.zlecenie_id,
        id: d.id,
        numer_wz: d.numer_wz,
        odbiorca: d.odbiorca,
        adres: d.adres,
        archiwum_path: (d as any).archiwum_path || null,
        masa_kg: Number(d.masa_kg),
        ilosc_palet: Number((d as any).ilosc_palet || 0),
      }));
    }

    const wzMap = new Map<string, { count: number; kg: number; palet: number; lista: MojeZlecenieWz[] }>();
    wzRows.forEach(wz => {
      const cur = wzMap.get(wz.zlecenie_id) || { count: 0, kg: 0, palet: 0, lista: [] };
      cur.count += 1;
      cur.kg += wz.masa_kg;
      cur.palet += wz.ilosc_palet;
      cur.lista.push({ id: wz.id, numer_wz: wz.numer_wz, odbiorca: wz.odbiorca, adres: wz.adres, archiwum_path: wz.archiwum_path });
      wzMap.set(wz.zlecenie_id, cur);
    });

    setZlecenia((zleceniaData || []).map(z => ({
      id: z.id,
      numer: z.numer,
      status: z.status,
      dzien: z.dzien,
      preferowana_godzina: z.preferowana_godzina,
      typ_pojazdu: z.typ_pojazdu,
      oddzial: (z.oddzialy as any)?.nazwa || '',
      liczba_wz: wzMap.get(z.id)?.count || 0,
      suma_kg: wzMap.get(z.id)?.kg || 0,
      suma_palet: wzMap.get(z.id)?.palet || 0,
      deadline_wz: (z as any).deadline_wz || null,
      ma_wz: !!(z as any).ma_wz,
      flaga_brak_wz: !!(z as any).flaga_brak_wz,
      wz_lista: wzMap.get(z.id)?.lista || [],
    })));
    setLoading(false);
  }, [user, statusFilter]);

  useEffect(() => { refetch(); }, [refetch]);

  return { zlecenia, loading, refetch };
}
