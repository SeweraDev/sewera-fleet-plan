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
  obliczKosztyZewWszystkie,
  mapTypNaCennikowy,
  findBestAvailableType,
} from '@/lib/stawki-transportowe';

/**
 * Hook porównuje koszt transportu windą vs HDS dla wybranego oddziału.
 * Pokazuje najmniejszy typ windy/HDS który pomieści ładunek + koszt wew/zew.
 * Sesja 15.05.2026 (noc) — banner kosztów w Kroku 2 dla pozycji wymaga_hds=true.
 */

export interface CenaPojazd {
  typ: string;
  /** Liczba kursow potrzebnych zeby przewiezc caly ladunek (zwykle 1; >1 gdy mniejszy pojazd
   *  jest pokazany jako alternatywa dla niezmieszczenia w jednym kursie). Koszty wew/zew
   *  sa juz pomnozone przez liczbe kursow. */
  liczbaKursow: number;
  kosztWew: { netto: number; brutto: number } | null;
  /** Faktyczny typ wew uzyty do kalkulacji (gdy fallback z innego). */
  uzytTypWew: string | null;
  kosztyZew: Array<{ netto: number; brutto: number; paletyExtra?: number; ladownoscLabel?: string }>;
  /** Faktyczny typ zew uzyty do kalkulacji (gdy fallback). */
  uzytTypZew: string | null;
  /** Minimalny koszt netto (z wew + zew) — do porównania winda vs HDS. */
  minNetto: number | null;
}

export interface WindaVsHdsResult {
  loading: boolean;
  winda: CenaPojazd | null;
  hds: CenaPojazd | null;
  geocodeFailed: boolean;
}

const EMPTY: WindaVsHdsResult = { loading: false, winda: null, hds: null, geocodeFailed: false };

/** Najmniejsza winda która pomieści masę/m³/palety (z liczba kursow).
 *  UWAGA: Winda MAX 15,8t WYKLUCZONA dla materialow konstrukcyjnych (decyzja 15.05.2026)
 *  — to ciezki van miejski, nie jezdzi na budowy.
 *  Gdy ladunek nie mieci sie w 1 kursie 6,3t — pokazujemy 'Winda 6,3t × N kursow'
 *  (zeby user widzial koszt porownywalny z HDS).
 */
function wybierzTypWindy(masaKg: number, m3: number, palety: number): { typ: string; kursy: number } | null {
  if (masaKg <= 1800 && m3 <= 18 && palety <= 7) return { typ: 'Winda 1,8t', kursy: 1 };
  if (masaKg <= 6300 && m3 <= 32 && palety <= 13) return { typ: 'Winda 6,3t', kursy: 1 };
  // Nie mieci sie w 1 kursie 6,3t — ile kursow potrzeba?
  const kursyMasa = Math.ceil(masaKg / 6300);
  const kursyPalet = palety > 0 ? Math.ceil(palety / 13) : 1;
  const kursyM3 = m3 > 0 ? Math.ceil(m3 / 32) : 1;
  const kursy = Math.max(kursyMasa, kursyPalet, kursyM3);
  if (kursy >= 2) return { typ: 'Winda 6,3t', kursy };
  return null;
}

/** Najmniejszy HDS który pomieści masę/palety (z liczba kursow). */
function wybierzTypHds(masaKg: number, palety: number): { typ: string; kursy: number } | null {
  if (masaKg <= 9000 && palety <= 12) return { typ: 'HDS 9,0t', kursy: 1 };
  if (masaKg <= 11700 && palety <= 12) return { typ: 'HDS 12,0t', kursy: 1 };
  // Nie mieci sie w 1 kursie HDS 12T — ile kursow?
  const kursyMasa = Math.ceil(masaKg / 11700);
  const kursyPalet = palety > 0 ? Math.ceil(palety / 12) : 1;
  const kursy = Math.max(kursyMasa, kursyPalet);
  if (kursy >= 2) return { typ: 'HDS 12,0t', kursy };
  return null;
}

