import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { wyslijPowiadomienie } from '@/lib/powiadomienia';

export function useKursActions(refetch: () => void) {
  const [acting, setActing] = useState(false);

  const handleStart = async (kursId: string) => {
    setActing(true);
    const { error } = await supabase
      .from('kursy')
      .update({ status: 'aktywny' })
      .eq('id', kursId);

    if (error) { toast.error('Błąd: ' + error.message); }
    else {
      // Update zlecenia status
      const { data: prz } = await supabase.from('kurs_przystanki').select('zlecenie_id').eq('kurs_id', kursId);
      const zlIds = (prz || []).map(p => p.zlecenie_id).filter(Boolean) as string[];
      if (zlIds.length > 0) {
        await supabase.from('zlecenia').update({ status: 'w_trasie' }).in('id', zlIds);
        // Powiadom nadawców o starcie trasy
        const { data: zlDane } = await supabase.from('zlecenia').select('id, numer, nadawca_id').in('id', zlIds);
        if (zlDane) {
          for (const zl of zlDane) {
            if (zl.nadawca_id) {
              wyslijPowiadomienie({
                user_id: zl.nadawca_id,
                typ: 'zlecenie_w_trasie',
                tresc: `Zlecenie ${zl.numer} jest w trasie`,
                zlecenie_id: zl.id,
              });
            }
          }
        }
      }
      toast.success('Kurs rozpoczęty');
      refetch();
    }
    setActing(false);
  };

  const handleStop = async (kursId: string) => {
    setActing(true);
    const { error } = await supabase
      .from('kursy')
      .update({ status: 'zakonczony' })
      .eq('id', kursId);

    if (error) { toast.error('Błąd: ' + error.message); }
    else {
      toast.success('Kurs zakończony');
      refetch();
    }
    setActing(false);
  };

  const handlePrzystanek = async (przystanekId: string) => {
    setActing(true);
    const { error } = await supabase
      .from('kurs_przystanki')
      .update({ status: 'dostarczone' })
      .eq('id', przystanekId);

    if (error) { toast.error('Błąd: ' + error.message); }
    else {
      // Update zlecenie
      const { data: przData } = await supabase.from('kurs_przystanki').select('zlecenie_id').eq('id', przystanekId).single();
      if (przData?.zlecenie_id) {
        await supabase.from('zlecenia').update({ status: 'dostarczona' }).eq('id', przData.zlecenie_id);
        // Powiadom nadawcę o dostarczeniu
        const { data: zlInfo } = await supabase.from('zlecenia').select('numer, nadawca_id').eq('id', przData.zlecenie_id).single();
        if (zlInfo?.nadawca_id) {
          wyslijPowiadomienie({
            user_id: zlInfo.nadawca_id,
            typ: 'zlecenie_dostarczone',
            tresc: `Zlecenie ${zlInfo.numer} zostało dostarczone`,
            zlecenie_id: przData.zlecenie_id,
          });
        }
      }
      toast.success('Przystanek dostarczony');
      refetch();
    }
    setActing(false);
  };

  return { handleStart, handleStop, handlePrzystanek, acting };
}
