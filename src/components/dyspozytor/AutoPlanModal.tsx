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
import { suggestCrossBranchV2, type ObcyKurs } from '@/lib/crossBranchSuggest';
import { proponujDorzucenie, type SugestiaDorzucenia, type PaczkaObca } from '@/lib/proponujDorzucenie';
import { scalAdresy } from '@/lib/planTras';
import { generateNumerKursu } from '@/lib/generateNumerZlecenia';
import { AutoPlanMapa } from '@/components/dyspozytor/AutoPlanMapa';
import { obliczKosztKursuPropozycji } from '@/lib/kosztAutoplan';
import { useFlotaWszystkichOddzialow, findOddzialZTypem } from '@/hooks/useFlotaWszystkichOddzialow';
import { haversineKm } from '@/lib/oddzialy-geo';

// Ładowność per typ pojazdu (do heurystyki "co jeszcze może iść z tym kursem cross-branch")
const LADOWNOSC_PER_TYP: Record<string, number> = {
  'Dostawczy 1,2t': 1200,
  'Winda 1,8t': 1800,
  'Winda 6,3t': 6300,
  'Winda MAX 15,8t': 15800,
  'HDS 9,0t': 9000,
  'HDS 12,0t': 12000,
};

/** Maksymalna odległość kandydata "do dorzucenia" w cross-branch (haversine km). */
const MAX_DORZUCENIE_KM = 30;

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
  const { typyPerOddzial, nazwyOddzialow } = useFlotaWszystkichOddzialow();
  const literalTypySetOddzial = typyPerOddzial.get(oddzialId);
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
        // Pre-fill OFF tylko dla zablokowanych (urlopów). Kierowcy juz w innych
        // kursach dnia mogą wziąć kolejny kurs jeśli starczy budżetu czasowego
        // (≤9h łącznie). Domyslna zmiana — algorytm doda 2. kurs jesli sie zmiesci.
        setKierowcy(
          (data || []).map((k) => ({
            kierowca_id: k.id,
            imie_nazwisko: k.imie_nazwisko,
            uprawnienia: k.uprawnienia || '',
            zmiana: zablokowani.has(k.id) ? 'OFF' : ZMIANA_DEFAULT,
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

      // Pobierz istniejace kursy dnia + ich liczbe przystankow (do szacowania czasu).
      // NIE filtrujemy binarnie 'zajety/wolny' — pojazd moze jechac 2x w jeden dzien
      // (rozni kierowcy na zmianach, lub ten sam kierowca laczny czas <=9h).
      // Zamiast tego liczymy 'czas_zajety_min' per pojazd/kierowca i ograniczamy
      // do limitu w planTras (12h pojazd, 9h kierowca).
      setProgressMsg('Sprawdzanie istniejących kursów...');
      const { data: istniejaceKursy } = await supabase
        .from('kursy')
        .select('id, flota_id, nr_rej_zewn, kierowca_id, numer')
        .eq('dzien', dzien)
        .neq('status', 'usuniety');

      // Per kurs: liczba przystankow (z kurs_przystanki) -> heurystyka czasu
      const kursIds = (istniejaceKursy || []).map((k) => k.id);
      const przystankiPerKurs = new Map<string, number>();
      if (kursIds.length > 0) {
        const { data: przystData } = await supabase
          .from('kurs_przystanki')
          .select('kurs_id')
          .in('kurs_id', kursIds);
        for (const p of przystData || []) {
          przystankiPerKurs.set(p.kurs_id, (przystankiPerKurs.get(p.kurs_id) ?? 0) + 1);
        }
      }
      // Heurystyka czasu trwania kursu (min):
      // 30 min zaladunek + n × (20 min rozladunek + 30 min jazda)
      const szacujCzasKursu = (kursId: string): number => {
        const n = przystankiPerKurs.get(kursId) ?? 0;
        return 30 + n * 50;
      };
      // Sumy czasu zajetego per pojazd/kierowca z istniejacych kursow
      const czasZajetyFlotaId = new Map<string, number>();
      const czasZajetyNrRejZewn = new Map<string, number>();
      const czasZajetyKierowca = new Map<string, number>();
      for (const k of istniejaceKursy || []) {
        const czas = szacujCzasKursu(k.id);
        if (k.flota_id) {
          czasZajetyFlotaId.set(k.flota_id, (czasZajetyFlotaId.get(k.flota_id) ?? 0) + czas);
        }
        if (k.nr_rej_zewn) {
          czasZajetyNrRejZewn.set(k.nr_rej_zewn, (czasZajetyNrRejZewn.get(k.nr_rej_zewn) ?? 0) + czas);
        }
        if (k.kierowca_id) {
          czasZajetyKierowca.set(k.kierowca_id, (czasZajetyKierowca.get(k.kierowca_id) ?? 0) + czas);
        }
      }

      // Pojazdy dostepne — wyklucz tylko zablokowane (urlop), ale nie zajete czasowo
      // (czas_zajety_min przekazany do planTras decyduje czy wezmie kolejny kurs)
      const pojazdyDostepne: PojazdSlot[] = pojazdy
        .filter((p) => !(p.flota_id && zablokowanePojazdy.has(p.flota_id)))
        .map((p) => ({
          ...p,
          czas_zajety_min: p.flota_id
            ? (czasZajetyFlotaId.get(p.flota_id) ?? 0)
            : (czasZajetyNrRejZewn.get(p.nr_rej) ?? 0),
        }));

      const liczbaZCzasem = pojazdyDostepne.filter((p) => (p.czas_zajety_min ?? 0) > 0).length;
      if (liczbaZCzasem > 0) {
        console.log(`[AutoPlan] ${liczbaZCzasem} pojazdów ma już zaplanowany czas dnia (mogą wziąć drugi kurs jeśli starczy budżetu)`);
      }

      // 6. Wybrani kierowcy (zmiana != OFF) — z czasem juz zajetym z istniejacych kursow
      const kierowcySloty: KierowcaSlot[] = kierowcy
        .filter((k) => k.zmiana !== 'OFF')
        .map((k) => ({
          kierowca_id: k.kierowca_id,
          imie_nazwisko: k.imie_nazwisko,
          zmiana: k.zmiana as ZmianaKod,
          ma_hds: /HDS|hds/.test(k.uprawnienia),
          czas_zajety_min: czasZajetyKierowca.get(k.kierowca_id) ?? 0,
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
      // Cross-branch v2: sprawdzamy KURSY innych oddzialow (z przystankami),
      // sugerujemy dorzucenie tylko jesli obcy kurs jedzie blisko niezaplanowanej paczki.
      setProgressMsg('Sprawdzanie kursów innych oddziałów...');
      const { data: oddzialy } = await supabase.from('oddzialy').select('id, nazwa').neq('id', oddzialId);
      const obceOddzialIds = (oddzialy || []).map((o) => o.id);
      const oddzialNazwaMap = new Map<number, string>();
      (oddzialy || []).forEach((o) => oddzialNazwaMap.set(o.id, o.nazwa));

      const obceKursy: ObcyKurs[] = [];
      if (obceOddzialIds.length > 0) {
        // Pobierz kursy obcych oddzialow z dnia
        const { data: kursyObce } = await supabase
          .from('kursy')
          .select('id, numer, oddzial_id, kierowca_nazwa, flota_id, nr_rej_zewn')
          .eq('dzien', dzien)
          .neq('status', 'usuniety')
          .in('oddzial_id', obceOddzialIds);

        // Pobierz typy/nr_rej pojazdow flota
        const flotaIds = (kursyObce || []).map((k) => k.flota_id).filter((v): v is string => !!v);
        const flotaInfoMap = new Map<string, { nr_rej: string; typ: string }>();
        if (flotaIds.length > 0) {
          const { data: flotaData } = await supabase
            .from('flota')
            .select('id, nr_rej, typ')
            .in('id', flotaIds);
          (flotaData || []).forEach((f) => flotaInfoMap.set(f.id, { nr_rej: f.nr_rej, typ: f.typ }));
        }
        const flotaZewMap = new Map<string, string>();
        const nrRejZewn = (kursyObce || []).map((k) => k.nr_rej_zewn).filter((v): v is string => !!v);
        if (nrRejZewn.length > 0) {
          const { data: fzData } = await supabase
            .from('flota_zewnetrzna')
            .select('nr_rej, typ')
            .in('nr_rej', nrRejZewn);
          (fzData || []).forEach((f) => flotaZewMap.set(f.nr_rej, f.typ));
        }

        // Pobierz przystanki tych kursow
        const kursIdyObce = (kursyObce || []).map((k) => k.id);
        const przystankiPerKurs = new Map<string, { adres: string; lat: number; lng: number }[]>();
        if (kursIdyObce.length > 0) {
          // kurs_przystanki -> zlecenia -> zlecenia_wz -> adres
          const { data: przystData } = await supabase
            .from('kurs_przystanki')
            .select('kurs_id, zlecenie_id, kolejnosc')
            .in('kurs_id', kursIdyObce)
            .order('kolejnosc');
          const zlIdyZPrzystanki = (przystData || []).map((p) => p.zlecenie_id);
          const wzAdresMap = new Map<string, string[]>(); // zlecenie_id -> adresy
          if (zlIdyZPrzystanki.length > 0) {
            const { data: wzData } = await supabase
              .from('zlecenia_wz')
              .select('zlecenie_id, adres')
              .in('zlecenie_id', zlIdyZPrzystanki);
            for (const w of wzData || []) {
              if (!wzAdresMap.has(w.zlecenie_id)) wzAdresMap.set(w.zlecenie_id, []);
              if (w.adres) wzAdresMap.get(w.zlecenie_id)!.push(w.adres);
            }
          }
          // Geocoduj adresy obcych kursow
          for (const p of przystData || []) {
            const adresy = wzAdresMap.get(p.zlecenie_id) ?? [];
            for (const adres of adresy) {
              if (!wzZGeo.has(adres)) {
                const coords = await geocodeAddress(adres);
                wzZGeo.set(adres, coords);
              }
              const geo = wzZGeo.get(adres);
              if (!geo) continue;
              if (!przystankiPerKurs.has(p.kurs_id)) przystankiPerKurs.set(p.kurs_id, []);
              przystankiPerKurs.get(p.kurs_id)!.push({ adres, lat: geo.lat, lng: geo.lng });
            }
          }
        }

        for (const k of kursyObce || []) {
          const fInfo = k.flota_id ? flotaInfoMap.get(k.flota_id) : null;
          const fZewTyp = k.nr_rej_zewn ? flotaZewMap.get(k.nr_rej_zewn) : null;
          obceKursy.push({
            kurs_id: k.id,
            kurs_numer: k.numer,
            oddzial_id: k.oddzial_id,
            oddzial_nazwa: oddzialNazwaMap.get(k.oddzial_id) ?? '?',
            kierowca_nazwa: k.kierowca_nazwa,
            pojazd_nr_rej: fInfo?.nr_rej ?? k.nr_rej_zewn,
            pojazd_typ: fInfo?.typ ?? fZewTyp ?? null,
            przystanki: przystankiPerKurs.get(k.id) ?? [],
          });
        }
        console.log(`[AutoPlan] obce kursy do analizy cross-branch: ${obceKursy.length}`);
      }

      const crossBranch = suggestCrossBranchV2({
        niezaplanowane: wynik.niezaplanowane,
        obceKursy,
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
        {step === 'wynik' && planResult && (() => {
          // Pre-licz koszty wszystkich kursow (faktura klienta wg taryfikatora IV 2026)
          const kodOddz = NAZWA_TO_KOD[oddzialNazwa];
          const baza = ODDZIAL_COORDS[kodOddz];
          const kosztyMap = new Map<string, ReturnType<typeof obliczKosztKursuPropozycji> | null>();
          if (baza) {
            for (const k of planResult.kursy) {
              try {
                kosztyMap.set(k.kurs_id_tmp, obliczKosztKursuPropozycji(k, { lat: baza.lat, lng: baza.lng }));
              } catch {
                kosztyMap.set(k.kurs_id_tmp, null);
              }
            }
          }
          const sumaKosztu = Array.from(kosztyMap.values()).reduce(
            (s, r) => s + (r?.koszt_calkowity ?? 0),
            0
          );
          return (
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

            {/* Podsumowanie finansowe (faktura klienta wg taryfikatora IV 2026) */}
            {sumaKosztu > 0 && (
              <div className="text-sm bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded p-2">
                💰 <b>Suma faktur klientów</b> (taryfikator IV 2026): <b>{sumaKosztu.toFixed(2)} zł</b>
                <span className="text-xs text-muted-foreground ml-2">
                  (linia prosta × udział × km kółka, min 10 km/punkt)
                </span>
              </div>
            )}

            {/* Lista kursow — POGRUPOWANE PER KIEROWCA */}
            {planResult.kursy.length > 0 && (() => {
              // Grupuj kursy per kierowca + sumaryczne dane
              const grupy = new Map<string, typeof planResult.kursy>();
              for (const k of planResult.kursy) {
                const kid = k.kierowca?.kierowca_id ?? '__brak__';
                if (!grupy.has(kid)) grupy.set(kid, []);
                grupy.get(kid)!.push(k);
              }
              return (
              <div>
                <h3 className="font-medium mb-2">Proponowane kursy</h3>
                <div className="space-y-3">
                  {Array.from(grupy.entries()).map(([kid, kursyKierowcy]) => {
                    const sumaCzasH = kursyKierowcy.reduce((s, k) => s + k.czas_total_min, 0) / 60;
                    const sumaKm = kursyKierowcy.reduce((s, k) => s + k.km_total, 0);
                    const sumaKg = kursyKierowcy.reduce((s, k) => s + k.suma_kg, 0);
                    const nazwaKierowcy = kursyKierowcy[0].kierowca?.imie_nazwisko ?? 'Brak kierowcy';
                    return (
                      <div key={kid} className="space-y-2">
                        <div className="flex items-baseline gap-2 border-l-4 border-blue-500 pl-3 py-1 bg-blue-50/50 rounded-r">
                          <span className="font-medium">👤 {nazwaKierowcy}</span>
                          <span className="text-xs text-muted-foreground">
                            {kursyKierowcy.length} kurs{kursyKierowcy.length > 1 ? 'y' : ''}
                            {' · '}{Math.round(sumaCzasH * 10) / 10}h / 9h
                            {' · '}{sumaKm.toFixed(1)} km
                            {' · '}{Math.round(sumaKg)} kg
                          </span>
                        </div>
                        <div className="space-y-2 ml-2">
                          {kursyKierowcy.map((k) => {
                            const i = planResult.kursy.indexOf(k);
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
                              {(() => {
                                const r = kosztyMap.get(k.kurs_id_tmp);
                                if (!r) return null;
                                return (
                                  <span className="ml-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                    {' • 💰 '}{r.koszt_calkowity.toFixed(2)} zł
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="text-xs mt-2 space-y-0.5">
                              {k.przystanki.map((p, pi) => {
                                const r = kosztyMap.get(k.kurs_id_tmp);
                                const punktKoszt = r?.punkty[pi]?.koszt_punktu;
                                return (
                                <div key={p.klucz_adresu} className="flex gap-2">
                                  <span className="text-muted-foreground">{pi + 1}.</span>
                                  <span className="truncate flex-1">
                                    <b>{p.odbiorca}</b> — {p.adres}
                                    {p.wymagany_typ && <span className="ml-1 text-blue-600">[{p.wymagany_typ}]</span>}
                                    {p.ma_proxy && <span className="ml-1 text-orange-600">⚠</span>}
                                  </span>
                                  {punktKoszt != null && (
                                    <span className="text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                      {punktKoszt.toFixed(2)} zł
                                    </span>
                                  )}
                                  <span className="text-muted-foreground whitespace-nowrap">
                                    {Math.round(p.suma_kg)} kg
                                  </span>
                                </div>
                                );
                              })}
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
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Sugerowane przekazania (typ auta niedostepny u nas) */}
            {literalTypySetOddzial && (() => {
              type ProblemItem = {
                paczka: typeof planResult.kursy[0]['przystanki'][0];
                kursTmpId: string;
                kursLabel: string;
                target: { oddzial_id: number; nazwa: string };
                kandydaci: typeof planResult.kursy[0]['przystanki'];
                kosztAktualny: number | null;
              };
              const problemy: ProblemItem[] = [];
              for (const kurs of planResult.kursy) {
                const r = kosztyMap.get(kurs.kurs_id_tmp);
                kurs.przystanki.forEach((paczka, pi) => {
                  if (!paczka.wymagany_typ) return;
                  if (literalTypySetOddzial.has(paczka.wymagany_typ)) return;
                  const target = findOddzialZTypem(paczka.wymagany_typ, oddzialId, typyPerOddzial, nazwyOddzialow);
                  if (!target) return;
                  const targetMaxKg = LADOWNOSC_PER_TYP[paczka.wymagany_typ] ?? Infinity;
                  const remainingKg = targetMaxKg - paczka.suma_kg;
                  const kandydaci = planResult.kursy.flatMap((kOther) =>
                    kOther.przystanki.filter((pOther) => {
                      if (pOther.klucz_adresu === paczka.klucz_adresu) return false;
                      if (pOther.suma_kg > remainingKg) return false;
                      const dist = haversineKm(
                        { lat: paczka.lat, lng: paczka.lng },
                        { lat: pOther.lat, lng: pOther.lng }
                      );
                      return dist <= MAX_DORZUCENIE_KM;
                    })
                  );
                  problemy.push({
                    paczka,
                    kursTmpId: kurs.kurs_id_tmp,
                    kursLabel: `${kurs.pojazd.nr_rej} (${kurs.pojazd.typ}) • ${kurs.kierowca?.imie_nazwisko ?? '—'}`,
                    target,
                    kandydaci,
                    kosztAktualny: r?.punkty[pi]?.koszt_punktu ?? null,
                  });
                });
              }
              if (problemy.length === 0) return null;
              return (
                <div>
                  <h3 className="font-medium mb-2 text-amber-700 dark:text-amber-400">
                    🔥 Sugerowane przekazania do innego oddziału ({problemy.length})
                  </h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    Te zlecenia mają wpisany typ auta, którego Twój oddział nie posiada.
                    Powinny pojechać z oddziału, który ma odpowiedni pojazd.
                  </p>
                  <div className="space-y-2">
                    {problemy.map((pr, idx) => (
                      <div key={idx} className="text-sm border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 rounded p-3">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <div className="font-semibold">
                            ↗ {pr.paczka.odbiorca}
                          </div>
                          <div className="text-xs">
                            Wymóg: <b>{pr.paczka.wymagany_typ}</b> • Twój oddział nie ma takiego auta
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          {pr.paczka.adres}
                        </div>
                        <div className="text-sm mb-2">
                          → Przekaż do oddziału <b className="text-amber-800 dark:text-amber-300">{pr.target.nazwa}</b> (mają {pr.paczka.wymagany_typ})
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Aktualnie zaplanowane w: {pr.kursLabel}
                          {pr.kosztAktualny != null && <> • klient zapłaci <b>{pr.kosztAktualny.toFixed(2)} zł</b></>}
                        </div>
                        {pr.kandydaci.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                            <div className="text-xs font-medium mb-1">
                              💡 Można dorzucić do tej dostawy (waga pasuje do {pr.paczka.wymagany_typ}, kierunek się zgadza):
                            </div>
                            <div className="space-y-0.5">
                              {pr.kandydaci.map((k) => {
                                const dist = haversineKm(
                                  { lat: pr.paczka.lat, lng: pr.paczka.lng },
                                  { lat: k.lat, lng: k.lng }
                                );
                                return (
                                  <div key={k.klucz_adresu} className="text-xs flex justify-between gap-2">
                                    <span className="truncate">• <b>{k.odbiorca}</b> — {k.adres}</span>
                                    <span className="text-muted-foreground whitespace-nowrap">
                                      {Math.round(k.suma_kg)} kg • {dist.toFixed(1)} km od głównego
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-1">
                              Decyzję o dorzuceniu podejmuje dyspozytor docelowego oddziału — sprawdzi kompatybilność klasyfikacji i okno czasowe.
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Mapa tras */}
            {planResult.kursy.length > 0 && (() => {
              const kodOddz = NAZWA_TO_KOD[oddzialNazwa];
              const baza = ODDZIAL_COORDS[kodOddz];
              if (!baza) return null;
              return (
                <div>
                  <h3 className="font-medium mb-2">🗺 Mapa tras</h3>
                  <AutoPlanMapa
                    kursy={planResult.kursy}
                    oddzialBaza={{ lat: baza.lat, lng: baza.lng }}
                    oddzialNazwa={oddzialNazwa}
                    crossBranch={planResult.crossBranch}
                    dorzucenia={sugestieDorzucenia}
                  />
                </div>
              );
            })()}

            {/* Cross-branch — sugestie dorzucenia do KONKRETNEGO kursu obcego oddziału */}
            {planResult.crossBranch.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">🔄 Sugestie przekazania (oddziały już jadące w tę stronę)</h3>
                <div className="space-y-1">
                  {planResult.crossBranch.map((cb, i) => (
                    <div key={i} className="text-sm bg-blue-50 border border-blue-200 p-2 rounded">
                      <b>{cb.paczka.odbiorca}</b> ({cb.paczka.adres})
                      {' '}→ dorzuć do{' '}
                      {cb.kurs_docelowy_numer ? (
                        <>
                          <b>{cb.kurs_docelowy_numer}</b>
                          {cb.kierowca_docelowy_nazwa && ` (${cb.kierowca_docelowy_nazwa})`}
                          {cb.pojazd_docelowy_nr_rej && ` • ${cb.pojazd_docelowy_nr_rej}`}
                        </>
                      ) : (
                        <b>{cb.oddzial_nazwa}</b>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {cb.najblizszy_przystanek_km} km od najbliższego przystanku obcego kursu
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Niezaplanowane = TRANSPORT ZEWNĘTRZNY (nikt nie jedzie w tę stronę) */}
            {(() => {
              const niezaplanowaneBezSugestii = planResult.niezaplanowane.filter(
                (nz) => !planResult.crossBranch.some((cb) => cb.paczka.klucz_adresu === nz.paczka.klucz_adresu)
              );
              if (niezaplanowaneBezSugestii.length === 0) return null;
              const sumaKg = niezaplanowaneBezSugestii.reduce((s, nz) => s + nz.paczka.suma_kg, 0);
              return (
                <div>
                  <h3 className="font-medium mb-2">🚛 Transport zewnętrzny</h3>
                  <div className="bg-orange-50 border border-orange-200 p-3 rounded mb-2">
                    <div className="text-sm font-medium mb-1">
                      Zostało <b>{niezaplanowaneBezSugestii.length}</b> zleceń ({Math.round(sumaKg)} kg)
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Nie zmieściły się u nas i żaden inny oddział nie jedzie w tę stronę. Rozważ kontakt z firmą zewnętrzną.
                    </div>
                  </div>
                  <div className="space-y-1">
                    {niezaplanowaneBezSugestii.map((nz, i) => (
                      <div key={i} className="text-sm bg-white border p-2 rounded">
                        <b>{nz.paczka.odbiorca}</b> — {nz.paczka.adres}
                        {' '}<span className="text-muted-foreground">({Math.round(nz.paczka.suma_kg)} kg)</span>
                        <div className="text-xs text-muted-foreground">{nz.powod}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
          );
        })()}

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
