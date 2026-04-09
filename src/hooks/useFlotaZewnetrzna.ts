import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PojazdZewnetrzny {
  id: string;
  nr_rej: string;
  typ: string;
  ladownosc_kg: number | null;
  max_palet: number | null;
  objetosc_m3: number | null;
  firma: string;
  kierowca: string | null;
  tel: string | null;
  oddzial_id: number | null;
  aktywny: boolean;
}

// KAT i R współdzielą flotę zewnętrzną
async function getSharedIds(oddzialId: number): Promise<number[]> {
  const { data } = await supabase
    .from('oddzialy')
    .select('id, nazwa')
    .in('nazwa', ['Katowice', 'Redystrybucja']);
  if (!data || data.length < 2) return [oddzialId];
  const katR = data.map(d => d.id);
  if (katR.includes(oddzialId)) return katR;
  return [oddzialId];
}

export function useFlotaZewnetrzna(oddzialId: number | null) {
  const [flota, setFlota] = useState<PojazdZewnetrzny[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!oddzialId) { setFlota([]); setLoading(false); return; }
    setLoading(true);
    const ids = await getSharedIds(oddzialId);
    const { data } = await supabase
      .from('flota_zewnetrzna')
      .select('id, nr_rej, typ, ladownosc_kg, max_palet, objetosc_m3, firma, kierowca, tel, oddzial_id, aktywny')
      .in('oddzial_id', ids)
      .eq('aktywny', true)
      .order('nr_rej');
    setFlota((data as PojazdZewnetrzny[]) || []);
    setLoading(false);
  }, [oddzialId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { flota, loading, refetch: fetch };
}
