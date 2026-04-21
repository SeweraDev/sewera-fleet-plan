import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { wyslijDoDyspozytorów } from '@/lib/powiadomienia';
import { getKodOddzialu, buildAuditDopisek } from '@/lib/przekazanieZlecenia';

const STATUSY_DOZWOLONE = ['robocza', 'do_weryfikacji', 'potwierdzona'];

export function usePrzekazZlecenie(onDone?: () => void) {
  const [submitting, setSubmitting] = useState(false);

  const przekaz = async (zlecenieId: string, docelowyOddzialId: number) => {
    if (!zlecenieId || !docelowyOddzialId) return;
    setSubmitting(true);

    // 1. Pobierz zlecenie + nazwy oddziałów
    const { data: zl, error: errZl } = await supabase
      .from('zlecenia')
      .select('id, numer, status, oddzial_id, kurs_id, dzien')
      .eq('id', zlecenieId)
      .single();
    if (errZl || !zl) {
      toast.error('Nie udało się pobrać zlecenia');
      setSubmitting(false);
      return;
    }

    if (!STATUSY_DOZWOLONE.includes(zl.status)) {
      toast.error('Nie można przekazać zlecenia w statusie: ' + zl.status);
      setSubmitting(false);
      return;
    }
    if (zl.oddzial_id === docelowyOddzialId) {
      toast.error('Wybrany oddział jest taki sam jak obecny');
      setSubmitting(false);
      return;
    }

    const { data: oddzialy } = await supabase
      .from('oddzialy')
      .select('id, nazwa')
      .in('id', [zl.oddzial_id, docelowyOddzialId].filter((v): v is number => v != null));
    const nazwaZ = oddzialy?.find(o => o.id === zl.oddzial_id)?.nazwa || '';
    const nazwaDo = oddzialy?.find(o => o.id === docelowyOddzialId)?.nazwa || '';
    const kodZ = getKodOddzialu(nazwaZ);
    const kodDo = getKodOddzialu(nazwaDo);

    // 2. Odepnij od kursu (kurs należy do starego oddziału)
    let odpietoZKursu = false;
    const { data: przystanki } = await supabase
      .from('kurs_przystanki')
      .select('id, kurs_id')
      .eq('zlecenie_id', zlecenieId);
    if (przystanki && przystanki.length > 0) {
      const { error: errDel } = await supabase
        .from('kurs_przystanki')
        .delete()
        .eq('zlecenie_id', zlecenieId)
        .select('id');
      if (errDel) {
        toast.error('Błąd odpinania z kursu: ' + errDel.message);
        setSubmitting(false);
        return;
      }
      // Weryfikacja że DELETE faktycznie zadziałał (RLS może cicho zjeść)
      const { data: wciazIstnieje } = await supabase
        .from('kurs_przystanki')
        .select('id')
        .eq('zlecenie_id', zlecenieId)
        .limit(1);
      if (wciazIstnieje && wciazIstnieje.length > 0) {
        toast.error('Nie udało się odpiąć zlecenia z kursu — brak policy DELETE na kurs_przystanki. Skontaktuj się z administratorem.');
        setSubmitting(false);
        return;
      }
      odpietoZKursu = true;
    }
    if (zl.kurs_id) {
      odpietoZKursu = true;
    }

    // 3. Update oddzial_id (+ wyzeruj kurs_id jeśli było)
    const { data: updated, error: errUpd } = await supabase
      .from('zlecenia')
      .update({ oddzial_id: docelowyOddzialId, kurs_id: null })
      .eq('id', zlecenieId)
      .select('id, oddzial_id');
    if (errUpd) {
      toast.error('Błąd przekazania: ' + errUpd.message);
      setSubmitting(false);
      return;
    }
    // Postgres RLS może cicho zwrócić 0 wierszy — sprawdź że update fizycznie się wykonał
    if (!updated || updated.length === 0 || updated[0].oddzial_id !== docelowyOddzialId) {
      toast.error('Brak uprawnień do przekazania zlecenia — skontaktuj się z administratorem (dodaj policy UPDATE na zlecenia).');
      setSubmitting(false);
      return;
    }

    // 4. Audit dopisek do uwagi pierwszego WZ (best-effort)
    if (kodZ && kodDo) {
      const dopisek = buildAuditDopisek(kodZ, kodDo);
      const { data: wz } = await supabase
        .from('zlecenia_wz')
        .select('id, uwagi')
        .eq('zlecenie_id', zlecenieId)
        .order('created_at', { ascending: true })
        .limit(1);
      const pierwszy = wz?.[0];
      if (pierwszy) {
        const noweUwagi = (pierwszy.uwagi ? pierwszy.uwagi + ' ' : '') + dopisek;
        await supabase.from('zlecenia_wz').update({ uwagi: noweUwagi }).eq('id', pierwszy.id);
      }
    }

    // 5. Powiadomienie do dyspozytorów docelowego oddziału
    const dzienFmt = zl.dzien ? (() => {
      const [y, m, d] = zl.dzien.split('-');
      return `${d}.${m}.${y}`;
    })() : '';
    if (nazwaDo) {
      const tresc = `Otrzymano zlecenie ${zl.numer} z ${kodZ || nazwaZ}` + (dzienFmt ? ` (na ${dzienFmt})` : '') + (odpietoZKursu ? ' — odpięte z kursu' : '');
      try {
        await wyslijDoDyspozytorów(nazwaDo, 'nowe_zlecenie', tresc, zlecenieId);
      } catch (e) {
        console.warn('Nie udało się wysłać powiadomienia', e);
      }
    }

    toast.success(
      `Przekazano do ${nazwaDo}` +
      (dzienFmt ? ` na ${dzienFmt}` : '') +
      (odpietoZKursu ? ' (odpięto z kursu)' : '')
    );
    setSubmitting(false);
    onDone?.();
  };

  return { przekaz, submitting };
}
