import { useState, useEffect } from 'react';
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
      // 1. Geocode adresu
      const coords = await geocodeAddress(adres);
      if (cancelled) return;
      if (!coords) {
        setResult({ ...EMPTY, loading: false, geocodeFailed: true });
        return;
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
      });
    })();

    return () => { cancelled = true; };
  }, [currentOddzialNazwa, typPojazduSystemowy, adres]);

  return result;
}
