import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface KierowcaStatusDto {
  id: string;
  imie_nazwisko: string;
  uprawnienia: string;
  tel: string;
  kurs_numer: string | null;
  kurs_status: string | null;
}

export function useKierowcyStatusDnia(oddzialId: number | null) {
  const [kierowcy, setKierowcy] = useState<KierowcaStatusDto[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setKierowcy([]); return; }
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];

    const { data: kiData } = await supabase
      .from('kierowcy')
      .select('id, imie_nazwisko, uprawnienia, tel')
      .eq('oddzial_id', oddzialId)
      .eq('aktywny', true)
      .order('imie_nazwisko');

    const ids = (kiData || []).map(k => k.id);
    let kursMap = new Map<string, { numer: string | null; status: string }>();

    if (ids.length > 0) {
      const { data: kursyData } = await supabase
        .from('kursy')
        .select('kierowca_id, numer, status')
        .in('kierowca_id', ids)
        .eq('dzien', today);
      (kursyData || []).forEach(k => {
        if (k.kierowca_id) {
          kursMap.set(k.kierowca_id, { numer: k.numer, status: k.status });
        }
      });
    }

    setKierowcy((kiData || []).map(k => {
      const kurs = kursMap.get(k.id);
      return {
        id: k.id,
        imie_nazwisko: k.imie_nazwisko,
        uprawnienia: k.uprawnienia || '',
        tel: k.tel || '',
        kurs_numer: kurs?.numer || null,
        kurs_status: kurs?.status || null,
      };
    }));
    setLoading(false);
  }, [oddzialId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { kierowcy, loading, refetch };
}
