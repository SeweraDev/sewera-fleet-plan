import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ZlecenieBezKursuDto {
  id: string;
  numer: string;
  dzien: string;
  preferowana_godzina: string | null;
  typ_pojazdu: string | null;
  suma_kg: number;
  status: string;
}

export function useZleceniaBezKursu(oddzialId: number | null) {
  const [zlecenia, setZlecenia] = useState<ZlecenieBezKursuDto[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setZlecenia([]); return; }
    setLoading(true);

    // Get zlecenia robocze for this oddzial
    const today = new Date().toISOString().split('T')[0];
    const { data: zlData } = await supabase
      .from('zlecenia')
      .select('id, numer, dzien, preferowana_godzina, typ_pojazdu, status')
      .eq('oddzial_id', oddzialId)
      .in('status', ['robocza', 'do_weryfikacji'])
      .gte('dzien', today);

    // Get those that already have kurs_przystanki
    const { data: przData } = await supabase
      .from('kurs_przystanki')
      .select('zlecenie_id');
    const assigned = new Set((przData || []).map(p => p.zlecenie_id));

    const unassigned = (zlData || []).filter(z => !assigned.has(z.id));

    // Get WZ sums
    const ids = unassigned.map(z => z.id);
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

    setZlecenia(unassigned.map(z => ({
      id: z.id,
      numer: z.numer,
      dzien: z.dzien,
      preferowana_godzina: z.preferowana_godzina,
      typ_pojazdu: z.typ_pojazdu,
      suma_kg: wzMap.get(z.id) || 0,
      status: z.status,
    })));
    setLoading(false);
  }, [oddzialId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { zlecenia, loading, refetch };
}
