import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Kierowca {
  id: string;
  imie_nazwisko: string;
  uprawnienia: string;
  tel: string;
  oddzial_id: number | null;
  aktywny: boolean;
}

export function useKierowcyOddzialu(oddzialId: number | null) {
  const [kierowcy, setKierowcy] = useState<Kierowca[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setKierowcy([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from('kierowcy')
      .select('id, imie_nazwisko, uprawnienia, tel, oddzial_id, aktywny')
      .eq('oddzial_id', oddzialId)
      .eq('aktywny', true)
      .order('imie_nazwisko');
    setKierowcy((data || []).map(d => ({
      id: d.id,
      imie_nazwisko: d.imie_nazwisko,
      uprawnienia: d.uprawnienia || '',
      tel: d.tel || '',
      oddzial_id: d.oddzial_id,
      aktywny: d.aktywny,
    })));
    setLoading(false);
  }, [oddzialId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { kierowcy, loading, refetch };
}
