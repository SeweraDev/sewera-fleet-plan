import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Oddzial {
  id: number;
  nazwa: string;
}

export function useOddzialy() {
  const [oddzialy, setOddzialy] = useState<Oddzial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('oddzialy')
        .select('id, nazwa')
        .order('nazwa');
      setOddzialy(data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  return { oddzialy, loading };
}
