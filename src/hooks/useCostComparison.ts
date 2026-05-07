import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  ODDZIAL_COORDS,
  NAZWA_TO_KOD,
  geocodeAddress,
  getRouteAlternatives,
  pickKmFromAlternatives,
} from '@/lib/oddzialy-geo';
import {
  obliczKosztWew,
  obliczKosztZew,
  mapTypNaCennikowy,
  findBestAvailableType,
} from '@/lib/stawki-transportowe';

export interface CostComparisonRow {
  oddzialKod: string;
  /** "Katowice", "Sosnowiec" itd. — do wyświetlenia w UI */
  oddzialNazwa: string;
  /** Czy to jest oddział obecnie wybrany (z którego user tworzy zlecenie). */
  isCurrent: boolean;
  km: number;
  /** Koszt netto/brutto pojazdem własnym Sewera (gdy pasujący typ obsługiwany). */
  kosztWew: { netto: number; brutto: number } | null;
  /** Koszt netto/brutto pojazdem zewnętrznym (gdy stawka istnieje dla tego oddziału).
   *  paletyExtra = stawka per paleta (informacyjna, mnozona przez palety w kontekscie zlecenia). */
  kosztZew: { netto: number; brutto: number; paletyExtra?: number; nazwa_firmy?: string } | null;
  /** min(kosztWew?.netto, kosztZew?.netto) — używamy do rankingu i porównania. */
  minNetto: number | null;
  /** Typ cennikowy faktycznie użyty (po fallbacku, np. "z windą do 1,8t" gdy żądano "do 1,2t bez windy"). */
  uzytTyp: string | null;
  /** Czy typ to fallback (oddział nie ma dokładnie żądanego typu, ale ma podobny). */
  isFallback: boolean;
  /** Kierunek fallbacku: 'down' = mniejszy niż żądany, 'up' = większy, null = dokładny. */
  fallbackDirection: 'down' | 'up' | null;
  /** Lista typów systemowych z floty WŁASNEJ obsługujących wybrany typ cennikowy (np. ["Dostawczy 1,2t"]). */
  wewTypy: string[];
  /** Lista typów systemowych z floty ZEWNĘTRZNEJ obsługujących wybrany typ cennikowy. */
  zewTypy: string[];
}

export interface CostComparisonResult {
  loading: boolean;
  /** Top oddziały: obecny + 2 najbliższych z dostępnym typem (max 3 wiersze, sortowane po km). */
  rows: CostComparisonRow[];
  /** Najtańszy oddział z `rows` — null gdy brak danych. */
  cheapest: CostComparisonRow | null;
  /** Bieżący oddział user'a (current=true). */
  current: CostComparisonRow | null;
  /** Czy istnieje tańsza alternatywa od bieżącego (różnica w pełnych zł). */
  savings: number | null;
  /** Adres nie udało się zgeokodować — pokazuje błąd zamiast wyników. */
  geocodeFailed: boolean;
  /** Współrzędne adresu dostawy — dla mapy. */
  coords: { lat: number; lng: number } | null;
}

const KOD_TO_NAZWA: Record<string, string> = {};
for (const [nazwa, kod] of Object.entries(NAZWA_TO_KOD)) {
  KOD_TO_NAZWA[kod] = nazwa;
}

const EMPTY: CostComparisonResult = {
  loading: false,
  rows: [],
  cheapest: null,
  current: null,
  savings: null,
  geocodeFailed: false,
  coords: null,
};

/**
 * Porównuje koszt transportu z każdego oddziału do podanego adresu dostawy.
 * Logika identyczna z `WycenTransportTab` (sesja 30.04 — top 2 najbliższych + mój,
 * fallback typu wew/zew, merge KAT+R, flota własna i zewnętrzna).
 */
