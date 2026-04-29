/**
 * Cross-branch suggester — sugestie przekazania niezaplanowanych zlecen
 * do innego oddzialu, ktory ma kompatybilny pojazd.
 *
 * Specjalny case: KAT i R (Redystrybucja) maja TEN SAM adres bazowy
 * (40-608 Katowice ul. Kosciuszki 326). Cross-branch miedzy nimi nie
 * generuje km dodatkowego dojazdu (km_dojazdu = 0).
 *
 * Inne pary oddzialow: km_dojazdu = OSRM lub haversine x1.4 miedzy bazami.
 * Sugestie sa filtrowane po promieniu PLAN_CONFIG.cross_branch_radius_km.
 */

import { PLAN_CONFIG } from '@/lib/planConfig';
import {
  ODDZIAL_COORDS,
  NAZWA_TO_KOD,
  haversineKm,
  getRouteDistance,
} from '@/lib/oddzialy-geo';
import type {
  Niezaplanowane,
  CrossBranchSugestia,
  PojazdSlot,
  PaczkaPrzystankowa,
} from '@/lib/planTras';
import { rankTypu } from '@/lib/planTras';

/** Inny oddzial z lista jego dostepnych pojazdow (do oceny kompatybilnosci). */
export interface InnyOddzialFloty {
  oddzial_id: number;
  nazwa: string;
  /** Kod 2-3 literowy z NAZWA_TO_KOD (KAT/R/SOS/GL/DG/TG/CH/OS). */
  kod: string;
  pojazdy: PojazdSlot[];
}

export interface CrossBranchInput {
  niezaplanowane: Niezaplanowane[];
  oddzialAktualnyKod: string; // KAT, R, SOS, ...
  innyOddzialFloty: InnyOddzialFloty[];
}

/**
 * Czy ktorykolwiek pojazd z listy moze obsluzyc paczke pod katem typu i pojemnosci?
 */
function jakikolwiekPojazdSpelnia(
  paczka: PaczkaPrzystankowa,
  pojazdy: PojazdSlot[]
): boolean {
  for (const p of pojazdy) {
    if (paczka.wymagany_typ && rankTypu(p.typ) < rankTypu(paczka.wymagany_typ)) continue;
    if (paczka.suma_kg > p.ladownosc_kg) continue;
    if (p.objetosc_m3 != null && paczka.suma_m3 > p.objetosc_m3) continue;
    if (p.max_palet != null && paczka.suma_palet > p.max_palet) continue;
    return true;
  }
  return false;
}

/**
 * Odleglosc dojazdu miedzy dwoma oddzialami (km).
 * KAT-R = 0 (ten sam adres). Inne pary: haversine x 1.4 (rough).
 */
function kmMiedzyOddzialami(kodA: string, kodB: string): number {
  if (kodA === kodB) return 0;
  // Specjalny case: KAT i R — ten sam adres bazowy
  if (
    (kodA === 'KAT' && kodB === 'R') ||
    (kodA === 'R' && kodB === 'KAT')
  ) {
    return 0;
  }
  const a = ODDZIAL_COORDS[kodA];
  const b = ODDZIAL_COORDS[kodB];
  if (!a || !b) return Infinity;
  return Math.round(haversineKm(a, b) * 1.4 * 10) / 10;
}

/**
 * Glowna funkcja: dla kazdej niezaplanowanej paczki znajdz NAJLEPSZY oddzial
 * (najmniejszy km dojazdu), ktory ma kompatybilny pojazd.
 *
 * Zwraca tylko paczki gdzie sugestia jest sensowna (km_dojazdu <= radius).
 * Paczki bez sugestii (zaden oddzial nie ma kompatybilnego auta) zostaja
 * w `niezaplanowane` po stronie planTras().
 */
export function suggestCrossBranch(input: CrossBranchInput): CrossBranchSugestia[] {
  const wynik: CrossBranchSugestia[] = [];

  for (const nz of input.niezaplanowane) {
    // Znajdz wszystkie oddzialy ktore moga obsluzyc te paczke
    const kandydaci = input.innyOddzialFloty
      .filter((o) => o.kod !== input.oddzialAktualnyKod)
      .filter((o) => jakikolwiekPojazdSpelnia(nz.paczka, o.pojazdy))
      .map((o) => ({
        ...o,
        km_dojazdu: kmMiedzyOddzialami(input.oddzialAktualnyKod, o.kod),
      }))
      .filter((o) => o.km_dojazdu <= PLAN_CONFIG.cross_branch_radius_km)
      .sort((a, b) => a.km_dojazdu - b.km_dojazdu);

    if (kandydaci.length === 0) continue;

    const najlepszy = kandydaci[0];
    wynik.push({
      paczka: nz.paczka,
      oddzial_docelowy: najlepszy.oddzial_id,
      oddzial_nazwa: najlepszy.nazwa,
      powod: nz.powod,
      km_dojazdu: najlepszy.km_dojazdu,
    });
  }

  return wynik;
}

/**
 * Pobierz km droga (OSRM) miedzy dwoma oddzialami — uzywane w UI tylko dla
 * dokladniejszej prezentacji niz haversine x1.4. Cache po stronie OSRM.
 */
export async function getKmDrogaMiedzyOddzialami(
  kodA: string,
  kodB: string
): Promise<number | null> {
  if (kodA === kodB) return 0;
  if ((kodA === 'KAT' && kodB === 'R') || (kodA === 'R' && kodB === 'KAT')) return 0;
  const a = ODDZIAL_COORDS[kodA];
  const b = ODDZIAL_COORDS[kodB];
  if (!a || !b) return null;
  return await getRouteDistance(a, b);
}

/**
 * Helper: konwertuje nazwe oddzialu (z DB) na kod (KAT, R, SOS...).
 */
export function nazwaToKod(nazwa: string): string | null {
  return NAZWA_TO_KOD[nazwa] || null;
}
