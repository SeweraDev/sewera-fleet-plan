import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CreateKursInput {
  oddzial_id: number;
  dzien: string;
  kierowca_id: string | null;
  flota_id: string | null;
  nr_rej_zewn: string | null;
  zlecenie_ids: string[];
}

export function useCreateKurs(onSuccess?: () => void) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (input: CreateKursInput) => {
    setSubmitting(true);
    setError(null);

    const { data: kurs, error: err1 } = await supabase
      .from('kursy')
      .insert({
        oddzial_id: input.oddzial_id,
        dzien: input.dzien,
        kierowca_id: input.kierowca_id,
        nr_rej_zewn: input.nr_rej_zewn,
        flota_id: input.flota_id,
        status: 'zaplanowany',
      })
      .select('id')
      .single();

    if (err1 || !kurs) {
      setError(err1?.message || 'Błąd tworzenia kursu');
      setSubmitting(false);
      return;
    }

    // Insert przystanki
    if (input.zlecenie_ids.length > 0) {
      const przystanki = input.zlecenie_ids.map((zId, i) => ({
        kurs_id: kurs.id,
        zlecenie_id: zId,
        kolejnosc: i + 1,
        status: 'oczekuje',
      }));

      const { error: err2 } = await supabase.from('kurs_przystanki').insert(przystanki);
      if (err2) { setError(err2.message); setSubmitting(false); return; }

      // Update zlecenia status
      await supabase.from('zlecenia').update({ status: 'potwierdzona' }).in('id', input.zlecenie_ids);
    }

    toast.success('✅ Kurs utworzony');
    setSubmitting(false);
    onSuccess?.();
  };

  return { create, submitting, error };
}
