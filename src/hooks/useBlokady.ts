import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Blokada {
  id: string;
  typ: string;
  zasob_id: string;
  dzien: string;
}

export function useBlokady(oddzialId: number | null, businessDays: string[]) {
  const [blokady, setBlokady] = useState<Blokada[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (oddzialId == null || businessDays.length === 0) {
      setBlokady([]);
      return;
    }
    setLoading(true);
    const from = businessDays[0];
    const to = businessDays[businessDays.length - 1];

    const { data } = await supabase
      .from('dostepnosc_blokady')
      .select('id, typ, zasob_id, dzien')
      .gte('dzien', from)
      .lte('dzien', to);

    setBlokady((data as Blokada[]) || []);
    setLoading(false);
  }, [oddzialId, businessDays[0], businessDays[businessDays.length - 1]]);

  useEffect(() => { refetch(); }, [refetch]);

  const toggleBlokada = async (typ: string, zasobId: string, dzien: string) => {
    const existing = blokady.find(b => b.typ === typ && b.zasob_id === zasobId && b.dzien === dzien);
    if (existing) {
      await supabase.from('dostepnosc_blokady').delete().eq('id', existing.id);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('dostepnosc_blokady').insert({
        typ,
        zasob_id: zasobId,
        dzien,
        created_by: user?.id || null,
      });
    }
    await refetch();
  };

  const isBlocked = (typ: string, zasobId: string, dzien: string) =>
    blokady.some(b => b.typ === typ && b.zasob_id === zasobId && b.dzien === dzien);

  return { blokady, loading, toggleBlokada, isBlocked, refetch };
}