export function useCostComparison(
  currentOddzialNazwa: string,
  typPojazduSystemowy: string,
  adres: string,
): CostComparisonResult {
  const [result, setResult] = useState<CostComparisonResult>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    if (!currentOddzialNazwa || !typPojazduSystemowy || !adres || adres.trim().length < 5) {
      setResult(EMPTY);
      return;
    }

    if (typPojazduSystemowy === 'bez_preferencji' || typPojazduSystemowy === 'zewnetrzny') {
      setResult(EMPTY);
      return;
    }

    const typCennikowy = mapTypNaCennikowy(typPojazduSystemowy);
    if (!typCennikowy) {
      setResult(EMPTY);
      return;
    }

    const currentKod = NAZWA_TO_KOD[currentOddzialNazwa];

    setResult(prev => ({ ...prev, loading: true }));

    (async () => {
      // 1. Geocode adresu + równolegle pobierz flotę własną, zewn., oddziały
      // UWAGA: tabela `flota` zawiera kolumne jest_zewnetrzny - zewnetrzne pojazdy
      // moga byc w obu miejscach (flota.jest_zewnetrzny=true lub flota_zewnetrzna).
      // Pobieramy z flaga zeby moc rozdzielic lokalnie.
      const flotaPromise = supabase
        .from('flota')
        .select('typ, oddzial_id, jest_zewnetrzny')
        .eq('aktywny', true)
        .then(r => (r.data || []) as Array<{ typ: string; oddzial_id: number | null; jest_zewnetrzny?: boolean | null }>);

      const flotaZewPromise = supabase
        .from('flota_zewnetrzna')
        .select('typ, oddzial_id')
        .eq('aktywny', true)
        .then(r => (r.data || []) as Array<{ typ: string; oddzial_id: number | null }>);

      const oddzialyPromise = supabase
        .from('oddzialy')
        .select('id, nazwa')
        .then(r => (r.data || []) as Array<{ id: number; nazwa: string }>);

      const [coords, flotaRows, flotaZewRows, oddzialyRows] = await Promise.all([
        geocodeAddress(adres),
        flotaPromise,
        flotaZewPromise,
        oddzialyPromise,
      ]);
      if (cancelled) return;
      if (!coords) {
        setResult({ ...EMPTY, loading: false, geocodeFailed: true });
        return;
      }

      // Mapowanie id oddziału → kod
      const oddzialIdToKod = new Map<number, string>();
      for (const o of oddzialyRows) {
        const kod = NAZWA_TO_KOD[o.nazwa];
        if (kod) oddzialIdToKod.set(o.id, kod);
      }

      // Mapy typów per oddział: kod → Set<typ_systemowy>
      const buildTypMap = (data: Array<{ typ: string; oddzial_id: number | null }>) => {
        const map = new Map<string, Set<string>>();
        for (const f of data) {
          if (f.oddzial_id == null) continue;
          const kod = oddzialIdToKod.get(f.oddzial_id);
          if (!kod) continue;
          if (!map.has(kod)) map.set(kod, new Set());
          map.get(kod)!.add(f.typ);
        }
        return map;
      };
      // Podziel `flota` po jest_zewnetrzny: false/null = wlasne, true = doloz do zewnetrznych
      const flotaWlasnaRows = flotaRows.filter(f => !(f as any).jest_zewnetrzny);
      const flotaZewExtra = flotaRows.filter(f => !!(f as any).jest_zewnetrzny);
      const flotaWlasna = buildTypMap(flotaWlasnaRows);
      const flotaZew = buildTypMap([...flotaZewRows, ...flotaZewExtra]);

      // KAT i R współdzielą flotę (ten sam adres, te same auta)
      const mergeKATR = (map: Map<string, Set<string>>) => {
        const kat = map.get('KAT') || new Set<string>();
        const r = map.get('R') || new Set<string>();
        const merged = new Set<string>([...kat, ...r]);
        if (merged.size > 0) {
          map.set('KAT', merged);
          map.set('R', merged);
        }
      };
      mergeKATR(flotaWlasna);
      mergeKATR(flotaZew);

      // 2. Dla każdego oddziału: pobierz km (OSRM) + oblicz koszty (z fallbackiem typu)
      const oddzialy = Object.entries(ODDZIAL_COORDS).filter(([kod]) => {
        // KAT i R to ten sam adres — pomiń R gdy current ≠ R, KAT gdy current = R
        if (kod === 'R' && currentKod !== 'R') return false;
        if (kod === 'KAT' && currentKod === 'R') return false;
        return true;
      });

      const allRows: CostComparisonRow[] = [];

      for (const [kod, dane] of oddzialy) {
        if (cancelled) return;
        try {
          const alternatives = await getRouteAlternatives(dane, coords);
          if (!alternatives || alternatives.length === 0) continue;
          const km = pickKmFromAlternatives(alternatives, typPojazduSystemowy);

          const wlasneTypy = flotaWlasna.get(kod) || new Set<string>();
          const bestType = findBestAvailableType(typCennikowy, wlasneTypy);

          let kosztWew: { netto: number; brutto: number } | null = null;
          let uzytTyp: string | null = null;
          let isFallback = false;
          let fallbackDirection: 'down' | 'up' | null = null;

          if (bestType) {
            kosztWew = obliczKosztWew(km, bestType.typ);
            uzytTyp = bestType.typ;
            isFallback = bestType.fallback;
            fallbackDirection = bestType.direction;
          }

          const matchingWewTypy = bestType
            ? [...wlasneTypy].filter(t => {
                const mapped = mapTypNaCennikowy(t);
                return mapped === typCennikowy || mapped === bestType.typ;
              })
            : [];

          const zewTypySet = flotaZew.get(kod) || new Set<string>();
          const bestZewType = findBestAvailableType(typCennikowy, zewTypySet);
          const kosztZew = bestZewType ? obliczKosztZew(km, bestZewType.typ, kod) : null;
          const matchingZewTypy = bestZewType
            ? [...zewTypySet].filter(t => {
                const mapped = mapTypNaCennikowy(t);
                return mapped === typCennikowy || mapped === bestZewType.typ;
              })
            : [];

          const minNetto = (() => {
            const candidates = [kosztWew?.netto, kosztZew?.netto].filter((n): n is number => n != null);
            return candidates.length ? Math.min(...candidates) : null;
          })();

          allRows.push({
            oddzialKod: kod,
            oddzialNazwa: KOD_TO_NAZWA[kod] || kod,
            isCurrent: kod === currentKod,
            km,
            kosztWew,
            kosztZew,
            minNetto,
            uzytTyp,
            isFallback,
            fallbackDirection,
            wewTypy: matchingWewTypy,
            zewTypy: matchingZewTypy,
          });
        } catch {
          // pomiń oddział gdy OSRM/cennik failuje
        }
      }

      if (cancelled) return;

      // 3. Filtruj: tylko oddziały z dostępnym typem (kosztWew lub kosztZew != null)
      // — czyli musi być choć jeden pojazd dokładny lub fallback. Wyjątek: obecny
      // oddział pokazujemy zawsze (user musi widzieć z czego startuje).
      const dostepne = allRows.filter(r => r.kosztWew != null || r.kosztZew != null);
      const mojOddzial = allRows.find(r => r.isCurrent) || null;
      const inneNajblizsze = dostepne
        .filter(r => !r.isCurrent)
        .sort((a, b) => a.km - b.km)
        .slice(0, 2);

      const finalRows: CostComparisonRow[] = [];
      if (mojOddzial) finalRows.push(mojOddzial);
      finalRows.push(...inneNajblizsze);
      finalRows.sort((a, b) => a.km - b.km);

      // 4. cheapest = najtańszy z `rows` (po minNetto), current = obecny
      const sortedByCost = [...finalRows].sort((a, b) => {
        if (a.minNetto == null && b.minNetto == null) return 0;
        if (a.minNetto == null) return 1;
        if (b.minNetto == null) return -1;
        return a.minNetto - b.minNetto;
      });
      const cheapest = sortedByCost.find(r => r.minNetto != null) || null;
      const current = finalRows.find(r => r.isCurrent) || null;

      let savings: number | null = null;
      if (cheapest && current && !cheapest.isCurrent && cheapest.minNetto != null && current.minNetto != null) {
        savings = current.minNetto - cheapest.minNetto;
      }

      setResult({
        loading: false,
        rows: finalRows,
        cheapest,
        current,
        savings,
        geocodeFailed: false,
        coords,
      });
    })();

    return () => { cancelled = true; };
  }, [currentOddzialNazwa, typPojazduSystemowy, adres]);

  return result;
}
