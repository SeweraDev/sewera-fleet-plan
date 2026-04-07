import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ZlecenieBezKursuDto {
  id: string;
  numer: string;
  dzien: string;
  preferowana_godzina: string | null;
  typ_pojazdu: string | null;
  suma_kg: number;
  suma_m3: number;
  suma_palet: number;
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
      .select('id, numer, dzien, preferowana_godzina, typ_pojazdu, status, kurs_id')
      .eq('oddzial_id', oddzialId)
      .in('status', ['robocza', 'do_weryfikacji'])
      .is('kurs_id', null)
      .gte('dzien', today);

    // Get those that already have kurs_przystanki in active kursy (not usuniety)
    const { data: activeKursy } = await supabase
      .from('kursy')
      .select('id')
      .neq('status', 'usuniety');
    const activeKursIds = (activeKursy || []).map(k => k.id);

    let assigned = new Set<string>();
    if (activeKursIds.length > 0) {
      const { data: przData } = await supabase
        .from('kurs_przystanki')
        .select('zlecenie_id')
        .in('kurs_id', activeKursIds);
      assigned = new Set((przData || []).map(p => p.zlecenie_id));
    }

    const unassigned = (zlData || []).filter(z => !assigned.has(z.id));

    // Get WZ sums (kg, m³, palety)
    const ids = unassigned.map(z => z.id);
    let wzMap = new Map<string, { kg: number; m3: number; palet: number }>();
    if (ids.length > 0) {
      const { data: wzData } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, masa_kg, objetosc_m3, ilosc_palet')
        .in('zlecenie_id', ids);
      (wzData || []).forEach(w => {
        const prev = wzMap.get(w.zlecenie_id) || { kg: 0, m3: 0, palet: 0 };
        prev.kg += Number(w.masa_kg) || 0;
        prev.m3 += Number(w.objetosc_m3) || 0;
        prev.palet += Number(w.ilosc_palet) || 0;
        wzMap.set(w.zlecenie_id, prev);
      });
    }

    setZlecenia(unassigned.map(z => {
      const wz = wzMap.get(z.id) || { kg: 0, m3: 0, palet: 0 };
      return {
        id: z.id,
        numer: z.numer,
        dzien: z.dzien,
        preferowana_godzina: z.preferowana_godzina,
        typ_pojazdu: z.typ_pojazdu,
        suma_kg: wz.kg,
        suma_m3: wz.m3,
        suma_palet: wz.palet,
        status: z.status,
      };
    }));
    setLoading(false);
  }, [oddzialId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { zlecenia, loading, refetch };
}
