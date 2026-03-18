import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Pojazd {
  id: string;
  nr_rej: string;
  typ: string;
  ladownosc_kg: number;
  objetosc_m3: number;
}

export function useFlotaOddzialu(oddzialId: number | null) {
  const [flota, setFlota] = useState<Pojazd[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (oddzialId == null) {
      setFlota([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const fetch = async () => {
      const { data } = await supabase
        .from('flota')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true)
        .order('typ')
        .order('nr_rej');
      setFlota((data || []).map(d => ({
        ...d,
        ladownosc_kg: Number(d.ladownosc_kg),
        objetosc_m3: Number(d.objetosc_m3),
      })));
      setLoading(false);
    };
    fetch();
  }, [oddzialId]);

  return { flota, loading };
}
