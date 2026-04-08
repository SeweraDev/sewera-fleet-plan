import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Pojazd {
  id: string;
  nr_rej: string;
  typ: string;
  ladownosc_kg: number;
  objetosc_m3: number | null;
  max_palet: number | null;
  oddzial_id: number | null;
  aktywny: boolean;
  jest_zewnetrzny?: boolean;
  nr_rej_raw?: string;
}

export function useFlotaOddzialu(oddzialId: number | null) {
  const [flota, setFlota] = useState<Pojazd[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (oddzialId == null) {
      setFlota([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    // Pobierz flotę własną i zewnętrzną równolegle
    const [resOwn, resZew] = await Promise.all([
      supabase
        .from('flota')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet, oddzial_id, aktywny')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true)
        .order('typ')
        .order('nr_rej'),
      supabase
        .from('flota_zewnetrzna')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet, oddzial_id, aktywny')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true)
        .order('typ')
        .order('nr_rej'),
    ]);

    const own = (resOwn.data || []).map(d => ({
      ...d,
      ladownosc_kg: Number(d.ladownosc_kg),
      objetosc_m3: d.objetosc_m3 != null ? Number(d.objetosc_m3) : null,
      max_palet: (d as any).max_palet != null ? Number((d as any).max_palet) : null,
      jest_zewnetrzny: false,
      nr_rej_raw: d.nr_rej,
    }));
    const TYP_NORMALIZE: Record<string, string> = { 'HDS 12T': 'HDS 12,0t' };
    const zew = (resZew.data || []).map(d => ({
      ...d,
      nr_rej: d.nr_rej + ' (zew)',
      typ: TYP_NORMALIZE[d.typ] || d.typ,
      ladownosc_kg: Number(d.ladownosc_kg),
      objetosc_m3: d.objetosc_m3 != null ? Number(d.objetosc_m3) : null,
      max_palet: (d as any).max_palet != null ? Number((d as any).max_palet) : null,
      jest_zewnetrzny: true,
      nr_rej_raw: d.nr_rej,
    }));

    setFlota([...own, ...zew]);
    setLoading(false);
  }, [oddzialId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { flota, loading, refetch };
}