export function useWindaVsHdsCost(
  oddzialNazwa: string | undefined,
  adres: string | undefined,
  masaKg: number,
  m3: number,
  palety: number,
): WindaVsHdsResult {
  const [result, setResult] = useState<WindaVsHdsResult>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    if (!oddzialNazwa || !adres || adres.trim().length < 5 || !masaKg) {
      setResult(EMPTY);
      return;
    }
    const kod = NAZWA_TO_KOD[oddzialNazwa];
    if (!kod) { setResult(EMPTY); return; }
    const oddzialCoords = ODDZIAL_COORDS[kod];
    if (!oddzialCoords) { setResult(EMPTY); return; }

    const typWindy = wybierzTypWindy(masaKg, m3, palety);
    const typHds = wybierzTypHds(masaKg, palety);
    if (!typWindy && !typHds) { setResult(EMPTY); return; }

    setResult(prev => ({ ...prev, loading: true }));

    (async () => {
      try {
        const coords = await geocodeAddress(adres);
        if (cancelled) return;
        if (!coords) {
          setResult({ ...EMPTY, loading: false, geocodeFailed: true });
          return;
        }
        const alternatives = await getRouteAlternatives(oddzialCoords, coords);
        if (cancelled) return;
        if (!alternatives || alternatives.length === 0) {
          setResult({ ...EMPTY, loading: false });
          return;
        }

        // Floty current oddziału + sasiedniego (KAT ↔ R wspoldziela)
        const oddzialyRows = await supabase
          .from('oddzialy')
          .select('id, nazwa')
          .then(r => (r.data || []) as Array<{ id: number; nazwa: string }>);
        if (cancelled) return;
        const oddzialId = oddzialyRows.find(o => o.nazwa === oddzialNazwa)?.id;
        if (!oddzialId) { setResult({ ...EMPTY, loading: false }); return; }

        const oddzialIds = [oddzialId];
        if (kod === 'KAT' || kod === 'R') {
          const altKod = kod === 'KAT' ? 'R' : 'KAT';
          const altId = oddzialyRows.find(o => NAZWA_TO_KOD[o.nazwa] === altKod)?.id;
          if (altId) oddzialIds.push(altId);
        }

        const [flotaRows, flotaZewRows] = await Promise.all([
          supabase
            .from('flota')
            .select('typ, jest_zewnetrzny')
            .in('oddzial_id', oddzialIds)
            .eq('aktywny', true)
            .then(r => (r.data || []) as Array<{ typ: string; jest_zewnetrzny?: boolean | null }>),
          supabase
            .from('flota_zewnetrzna')
            .select('typ')
            .in('oddzial_id', oddzialIds)
            .eq('aktywny', true)
            .then(r => (r.data || []) as Array<{ typ: string }>),
        ]);
        if (cancelled) return;

        const wlasneTypy = new Set(flotaRows.filter(f => !f.jest_zewnetrzny).map(f => f.typ));
        const zewTypySet = new Set([
          ...flotaZewRows.map(f => f.typ),
          ...flotaRows.filter(f => f.jest_zewnetrzny).map(f => f.typ),
        ]);

        const calcPojazd = (wybor: { typ: string; kursy: number } | null): CenaPojazd | null => {
          if (!wybor) return null;
          const typSys = wybor.typ;
          const kursy = wybor.kursy;
          const typCennikowy = mapTypNaCennikowy(typSys);
          if (!typCennikowy) return null;
          const km = pickKmFromAlternatives(alternatives, typSys, true);
          const bestWew = findBestAvailableType(typCennikowy, wlasneTypy);
          const bestZew = findBestAvailableType(typCennikowy, zewTypySet);
          const wew1 = bestWew ? obliczKosztWew(km, bestWew.typ) : null;
          const zew1 = bestZew ? obliczKosztyZewWszystkie(km, bestZew.typ, kod) : [];
          // Pomnoz koszty przez liczbe kursow
          const kosztWew = wew1
            ? { netto: wew1.netto * kursy, brutto: wew1.brutto * kursy }
            : null;
          const kosztyZew = zew1.map(z => ({
            ...z,
            netto: z.netto * kursy,
            brutto: z.brutto * kursy,
          }));
          const zewMin = kosztyZew.length > 0 ? kosztyZew[0].netto : null;
          const candidates = [kosztWew?.netto, zewMin].filter((n): n is number => n != null);
          const minNetto = candidates.length ? Math.min(...candidates) : null;
          return {
            typ: typSys,
            liczbaKursow: kursy,
            kosztWew,
            uzytTypWew: bestWew?.typ ?? null,
            kosztyZew,
            uzytTypZew: bestZew?.typ ?? null,
            minNetto,
          };
        };

        const winda = calcPojazd(typWindy);
        const hds = calcPojazd(typHds);

        if (cancelled) return;
        setResult({
          loading: false,
          winda,
          hds,
          geocodeFailed: false,
        });
      } catch {
        if (!cancelled) setResult({ ...EMPTY, loading: false });
      }
    })();

    return () => { cancelled = true; };
  }, [oddzialNazwa, adres, masaKg, m3, palety]);

  return result;
}
