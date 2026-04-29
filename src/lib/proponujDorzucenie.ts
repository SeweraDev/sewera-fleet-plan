/**
 * Sugestie miedzyoddzialowe — "mozna dorzucic do kursu".
 *
 * Dla kazdego kursu z aktualnego planu (np. R) sprawdza czy sa niezaplanowane
 * zlecenia z INNYCH oddzialow (np. KAT) ktore sa "po drodze" — tj. dodanie
 * ich do trasy daje maly przyrost km i miesci sie capacity + czas pracy.
 *
 * Algorytm: cheapest insertion — dla nowego zlecenia X znajdz pozycje
 * w trasie [baza, p1, p2, ..., pn, baza] gdzie wstawienie X daje minimalny
 * przyrost km.
 *
 * Wartosc dla user'a: KAT-dyspozytor widzi ze R-Marcin i tak jedzie
 * do Tychów -> moze dorzucic swoje zlecenie ZL-KAT/.../007 zamiast
 * planowac wlasny kurs (oszczednosc paliwa, czasu kierowcy).
 */

import { PLAN_CONFIG } from '@/lib/planConfig';
import { haversineKm, getRouteDistance } from '@/lib/oddzialy-geo';
import type {
  KursPropozycja,
  PaczkaPrzystankowa,
  PojazdSlot,
  GeoPoint,
} from '@/lib/planTras';
import { rankTypu } from '@/lib/planTras';

/** Sugestia dorzucenia obcego zlecenia do istniejacego kursu. */
export interface SugestiaDorzucenia {
  kurs_id_tmp: string;
  /** Niezaplanowana paczka z INNEGO oddzialu (np. KAT przy planie R). */
  paczka_obca: PaczkaObca;
  /** Pozycja w trasie do wstawienia (1 = przed 1 przyst., n+1 = po ost. przyst.). */
  pozycja_insercji: number;
  /** Przyrost km po wstawieniu. */
  przyrost_km: number;
  /** Przyrost czasu w minutach (jazda + 20 min obsługi). */
  przyrost_min: number;
}

/** Paczka z obcego oddzialu — tu mamy oddzial_zrodlowy. */
export interface PaczkaObca extends PaczkaPrzystankowa {
  oddzial_zrodlowy_id: number;
  oddzial_zrodlowy_nazwa: string;
  /** Numer kursu zrodlowego (jesli paczka jest juz w jakims kursie). null = niezaplanowana. */
  kurs_zrodlowy_numer: string | null;
}

/** Maksymalny akceptowalny przyrost km — wieksze odpadaja jako "nie po drodze". */
const MAX_PRZYROST_KM = 15;

/**
 * Pojazd ma kompatybilny typ dla nowej paczki?
 * Reuje logike z planTras (rodzina + STRICT dla Dostawczego).
 */
function pojazdSpelnia(pojazd: PojazdSlot, paczka: PaczkaPrzystankowa): boolean {
  if (!paczka.wymagany_typ) return true;
  // Dla uproszczenia: tylko strict rank check (większy lub równy w rankingu)
  return rankTypu(pojazd.typ) >= rankTypu(paczka.wymagany_typ);
}

/** Czy nowe zlecenie miesci sie w pojezdzie po dodaniu do istniejacych? */
function miesciSiePoZakładaniu(
  kurs: KursPropozycja,
  paczka: PaczkaObca
): boolean {
  if (!pojazdSpelnia(kurs.pojazd, paczka)) return false;
  const kg = kurs.suma_kg + paczka.suma_kg;
  const m3 = kurs.suma_m3 + paczka.suma_m3;
  const palet = kurs.suma_palet + paczka.suma_palet;
  if (kg > kurs.pojazd.ladownosc_kg) return false;
  if (kurs.pojazd.objetosc_m3 != null && m3 > kurs.pojazd.objetosc_m3) return false;
  if (kurs.pojazd.max_palet != null && palet > kurs.pojazd.max_palet) return false;
  return true;
}

/**
 * Cheapest insertion — znajdz najlepsza pozycje wstawienia paczki obcej do trasy.
 *
 * Trasa: [baza, p1, p2, ..., pn, baza]
 * Pozycji: 1..n+1 (1 = przed p1, n+1 = po pn ale przed baza)
 *
 * Dla pozycji i: przyrost = dist(prev, X) + dist(X, next) - dist(prev, next)
 * gdzie prev = przystanki[i-2] (lub baza jesli i=1), next = przystanki[i-1] (lub baza jesli i=n+1)
 */
