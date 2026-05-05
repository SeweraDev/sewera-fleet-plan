import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Lekki hook sprawdzający szybko dostępność pojazdów danego typu na dany dzień.
 * Inaczej niż useSprawdzDostepnosc — nie liczy obciążenia (kg/m³/palety),
 * tylko sprawdza ile aut typu istnieje i ile z nich jest zablokowanych.
 *
 * Używany w sprzedawcy CzasDostawyStep (krok 2) — żeby user wcześnie wiedział,
 * że tego dnia nie ma auta tego typu (np. serwis, urlop).
 */

export interface BlockedVehicle {
  flota_id: string;
  nr_rej: string;
  /** Ostatni kolejny dzień blokady — wyznaczony przez kolejne wpisy w `dostepnosc_blokady`. */
  zablokowany_do: string;
}

export interface QuickAvailabilityResult {
  loading: boolean;
  /** Liczba aut tego typu w oddziale (aktywnych). */
  totalCount: number;
  /** Liczba aut wolnych w wybranym dniu (totalCount - zablokowane). */
  availableCount: number;
  /** Lista zablokowanych aut z datą do kiedy. */
  blocked: BlockedVehicle[];
}

const EMPTY: QuickAvailabilityResult = { loading: false, totalCount: 0, availableCount: 0, blocked: [] };

/**
 * Znajduje ostatni kolejny dzień blokady (rozszerza się po kolejnych dniach
 * jeśli pojazd ma blokadę dzień po dniu).
 */
function findLastConsecutiveBlockedDay(
  startDay: string,
  blockedDays: Set<string>,
): string {
  let last = startDay;
  let cursor = new Date(startDay);
  while (true) {
    cursor.setDate(cursor.getDate() + 1);
    const next = cursor.toISOString().split('T')[0];
    if (!blockedDays.has(next)) break;
    last = next;
  }
  return last;
}

export function useQuickAvailability(
  oddzialId: number | null,
  typPojazdu: string,
  dzien: string,
): QuickAvailabilityResult {
  const [result, setResult] = useState<QuickAvailabilityResult>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    if (!oddzialId || !typPojazdu || typPojazdu === 'bez_preferencji' || !dzien) {
      setResult(EMPTY);
      return;
    }

    setResult(prev => ({ ...prev, loading: true }));

    (async () => {
      // 1. Pobierz auta tego typu w oddziale
      const { data: vehicles } = await supabase
        .from('flota')
        .select('id, nr_rej, typ')
        .eq('oddzial_id', oddzialId)
        .eq('typ', typPojazdu)
        .eq('aktywny', true);

      if (cancelled) return;

      const vehicleList = vehicles || [];
      if (vehicleList.length === 0) {
        setResult({ loading: false, totalCount: 0, availableCount: 0, blocked: [] });
        return;
      }

      const vehicleIds = vehicleList.map(v => v.id);

      // 2. Pobierz blokady dla tych aut na wybrany dzień + następne 30 dni
      //    (żeby wyznaczyć "do kiedy" dla każdej blokady)
      const dzienDate = new Date(dzien);
      const dzienPlus30 = new Date(dzienDate);
      dzienPlus30.setDate(dzienPlus30.getDate() + 30);
      const dzienPlus30Str = dzienPlus30.toISOString().split('T')[0];

      const { data: blokady } = await supabase
        .from('dostepnosc_blokady')
        .select('zasob_id, dzien')
        .eq('typ', 'pojazd')
        .in('zasob_id', vehicleIds)
        .gte('dzien', dzien)
        .lte('dzien', dzienPlus30Str);

      if (cancelled) return;

      // 3. Wyznacz blokady na wybrany dzień + ich datę "do kiedy"
      const blokadyByVehicle = new Map<string, Set<string>>();
      (blokady || []).forEach(b => {
        if (!blokadyByVehicle.has(b.zasob_id)) blokadyByVehicle.set(b.zasob_id, new Set());
        blokadyByVehicle.get(b.zasob_id)!.add(b.dzien);
      });

      const blocked: BlockedVehicle[] = [];
      for (const v of vehicleList) {
        const days = blokadyByVehicle.get(v.id);
        if (!days || !days.has(dzien)) continue; // nie zablokowany w tym dniu
        const lastDay = findLastConsecutiveBlockedDay(dzien, days);
        blocked.push({
          flota_id: v.id,
          nr_rej: v.nr_rej,
          zablokowany_do: lastDay,
        });
      }

      setResult({
        loading: false,
        totalCount: vehicleList.length,
        availableCount: vehicleList.length - blocked.length,
        blocked,
      });
    })();

    return () => { cancelled = true; };
  }, [oddzialId, typPojazdu, dzien]);

  return result;
}
