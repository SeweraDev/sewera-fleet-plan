import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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
        oddzialy(nazwa)
      `)
      .eq('nadawca_id', user.id)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'wszystkie') {
      query = query.eq('status', statusFilter);
    }

    const { data: zleceniaData } = await query;

    // Get WZ counts
    const ids = (zleceniaData || []).map(z => z.id);
    let wzData: { zlecenie_id: string; masa_kg: number }[] = [];
    if (ids.length > 0) {
      const { data } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, masa_kg')
        .in('zlecenie_id', ids);
      wzData = data || [];
    }

    const wzMap = new Map<string, { count: number; kg: number }>();
    wzData.forEach(wz => {
      const cur = wzMap.get(wz.zlecenie_id) || { count: 0, kg: 0 };
      wzMap.set(wz.zlecenie_id, { count: cur.count + 1, kg: cur.kg + Number(wz.masa_kg) });
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
    })));
    setLoading(false);
  }, [user, statusFilter]);

  useEffect(() => { refetch(); }, [refetch]);

  return { zlecenia, loading, refetch };
}
