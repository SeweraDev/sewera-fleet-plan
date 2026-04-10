import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Oddzial {
  id: number;
  nazwa: string;
}

const KOLEJNOSC: string[] = [
  'Katowice', 'Sosnowiec', 'Gliwice', 'T.Góry',
  'Chrzanów', 'D.Górnicza', 'Oświęcim',
  'Redystrybucja', 'Dobromir',
];

export function useOddzialy() {
  const [oddzialy, setOddzialy] = useState<Oddzial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('oddzialy')
        .select('id, nazwa');
      const sorted = (data || []).sort((a, b) => {
        const ia = KOLEJNOSC.indexOf(a.nazwa);
        const ib = KOLEJNOSC.indexOf(b.nazwa);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
      setOddzialy(sorted);
      setLoading(false);
    };
    fetch();
  }, []);

  return { oddzialy, loading };
}
