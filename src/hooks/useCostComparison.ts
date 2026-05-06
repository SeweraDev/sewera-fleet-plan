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
} from '@/lib/stawki-transportowe';

// Mapowanie typu cennikowego → typy systemowe we flocie (zbieżne z CENNIKOWY_TO_SYSTEMOWE
// w stawki-transportowe.ts; trzymamy tu kopię żeby uniknąć zależności od prywatnego eksportu).
const TYPY_FLOTY_DLA_CENNIKOWEGO: Record<string, string[]> = {
  'do 1,2t bez windy': ['Dostawczy 1,2t'],
  'z windą do 1,8t': ['Winda 1,8t'],
  'z windą do 6t': ['Winda 6,3t'],
  'z windą do 15t': ['Winda MAX 15,8t'],
  'HDS 9,0t': ['HDS 9,0t', 'HDS 8,9t', 'HDS 9,1t'],
  'HDS 12,0t': ['HDS 12,0t', 'HDS 11,7t', 'HDS 12T'],
};

export interface CostComparisonRow {
  oddzialKod: string;
  /** "Katowice", "Sosnowiec" itd. — do wyświetlenia w UI */
  oddzialNazwa: string;
  /** Czy to jest oddział obecnie wybrany (z którego user tworzy zlecenie). */
  isCurrent: boolean;
  km: number;
  /** Koszt netto/brutto pojazdem własnym Sewera (gdy pasujący typ obsługiwany). */
  kosztWew: { netto: number; brutto: number } | null;
  /** Koszt netto/brutto pojazdem zewnętrznym (gdy stawka istnieje dla tego oddziału). */
  kosztZew: { netto: number; brutto: number } | null;
  /** min(kosztWew?.netto, kosztZew?.netto) — używamy do rankingu i porównania. */
  minNetto: number | null;
  /** Czy oddział ma aktywny pojazd dokładnie tego typu (lub jego rodziny — np. HDS 9,0t/8,9t/9,1t). */
  hasPojazdTypu: boolean;
}

export interface CostComparisonResult {
  loading: boolean;
  /** Wszystkie oddziały, posortowane od najtańszego do najdroższego. */
  rows: CostComparisonRow[];
  /** Najtańszy oddział (rows[0]) — null gdy brak danych. */
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
 * Używane w DostepnoscStep żeby user widział czy obecny oddział jest najtańszy.
 *
 * @param currentOddzialNazwa — nazwa oddziału z którego user tworzy zlecenie (np. "Gliwice")
 * @param typPojazduSystemowy — typ wybrany w kroku 1 (np. "Dostawczy 1,2t")
 * @param adres — adres dostawy z pierwszej WZ-tki
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

    // Pomijamy generyczne typy — porównanie ma sens tylko dla konkretnego typu cennikowego
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
      // 1. Geocode adresu + równolegle pobierz flotę wszystkich oddziałów
      const flotaTypySystemowe = TYPY_FLOTY_DLA_CENNIKOWEGO[typCennikowy] || [];

      const flotaPromise = flotaTypySystemowe.length > 0
        ? supabase
            .from('flota')
            .select('oddzial_id, typ')
            .eq('aktywny', true)
            .in('typ', flotaTypySystemowe)
            .then(r => (r.data || []) as Array<{ oddzial_id: number | null; typ: string }>)
        : Promise.resolve([] as Array<{ oddzial_id: number | null; typ: string }>);

      const oddzialyPromise = supabase
        .from('oddzialy')
        .select('id, nazwa')
        .then(r => (r.data || []) as Array<{ id: number; nazwa: string }>);

      const [coords, flotaRows, oddzialyRows] = await Promise.all([
        geocodeAddress(adres),
        flotaPromise,
        oddzialyPromise,
      ]);
      if (cancelled) return;
      if (!coords) {
        setResult({ ...EMPTY, loading: false, geocodeFailed: true });
        return;
      }

      // Mapowanie nazwa → id i odwrotne id → kod (do oznaczenia hasPojazdTypu)
      const idToKod = new Map<number, string>();
      for (const o of oddzialyRows) {
        const kod = NAZWA_TO_KOD[o.nazwa];
        if (kod) idToKod.set(o.id, kod);
      }
      const kodyZPojazdem = new Set<string>();
      for (const f of flotaRows) {
        if (f.oddzial_id == null) continue;
        const kod = idToKod.get(f.oddzial_id);
        if (kod) kodyZPojazdem.add(kod);
      }
      // KAT i R współdzielą flotę (ten sam adres) — jeśli któryś ma, oba mają
      if (kodyZPojazdem.has('KAT') || kodyZPojazdem.has('R')) {
        kodyZPojazdem.add('KAT');
        kodyZPojazdem.add('R');
      }

      // 2. Dla każdego oddziału: pobierz km (OSRM) + oblicz koszty
      const oddzialy = Object.entries(ODDZIAL_COORDS);
      const rows: CostComparisonRow[] = [];

      for (const [kod, dane] of oddzialy) {
        if (cancelled) return;
        // KAT i R to ten sam adres — pomiń R żeby nie duplikować (chyba że current=R)
        if (kod === 'R' && currentKod !== 'R') continue;
        if (kod === 'KAT' && currentKod === 'R') continue;

        try {
          const alternatives = await getRouteAlternatives(dane, coords);
          if (!alternatives || alternatives.length === 0) continue;
          const km = pickKmFromAlternatives(alternatives, typPojazduSystemowy);

          const kosztWew = obliczKosztWew(km, typCennikowy);
          const kosztZew = obliczKosztZew(km, typCennikowy, kod);

          const minNetto = (() => {
            const candidates = [kosztWew?.netto, kosztZew?.netto].filter((n): n is number => n != null);
            return candidates.length ? Math.min(...candidates) : null;
          })();

          rows.push({
            oddzialKod: kod,
            oddzialNazwa: KOD_TO_NAZWA[kod] || kod,
            isCurrent: kod === currentKod,
            km,
            kosztWew,
            kosztZew,
            minNetto,
            hasPojazdTypu: kodyZPojazdem.has(kod),
          });
        } catch {
          // pomiń oddział gdy OSRM/cennik failuje
        }
      }

      if (cancelled) return;

      // 3. Sortuj po min koszcie (rosnąco), oddziały bez kosztu na koniec
      rows.sort((a, b) => {
        if (a.minNetto == null && b.minNetto == null) return 0;
        if (a.minNetto == null) return 1;
        if (b.minNetto == null) return -1;
        return a.minNetto - b.minNetto;
      });

      const cheapest = rows.find(r => r.minNetto != null) || null;
      const current = rows.find(r => r.isCurrent) || null;

      let savings: number | null = null;
      if (cheapest && current && !cheapest.isCurrent && cheapest.minNetto != null && current.minNetto != null) {
        savings = current.minNetto - cheapest.minNetto;
      }

      setResult({
        loading: false,
        rows,
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
