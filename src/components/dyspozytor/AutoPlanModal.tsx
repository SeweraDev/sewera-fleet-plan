import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { geocodeAddress, NAZWA_TO_KOD, ODDZIAL_COORDS } from '@/lib/oddzialy-geo';
import { ZMIANY, ZMIANA_DEFAULT, type ZmianaKod } from '@/lib/planConfig';
import { planTras, type ZlecenieDoPlanu, type WzDoPlanu, type PojazdSlot, type KierowcaSlot, type PlanResult, type KursPropozycja } from '@/lib/planTras';
import { suggestCrossBranch, type InnyOddzialFloty } from '@/lib/crossBranchSuggest';
import { proponujDorzucenie, type SugestiaDorzucenia, type PaczkaObca } from '@/lib/proponujDorzucenie';
import { scalAdresy } from '@/lib/planTras';
import { generateNumerKursu } from '@/lib/generateNumerZlecenia';

interface Props {
  open: boolean;
  onClose: () => void;
  oddzialId: number;
  oddzialNazwa: string;
  dzien: string;
  /** Po akceptacji propozycji — refetch w Dashboardzie. */
  onPlanZapisany?: () => void;
}

type KierowcaWybor = {
  kierowca_id: string;
  imie_nazwisko: string;
  uprawnienia: string;
  zmiana: ZmianaKod | 'OFF';
};

/**
 * Modal auto-planowania tras dla dyspozytora.
 *
 * Flow:
 *   1. Open: pobierz zlecenia bez kursu + flotę + kierowców
 *   2. Dyspozytor wybiera zmianę dla każdego kierowcy (lub OFF)
 *   3. Klik "Zaplanuj" -> geocoding adresów -> planTras() + suggestCrossBranch()
 *   4. Wyniki: lista kursów + sugestie przekazania do innego oddziału + niezaplanowane
 *   5. (Faza 4b) akcje: akceptuj wszystko / akceptuj jeden / edytuj / odrzuć
 */
