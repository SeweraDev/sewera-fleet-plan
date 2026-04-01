import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { generateNumerZlecenia } from '@/lib/generateNumerZlecenia';

export interface WzInput {
  numer_wz: string | null;
  nr_zamowienia: string | null;
  odbiorca: string;
  adres: string;
  tel: string | null;
  masa_kg: number;
  objetosc_m3: number | null;
  ilosc_palet: number;
  uwagi: string | null;
}

export interface ZlecenieInput {
  oddzial_id: number;
  typ_pojazdu: string;
  dzien: string;
  preferowana_godzina: string;
  wz_list: WzInput[];
}

export function useCreateZlecenie(onSuccess?: () => void) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (input: ZlecenieInput, forceVerify = false) => {
    if (!user) return;
    setSubmitting(true);
    setError(null);

    const numer = await generateNumerZlecenia(input.oddzial_id);

    const { data: zlecenie, error: err1 } = await supabase
      .from('zlecenia')
      .insert({
        numer,
        oddzial_id: input.oddzial_id,
        typ_pojazdu: input.typ_pojazdu,
        dzien: input.dzien,
        preferowana_godzina: input.preferowana_godzina,
        nadawca_id: user.id,
        status: forceVerify ? 'do_weryfikacji' : 'robocza',
      })
      .select('id')
      .single();

    if (err1 || !zlecenie) {
      setError(err1?.message || 'Błąd zapisu zlecenia');
      setSubmitting(false);
      return;
    }

    if (input.wz_list.length > 0) {
      const wzRows = input.wz_list.map(wz => ({
        zlecenie_id: zlecenie.id,
        numer_wz: wz.numer_wz,
        odbiorca: wz.odbiorca,
        adres: wz.adres,
        tel: wz.tel,
        masa_kg: wz.masa_kg,
        objetosc_m3: wz.objetosc_m3 || 0,
        ilosc_palet: wz.ilosc_palet || 0,
        uwagi: wz.uwagi,
        nr_zamowienia: wz.nr_zamowienia,
      }));

      const { error: err2 } = await supabase.from('zlecenia_wz').insert(wzRows);
      if (err2) {
        setError(err2.message);
        setSubmitting(false);
        return;
      }
    }

    toast.success(forceVerify ? '⚠️ Zlecenie złożone do weryfikacji' : '✅ Zlecenie złożone');
    setSubmitting(false);
    onSuccess?.();
  };

  return { create, submitting, error };
}