async function cheapestInsertion(
  kurs: KursPropozycja,
  paczka: PaczkaObca,
  baza: GeoPoint
): Promise<{ pozycja: number; przyrost_km: number; przyrost_min: number } | null> {
  const punkty: GeoPoint[] = [baza, ...kurs.przystanki.map((p) => ({ lat: p.lat, lng: p.lng }))];
  if (PLAN_CONFIG.auto_wraca_do_bazy) punkty.push(baza);
  const X: GeoPoint = { lat: paczka.lat, lng: paczka.lng };

  let best = { pozycja: -1, przyrost_km: Infinity, przyrost_min: Infinity };

  // Dystans miedzy 2 punktami — proxy haversine x 1.4 dla speed (real OSRM tylko dla finalnej oceny)
  const distProxy = (a: GeoPoint, b: GeoPoint) => haversineKm(a, b) * 1.4;

  for (let i = 1; i < punkty.length; i++) {
    const prev = punkty[i - 1];
    const next = punkty[i];
    const oryg = distProxy(prev, next);
    const zX = distProxy(prev, X) + distProxy(X, next);
    const przyrost_km = Math.max(0, zX - oryg);
    if (przyrost_km < best.przyrost_km) {
      best = {
        pozycja: i,
        przyrost_km: Math.round(przyrost_km * 10) / 10,
        przyrost_min: Math.round((przyrost_km / 50) * 60) + PLAN_CONFIG.czas_rozladunku_min,
      };
    }
  }

  if (best.pozycja === -1 || best.przyrost_km > MAX_PRZYROST_KM) return null;

  // Doprecyzuj km przez OSRM dla najlepszej pozycji (1 zapytanie zamiast N)
  try {
    const prevIdx = best.pozycja - 1;
    const prev = punkty[prevIdx];
    const next = punkty[best.pozycja];
    const [d_prev_X, d_X_next, d_prev_next] = await Promise.all([
      getRouteDistance(prev, X),
      getRouteDistance(X, next),
      getRouteDistance(prev, next),
    ]);
    if (d_prev_X != null && d_X_next != null && d_prev_next != null) {
      const realPrzyrost = Math.max(0, d_prev_X + d_X_next - d_prev_next);
      best.przyrost_km = Math.round(realPrzyrost * 10) / 10;
      best.przyrost_min = Math.round((realPrzyrost / 50) * 60) + PLAN_CONFIG.czas_rozladunku_min;
    }
  } catch {
    /* zostan z proxy */
  }

  if (best.przyrost_km > MAX_PRZYROST_KM) return null;
  return best;
}

/**
 * Glowna funkcja: dla listy kursow + listy paczek obcych zwroc sugestie dorzucenia.
 *
 * Filter:
 *  - Pojazd kursu musi miec kompatybilny typ
 *  - Suma capacity (kg + m³ + palet) po dodaniu <= pojazd
 *  - Suma czasu kursu po dodaniu <= max_pracy_min (8h, fallback 9h)
 *  - Przyrost km <= MAX_PRZYROST_KM (15 km)
 *
 * Sortuj wg malejacej oplacalnosci: maly przyrost km dla duzej wagi.
 */
export async function proponujDorzucenie(
  kursy: KursPropozycja[],
  paczkiObce: PaczkaObca[],
  baza: GeoPoint
): Promise<SugestiaDorzucenia[]> {
  const wynik: SugestiaDorzucenia[] = [];

  for (const paczka of paczkiObce) {
    // Per paczka znajdz wszystkie kursy ktore moga ja przyjac
    const kandydaci: SugestiaDorzucenia[] = [];
    for (const kurs of kursy) {
      if (!miesciSiePoZakładaniu(kurs, paczka)) continue;

      // Cheapest insertion
      const ins = await cheapestInsertion(kurs, paczka, baza);
      if (!ins) continue;

      // Czas calkowity po dolozeniu
      const czasPoDodaniu = kurs.czas_total_min + ins.przyrost_min;
      if (czasPoDodaniu > PLAN_CONFIG.max_pracy_z_nadgodzina_min) continue;

      kandydaci.push({
        kurs_id_tmp: kurs.kurs_id_tmp,
        paczka_obca: paczka,
        pozycja_insercji: ins.pozycja,
        przyrost_km: ins.przyrost_km,
        przyrost_min: ins.przyrost_min,
      });
    }

    // Z kandydatow wez najlepszy (najmniejszy przyrost km)
    kandydaci.sort((a, b) => a.przyrost_km - b.przyrost_km);
    if (kandydaci.length > 0) {
      wynik.push(kandydaci[0]);
    }
  }

  return wynik;
}
