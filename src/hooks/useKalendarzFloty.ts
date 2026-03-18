import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface KursKalendarzDto {
  dzien: string;
  numer: string | null;
  status: string;
  flota_id: string | null;
  kierowca_id: string | null;
}

/** Returns next N business days (Mon–Fri) starting from today, using local dates */
export function getBusinessDays(count: number): string[] {
  const days: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon to avoid DST edge cases
  while (days.length < count) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      days.push(`${yyyy}-${mm}-${dd}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export function useKalendarzFloty(oddzialId: number | null) {
  const [kursy, setKursy] = useState<KursKalendarzDto[]>([]);
  const [loading, setLoading] = useState(false);
  const businessDays = getBusinessDays(10);

  const refetch = useCallback(async () => {
    if (oddzialId == null) { setKursy([]); return; }
    setLoading(true);

    const from = businessDays[0];
    const to = businessDays[businessDays.length - 1];

    const { data } = await supabase
      .from('kursy')
      .select('dzien, numer, status, flota_id, kierowca_id')
      .eq('oddzial_id', oddzialId)
      .gte('dzien', from)
      .lte('dzien', to);

    setKursy((data || []).map(k => ({
      dzien: k.dzien,
      numer: k.numer,
      status: k.status,
      flota_id: k.flota_id,
      kierowca_id: k.kierowca_id,
    })));
    setLoading(false);
  }, [oddzialId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { kursy, businessDays, loading, refetch };
}
