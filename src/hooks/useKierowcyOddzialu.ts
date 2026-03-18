import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Kierowca {
  id: string;
  imie_nazwisko: string;
  uprawnienia: string;
  tel: string;
}

export function useKierowcyOddzialu(oddzialId: number | null) {
  const [kierowcy, setKierowcy] = useState<Kierowca[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (oddzialId == null) { setKierowcy([]); return; }
    setLoading(true);
    const fetch = async () => {
      const { data } = await supabase
        .from('kierowcy')
        .select('id, imie_nazwisko, uprawnienia, tel')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true)
        .order('imie_nazwisko');
      setKierowcy((data || []).map(d => ({
        id: d.id,
        imie_nazwisko: d.imie_nazwisko,
        uprawnienia: d.uprawnienia || '',
        tel: d.tel || '',
      })));
      setLoading(false);
    };
    fetch();
  }, [oddzialId]);

  return { kierowcy, loading };
}