export function AutoPlanModal({ open, onClose, oddzialId, oddzialNazwa, dzien, onPlanZapisany }: Props) {
  const [step, setStep] = useState<'config' | 'planning' | 'wynik'>('config');
  const [kierowcy, setKierowcy] = useState<KierowcaWybor[]>([]);
  const [loadingDane, setLoadingDane] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [sugestieDorzucenia, setSugestieDorzucenia] = useState<SugestiaDorzucenia[]>([]);
  const [progressMsg, setProgressMsg] = useState('');
  /** Set kurs_id_tmp ktore zostaly zaakceptowane (zapisane do DB). */
  const [zaakceptowane, setZaakceptowane] = useState<Set<string>>(new Set());
  /** Map kurs_id_tmp -> realny kurs_id (po INSERT) — do generowania karty drogowej. */
  const [zapisaneKursy, setZapisaneKursy] = useState<Map<string, string>>(new Map());
  const [savingKurs, setSavingKurs] = useState<string | null>(null);

  // Reset stanu po zamknieciu
  useEffect(() => {
    if (!open) {
      setStep('config');
      setPlanResult(null);
      setSugestieDorzucenia([]);
      setError(null);
      setProgressMsg('');
      setZaakceptowane(new Set());
      setZapisaneKursy(new Map());
      setSavingKurs(null);
    }
  }, [open]);

  /**
   * Zapis pojedynczego kursu do DB:
   * - INSERT do `kursy` (status: zaplanowany)
   * - INSERT do `kurs_przystanki` per zlecenie z paczek
   * - UPDATE zlecenia.kurs_id
   */
  const zapiszKurs = async (kurs: KursPropozycja) => {
    setSavingKurs(kurs.kurs_id_tmp);
    try {
      const numerKursu = await generateNumerKursu(oddzialId);
      const insertKurs: any = {
        numer: numerKursu,
        oddzial_id: oddzialId,
        dzien,
        status: 'zaplanowany',
        godzina_start: kurs.start_czas,
        kierowca_id: kurs.kierowca?.kierowca_id ?? null,
        kierowca_nazwa: kurs.kierowca?.imie_nazwisko ?? null,
      };
      if (kurs.pojazd.is_zewnetrzny) {
        insertKurs.nr_rej_zewn = kurs.pojazd.nr_rej;
      } else {
        insertKurs.flota_id = kurs.pojazd.flota_id;
      }
      const { data: kursRow, error: errKurs } = await supabase
        .from('kursy')
        .insert(insertKurs)
        .select('id')
        .single();
      if (errKurs || !kursRow) throw new Error(errKurs?.message || 'INSERT kursy nieudane');

      // Buduj liste przystankow: kazda paczka moze miec wiele zlecen → osobny przystanek per zlecenie
      // (zachowujac kolejnosc paczek z 2-opt)
      const przystanki: any[] = [];
      let kolejnosc = 1;
      for (const paczka of kurs.przystanki) {
        for (const zl of paczka.zlecenia) {
          przystanki.push({
            kurs_id: kursRow.id,
            zlecenie_id: zl.zlecenie_id,
            kolejnosc,
          });
          kolejnosc++;
        }
      }
      const { error: errPrz } = await supabase.from('kurs_przystanki').insert(przystanki);
      if (errPrz) throw new Error('INSERT kurs_przystanki: ' + errPrz.message);

      // UPDATE zlecenia.kurs_id
      const zlIds = kurs.przystanki.flatMap((p) => p.zlecenia.map((z) => z.zlecenie_id));
      const { error: errUpd } = await supabase
        .from('zlecenia')
        .update({ kurs_id: kursRow.id })
        .in('id', zlIds);
      if (errUpd) throw new Error('UPDATE zlecenia.kurs_id: ' + errUpd.message);

      setZaakceptowane((prev) => {
        const n = new Set(prev);
        n.add(kurs.kurs_id_tmp);
        return n;
      });
      setZapisaneKursy((prev) => {
        const n = new Map(prev);
        n.set(kurs.kurs_id_tmp, kursRow.id);
        return n;
      });
      toast.success(`Kurs ${numerKursu} zapisany`);
      onPlanZapisany?.();
    } catch (e: any) {
      console.error('[AutoPlan] zapis kursu blad:', e);
      toast.error('Błąd zapisu kursu: ' + (e?.message || 'nieznany'));
    } finally {
      setSavingKurs(null);
    }
  };

  const akceptujWszystko = async () => {
    if (!planResult) return;
    for (const k of planResult.kursy) {
      if (zaakceptowane.has(k.kurs_id_tmp)) continue;
      await zapiszKurs(k);
    }
  };

  /** Otwiera kartę drogową w nowej karcie (strona `/karta-drogowa/:kursId`). */
  const otworzKarteDrogowa = (kursIdTmp: string) => {
    const kursId = zapisaneKursy.get(kursIdTmp);
    if (!kursId) {
      toast.error('Najpierw zaakceptuj kurs');
      return;
    }
    window.open(`/karta-drogowa/${kursId}`, '_blank', 'noopener,noreferrer');
  };

  // Pobierz kierowcow oddzialu po otwarciu
  useEffect(() => {
    if (!open || oddzialId == null) return;
    setLoadingDane(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('kierowcy')
          .select('id, imie_nazwisko, uprawnienia, aktywny')
          .eq('oddzial_id', oddzialId)
          .eq('aktywny', true)
          .order('imie_nazwisko');
        // Sprawdz blokady na ten dzien
        const { data: blokady } = await supabase
          .from('blokady')
          .select('zasob_id, typ')
          .eq('typ', 'kierowca')
          .lte('od', dzien)
          .gte('do', dzien);
        const zablokowani = new Set((blokady || []).map((b) => b.zasob_id));
        // Sprawdz istniejace kursy dnia (jakichkolwiek oddzialow) — pojazdy/kierowcy
        // moga byc juz uzyci w kursie miedzyoddzialowym KAT/R
        const { data: istKursy } = await supabase
          .from('kursy')
          .select('kierowca_id')
          .eq('dzien', dzien)
          .neq('status', 'usuniety');
        const wKursach = new Set(
          (istKursy || []).map((k) => k.kierowca_id).filter((v): v is string => !!v)
        );
        setKierowcy(
          (data || []).map((k) => ({
            kierowca_id: k.id,
            imie_nazwisko: k.imie_nazwisko,
            uprawnienia: k.uprawnienia || '',
            // Pre-fill OFF gdy: blokada (urlop) LUB juz w innym kursie dnia
            zmiana: (zablokowani.has(k.id) || wKursach.has(k.id)) ? 'OFF' : ZMIANA_DEFAULT,
          }))
        );
      } catch (e: any) {
        setError('Błąd ładowania kierowców: ' + (e?.message || 'nieznany'));
      } finally {
        setLoadingDane(false);
      }
    })();
  }, [open, oddzialId, dzien]);

  const setZmiana = (kierowcaId: string, zmiana: ZmianaKod | 'OFF') => {
    setKierowcy((prev) => prev.map((k) => (k.kierowca_id === kierowcaId ? { ...k, zmiana } : k)));
  };

  const handleZaplanuj = async () => {
    setStep('planning');
    setError(null);
    setProgressMsg('Pobieranie zleceń...');
    try {
      // 1. Zlecenia bez kursu z tego dnia/oddzialu
      const { data: zlData } = await supabase
        .from('zlecenia')
        .select('id, numer, oddzial_id, typ_pojazdu, preferowana_godzina, kurs_id, status')
        .eq('oddzial_id', oddzialId)
        .eq('dzien', dzien)
        .is('kurs_id', null)
        .in('status', ['robocza', 'do_weryfikacji']);
      const zlecIds = (zlData || []).map((z) => z.id);
      if (zlecIds.length === 0) {
        setError('Brak niezaplanowanych zleceń na ten dzień.');
        setStep('config');
        return;
      }

      // 2. WZ dla tych zlecen
      setProgressMsg('Pobieranie WZ...');
      const { data: wzData } = await supabase
        .from('zlecenia_wz')
        .select('id, zlecenie_id, odbiorca, adres, masa_kg, objetosc_m3, ilosc_palet, klasyfikacja, uwagi')
        .in('zlecenie_id', zlecIds);

      // 3. Geocoding adresów
      setProgressMsg('Geocoding adresów...');
      const wzZGeo: Map<string, { lat: number; lng: number } | null> = new Map();
      const adresyDoGeocode = Array.from(new Set((wzData || []).map((w) => w.adres).filter(Boolean)));
      for (const adres of adresyDoGeocode) {
        const coords = await geocodeAddress(adres);
        wzZGeo.set(adres, coords);
      }
      const niezgeokod = adresyDoGeocode.filter((a) => !wzZGeo.get(a));
      if (niezgeokod.length > 0) {
        console.warn('[AutoPlan] niezlokalizowane adresy:', niezgeokod);
      }

      // 4. Buduj zlecenia do planu
      const zleceniaPlanu: ZlecenieDoPlanu[] = (zlData || []).map((z) => {
        const wzList: WzDoPlanu[] = (wzData || [])
          .filter((w) => w.zlecenie_id === z.id)
          .map((w) => {
            const geo = wzZGeo.get(w.adres) || { lat: 0, lng: 0 };
            return {
              wz_id: w.id,
              odbiorca: w.odbiorca || '',
              adres: w.adres || '',
              lat: geo?.lat ?? 0,
              lng: geo?.lng ?? 0,
              masa_kg: Number(w.masa_kg) || 0,
              objetosc_m3: w.objetosc_m3 != null ? Number(w.objetosc_m3) : null,
              ilosc_palet: w.ilosc_palet != null ? Number(w.ilosc_palet) : null,
              klasyfikacja: w.klasyfikacja,
              uwagi: w.uwagi,
            };
          })
          .filter((w) => w.lat !== 0 && w.lng !== 0); // pomin niezlokalizowane

        return {
          zlecenie_id: z.id,
          numer: z.numer,
          oddzial_id: z.oddzial_id,
          typ_pojazdu: z.typ_pojazdu,
          preferowana_godzina: z.preferowana_godzina,
          wz_list: wzList,
        };
      }).filter((z) => z.wz_list.length > 0);

      if (zleceniaPlanu.length === 0) {
        setError('Brak zleceń z prawidłowymi adresami (geocoding nie zwrócił współrzędnych).');
        setStep('config');
        return;
      }

      // 5. Pojazdy oddziału (Sewera + zewnetrzne)
      setProgressMsg('Pobieranie floty...');
      const { data: flotaData } = await supabase
        .from('flota')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet, aktywny')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true);
      const { data: flotaZewData } = await supabase
        .from('flota_zewnetrzna')
        .select('nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet, aktywny')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true);

      const pojazdy: PojazdSlot[] = [
        ...(flotaData || []).map((f) => ({
          flota_id: f.id,
          nr_rej: f.nr_rej,
          typ: f.typ,
          ladownosc_kg: Number(f.ladownosc_kg) || 0,
          objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
          max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
          is_zewnetrzny: false,
        })),
        ...(flotaZewData || []).map((f) => ({
          flota_id: null,
          nr_rej: f.nr_rej,
          typ: f.typ,
          ladownosc_kg: Number(f.ladownosc_kg) || 0,
          objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
          max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
          is_zewnetrzny: true,
        })),
      ];

      // Sprawdz blokady pojazdow
      const { data: blokadyPoj } = await supabase
        .from('blokady')
        .select('zasob_id, typ')
        .eq('typ', 'pojazd')
        .lte('od', dzien)
        .gte('do', dzien);
      const zablokowanePojazdy = new Set((blokadyPoj || []).map((b) => b.zasob_id));

      // KRYTYCZNE: pobierz istniejace kursy z dnia (status != 'usuniety') i wyfiltruj
      // pojazdy/kierowcow ktorzy juz sa w innych kursach (KAT lub R lub innym oddziale).
      // Bez tego auto-plan tworzy konflikt: ten sam pojazd w 2 kursach na raz.
      setProgressMsg('Sprawdzanie istniejących kursów...');
      const { data: istniejaceKursy } = await supabase
        .from('kursy')
        .select('flota_id, nr_rej_zewn, kierowca_id, numer')
        .eq('dzien', dzien)
        .neq('status', 'usuniety');
      const zajeteFlotaId = new Set(
        (istniejaceKursy || []).map((k) => k.flota_id).filter((v): v is string => !!v)
      );
      const zajeteNrRejZewn = new Set(
        (istniejaceKursy || []).map((k) => k.nr_rej_zewn).filter((v): v is string => !!v)
      );
      const zajeciKierowcy = new Set(
        (istniejaceKursy || []).map((k) => k.kierowca_id).filter((v): v is string => !!v)
      );

      const pojazdyDostepne = pojazdy.filter((p) => {
        // Blokada (urlop pojazdu)
        if (p.flota_id && zablokowanePojazdy.has(p.flota_id)) return false;
        // Juz w innym kursie tego dnia
        if (p.flota_id && zajeteFlotaId.has(p.flota_id)) return false;
        if (p.is_zewnetrzny && zajeteNrRejZewn.has(p.nr_rej)) return false;
        return true;
      });

      const liczbaZajetych = pojazdy.length - pojazdyDostepne.length;
      if (liczbaZajetych > 0) {
        console.log(`[AutoPlan] wyłączono ${liczbaZajetych} pojazdów (już w kursach dnia)`);
      }

      // 6. Wybrani kierowcy (zmiana != OFF) — wyfiltrowani z juz aktywnych kursow
      const kierowcySloty: KierowcaSlot[] = kierowcy
        .filter((k) => k.zmiana !== 'OFF')
        .filter((k) => !zajeciKierowcy.has(k.kierowca_id))
        .map((k) => ({
          kierowca_id: k.kierowca_id,
          imie_nazwisko: k.imie_nazwisko,
          zmiana: k.zmiana as ZmianaKod,
          ma_hds: /HDS|hds/.test(k.uprawnienia),
        }));

      // 7. Baza oddzialu
      const kodOddz = NAZWA_TO_KOD[oddzialNazwa];
      const baza = ODDZIAL_COORDS[kodOddz];
      if (!baza) {
        setError(`Brak współrzędnych dla oddziału ${oddzialNazwa}`);
        setStep('config');
        return;
      }

      // 8. Plan
      setProgressMsg('Planowanie tras...');
      const wynik = await planTras({
        oddzial_id: oddzialId,
        oddzial_nazwa: oddzialNazwa,
        oddzial_baza: { lat: baza.lat, lng: baza.lng },
        dzien,
        zlecenia: zleceniaPlanu,
        pojazdy: pojazdyDostepne,
        kierowcy: kierowcySloty,
      });

      // 9. Cross-branch — pobierz floty innych oddzialow ktore moga obsluzyc niezaplanowane
      setProgressMsg('Sprawdzanie sugestii przekazania...');
      const { data: oddzialy } = await supabase.from('oddzialy').select('id, nazwa').neq('id', oddzialId);
      const innyOddzialFloty: InnyOddzialFloty[] = [];
      for (const o of oddzialy || []) {
        const kod = NAZWA_TO_KOD[o.nazwa];
        if (!kod) continue;
        const { data: fOdd } = await supabase
          .from('flota')
          .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
          .eq('oddzial_id', o.id)
          .eq('aktywny', true);
        const { data: fOddZ } = await supabase
          .from('flota_zewnetrzna')
          .select('nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
          .eq('oddzial_id', o.id)
          .eq('aktywny', true);
        innyOddzialFloty.push({
          oddzial_id: o.id,
          nazwa: o.nazwa,
          kod,
          pojazdy: [
            ...(fOdd || []).map((f) => ({
              flota_id: f.id,
              nr_rej: f.nr_rej,
              typ: f.typ,
              ladownosc_kg: Number(f.ladownosc_kg) || 0,
              objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
              max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
              is_zewnetrzny: false,
            })),
            ...(fOddZ || []).map((f) => ({
              flota_id: null,
              nr_rej: f.nr_rej,
              typ: f.typ,
              ladownosc_kg: Number(f.ladownosc_kg) || 0,
              objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
              max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
              is_zewnetrzny: true,
            })),
          ],
        });
      }

      const crossBranch = suggestCrossBranch({
        niezaplanowane: wynik.niezaplanowane,
        oddzialAktualnyKod: kodOddz,
        innyOddzialFloty,
      });

      // 10. Sugestie dorzucenia obcych zlecen do kursow R
      // Pobieramy niezaplanowane zlecenia z innych oddzialow (glownie KAT przy R i odwrotnie),
      // sprawdzamy czy pasuja na trasy planowanych kursow (cheapest insertion).
      setProgressMsg('Sprawdzanie zleceń z innych oddziałów...');
      const inneOddzIds = (oddzialy || []).map((o) => o.id);
      let dorzucenia: SugestiaDorzucenia[] = [];
      if (inneOddzIds.length > 0 && wynik.kursy.length > 0) {
        // Zlecenia z innych oddzialow na ten dzien — RÓWNIEŻ te z kursami
        // (mozna je realokowac, jesli sensowniej zeby pojechaly innym kursem).
        // Pomijamy tylko 'dostarczona' (juz dostarczone), 'anulowana', 'w_trasie'
        // (juz w drodze, nie ma sensu realokowac).
        const { data: zlObce } = await supabase
          .from('zlecenia')
          .select('id, numer, oddzial_id, typ_pojazdu, preferowana_godzina, kurs_id, status')
          .in('oddzial_id', inneOddzIds)
          .eq('dzien', dzien)
          .in('status', ['robocza', 'do_weryfikacji', 'potwierdzona']);

        // Pobierz numery kursow zrodlowych (gdy kurs_id != null)
        const kursIdsZrodlowe = Array.from(
          new Set((zlObce || []).map((z) => z.kurs_id).filter((v): v is string => !!v))
        );
        const kursNumerMap = new Map<string, string>();
        if (kursIdsZrodlowe.length > 0) {
          const { data: kursyZr } = await supabase
            .from('kursy')
            .select('id, numer')
            .in('id', kursIdsZrodlowe);
          (kursyZr || []).forEach((k) => kursNumerMap.set(k.id, k.numer || ''));
        }

        const obceIds = (zlObce || []).map((z) => z.id);
        if (obceIds.length > 0) {
          const { data: wzObce } = await supabase
            .from('zlecenia_wz')
            .select('id, zlecenie_id, odbiorca, adres, masa_kg, objetosc_m3, ilosc_palet, klasyfikacja, uwagi')
            .in('zlecenie_id', obceIds);

          // Geocoduj adresy obce (te niezgokodowane jeszcze)
          const adresyObceUniq = Array.from(new Set((wzObce || []).map((w) => w.adres).filter(Boolean)));
          for (const adres of adresyObceUniq) {
            if (!wzZGeo.has(adres)) {
              const coords = await geocodeAddress(adres);
              wzZGeo.set(adres, coords);
            }
          }

          // Mapuj zlecenie_id -> kurs_id (zrodlowy) zeby wiedziec ktore zlecenie
          // jest juz w jakims kursie (do oznaczenia w UI '[w K-XYZ]')
          const zlKursMap = new Map<string, string | null>();
          (zlObce || []).forEach((z) => zlKursMap.set(z.id, z.kurs_id));

          // Buduj ZlecenieDoPlanu dla obcych
          const zleceniaObce: ZlecenieDoPlanu[] = (zlObce || []).map((z) => {
            const wzL: WzDoPlanu[] = (wzObce || [])
              .filter((w) => w.zlecenie_id === z.id)
              .map((w) => {
                const geo = wzZGeo.get(w.adres) || null;
                return {
                  wz_id: w.id,
                  odbiorca: w.odbiorca || '',
                  adres: w.adres || '',
                  lat: geo?.lat ?? 0,
                  lng: geo?.lng ?? 0,
                  masa_kg: Number(w.masa_kg) || 0,
                  objetosc_m3: w.objetosc_m3 != null ? Number(w.objetosc_m3) : null,
                  ilosc_palet: w.ilosc_palet != null ? Number(w.ilosc_palet) : null,
                  klasyfikacja: w.klasyfikacja,
                  uwagi: w.uwagi,
                };
              })
              .filter((w) => w.lat !== 0 && w.lng !== 0);
            return {
              zlecenie_id: z.id,
              numer: z.numer,
              oddzial_id: z.oddzial_id,
              typ_pojazdu: z.typ_pojazdu,
              preferowana_godzina: z.preferowana_godzina,
              wz_list: wzL,
            };
          }).filter((z) => z.wz_list.length > 0);

          // Mapuj oddzial_id -> nazwa
          const oddzMap = new Map<number, string>();
          (oddzialy || []).forEach((o) => oddzMap.set(o.id, o.nazwa));

          // Scal obce zlecenia w paczki (per oddzial zrodlowy)
          const paczkiObce: PaczkaObca[] = [];
          // Grupuj obce po oddzial_id
          const perOddzial = new Map<number, ZlecenieDoPlanu[]>();
          for (const zl of zleceniaObce) {
            if (!perOddzial.has(zl.oddzial_id)) perOddzial.set(zl.oddzial_id, []);
            perOddzial.get(zl.oddzial_id)!.push(zl);
          }
          for (const [oddId, zl] of perOddzial.entries()) {
            const paczki = scalAdresy(zl);
            for (const p of paczki) {
              // Wybierz numer kursu zrodlowego (jesli ktores ze zlecen w paczce ma kurs)
              const kursZrId = p.zlecenia
                .map((z) => zlKursMap.get(z.zlecenie_id))
                .find((k): k is string => !!k);
              const kursZrNumer = kursZrId ? (kursNumerMap.get(kursZrId) ?? null) : null;
              paczkiObce.push({
                ...p,
                oddzial_zrodlowy_id: oddId,
                oddzial_zrodlowy_nazwa: oddzMap.get(oddId) ?? '?',
                kurs_zrodlowy_numer: kursZrNumer,
              });
            }
          }

          if (paczkiObce.length > 0) {
            dorzucenia = await proponujDorzucenie(
              wynik.kursy,
              paczkiObce,
              { lat: baza.lat, lng: baza.lng }
            );
            console.log(`[AutoPlan] sugestii dorzucenia: ${dorzucenia.length}`);
          }
        }
      }
      setSugestieDorzucenia(dorzucenia);

      setPlanResult({
        ...wynik,
        crossBranch,
      });
      setStep('wynik');
    } catch (e: any) {
      console.error('[AutoPlan] error:', e);
      setError('Błąd planowania: ' + (e?.message || 'nieznany'));
      setStep('config');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>🤖 Auto-plan tras — {oddzialNazwa}, {dzien}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">
            ❌ {error}
          </div>
        )}

        {/* === STAGE: config === */}
        {step === 'config' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-2">Dostępność kierowców i zmiany</h3>
              {loadingDane ? (
                <p className="text-sm text-muted-foreground">Ładowanie kierowców...</p>
              ) : kierowcy.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak aktywnych kierowców w oddziale.</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {kierowcy.map((k) => (
                    <div key={k.kierowca_id} className="flex items-center justify-between gap-3 p-2 border rounded">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{k.imie_nazwisko}</div>
                        <div className="text-xs text-muted-foreground truncate">{k.uprawnienia || '—'}</div>
                      </div>
                      <Select
                        value={k.zmiana}
                        onValueChange={(v) => setZmiana(k.kierowca_id, v as ZmianaKod | 'OFF')}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ZMIANY.map((z) => (
                            <SelectItem key={z.kod} value={z.kod}>
                              {z.label}
                            </SelectItem>
                          ))}
                          <SelectItem value="OFF">Niedostępny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === STAGE: planning === */}
        {step === 'planning' && (
          <div className="py-8 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{progressMsg}</p>
          </div>
        )}

        {/* === STAGE: wynik === */}
        {step === 'wynik' && planResult && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              ✅ Zaplanowano {planResult.kursy.length} kurs(ów),
              {' '}{planResult.niezaplanowane.length} niezaplanowanych,
              {' '}{planResult.crossBranch.length} sugestii przekazania
              {sugestieDorzucenia.length > 0 && (
                <span>, {sugestieDorzucenia.length} sugestii dorzucenia z innych oddziałów</span>
              )}
              {planResult.liczba_z_proxy > 0 && (
                <span className="ml-2 text-orange-600">
                  ⚠ {planResult.liczba_z_proxy} paczek bez m³/palet — szacowanie z wagi
                </span>
              )}
            </div>

            {/* Lista kursow */}
            {planResult.kursy.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">Proponowane kursy</h3>
                <div className="space-y-2">
                  {planResult.kursy.map((k, i) => {
                    const isZapisany = zaakceptowane.has(k.kurs_id_tmp);
                    const isSaving = savingKurs === k.kurs_id_tmp;
                    const dorzucDoTegoKursu = sugestieDorzucenia.filter(
                      (s) => s.kurs_id_tmp === k.kurs_id_tmp
                    );
                    return (
                      <Card key={k.kurs_id_tmp} className={`p-3 ${isZapisany ? 'bg-green-50 border-green-200' : ''}`}>
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">
                              {isZapisany && <span className="text-green-600">✅ </span>}
                              #{i + 1} • {k.pojazd.nr_rej} ({k.pojazd.typ})
                              {k.pojazd.is_zewnetrzny && <span className="ml-1 text-orange-600">[zew]</span>}
                              {' • '}{k.kierowca?.imie_nazwisko ?? '—'}
                              {' • start '}{k.start_czas}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {k.przystanki.length} przyst. • {k.km_total} km •{' '}
                              {Math.round(k.czas_total_min / 60 * 10) / 10}h •{' '}
                              {Math.round(k.suma_kg)} kg
                              {k.suma_m3 > 0 && ` • ${k.suma_m3} m³`}
                              {k.suma_palet > 0 && ` • ${k.suma_palet} pal.`}
                            </div>
                            <div className="text-xs mt-2 space-y-0.5">
                              {k.przystanki.map((p, pi) => (
                                <div key={p.klucz_adresu} className="flex gap-2">
                                  <span className="text-muted-foreground">{pi + 1}.</span>
                                  <span className="truncate flex-1">
                                    <b>{p.odbiorca}</b> — {p.adres}
                                    {p.wymagany_typ && <span className="ml-1 text-blue-600">[{p.wymagany_typ}]</span>}
                                    {p.ma_proxy && <span className="ml-1 text-orange-600">⚠</span>}
                                  </span>
                                  <span className="text-muted-foreground whitespace-nowrap">
                                    {Math.round(p.suma_kg)} kg
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            {!isZapisany ? (
                              <Button
                                size="sm"
                                onClick={() => zapiszKurs(k)}
                                disabled={isSaving}
                              >
                                {isSaving ? '...' : '✅ Akceptuj'}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => otworzKarteDrogowa(k.kurs_id_tmp)}
                              >
                                📄 Karta drogowa
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Sugestie dorzucenia obcych zlecen do tego kursu */}
                        {dorzucDoTegoKursu.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-blue-200">
                            <div className="text-xs font-medium text-blue-700 mb-1">
                              💡 Można dorzucić z innych oddziałów ({dorzucDoTegoKursu.length}):
                            </div>
                            <div className="space-y-1">
                              {dorzucDoTegoKursu.map((s) => (
                                <div
                                  key={s.paczka_obca.klucz_adresu}
                                  className="text-xs bg-blue-50 border border-blue-200 rounded p-2"
                                >
                                  <div>
                                    <span className="font-medium">{s.paczka_obca.odbiorca}</span>
                                    {' '}— {s.paczka_obca.adres}
                                    {' '}<span className="text-muted-foreground">
                                      ({s.paczka_obca.oddzial_zrodlowy_nazwa})
                                    </span>
                                    {s.paczka_obca.kurs_zrodlowy_numer && (
                                      <span className="ml-1 text-orange-700">
                                        [obecnie w {s.paczka_obca.kurs_zrodlowy_numer}]
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {Math.round(s.paczka_obca.suma_kg)} kg
                                    {s.paczka_obca.wymagany_typ && ` • [${s.paczka_obca.wymagany_typ}]`}
                                    {' '}• pozycja {s.pozycja_insercji}
                                    {' '}• <b>+{s.przyrost_km} km</b>
                                    {' '}• +{s.przyrost_min} min
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cross-branch */}
            {planResult.crossBranch.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">🔄 Sugestie przekazania do innego oddziału</h3>
                <div className="space-y-1">
                  {planResult.crossBranch.map((cb, i) => (
                    <div key={i} className="text-sm bg-blue-50 border border-blue-200 p-2 rounded">
                      <b>{cb.paczka.odbiorca}</b> → przekaż do <b>{cb.oddzial_nazwa}</b>
                      {' '}({cb.km_dojazdu === 0 ? 'ten sam adres bazowy' : `${cb.km_dojazdu} km`})
                      <div className="text-xs text-muted-foreground">{cb.powod}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Niezaplanowane */}
            {planResult.niezaplanowane.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">⚠ Niezaplanowane</h3>
                <div className="space-y-1">
                  {planResult.niezaplanowane
                    .filter((nz) => !planResult.crossBranch.some((cb) => cb.paczka.klucz_adresu === nz.paczka.klucz_adresu))
                    .map((nz, i) => (
                      <div key={i} className="text-sm bg-orange-50 border border-orange-200 p-2 rounded">
                        <b>{nz.paczka.odbiorca}</b> — {nz.paczka.adres}
                        <div className="text-xs text-muted-foreground">{nz.powod}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'config' && (
            <>
              <Button variant="outline" onClick={onClose}>Anuluj</Button>
              <Button
                onClick={handleZaplanuj}
                disabled={loadingDane || kierowcy.filter((k) => k.zmiana !== 'OFF').length === 0}
              >
                🤖 Zaplanuj
              </Button>
            </>
          )}
          {step === 'wynik' && planResult && (
            <>
              <Button variant="outline" onClick={() => setStep('config')}>← Wróć</Button>
              <Button variant="outline" onClick={onClose}>Zamknij</Button>
              <Button
                onClick={akceptujWszystko}
                disabled={
                  savingKurs != null ||
                  planResult.kursy.length === 0 ||
                  planResult.kursy.every((k) => zaakceptowane.has(k.kurs_id_tmp))
                }
              >
                ✅ Akceptuj wszystko ({planResult.kursy.length - zaakceptowane.size})
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
