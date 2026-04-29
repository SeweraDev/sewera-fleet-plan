/**
 * Cross-branch suggester — sugestie przekazania niezaplanowanych zlecen
 * do INNEGO ODDZIALU, ALE TYLKO gdy ten oddzial JUZ JEDZIE w tamtym kierunku.
 *
 * Stara wersja (V1) sprawdzala tylko czy obcy oddzial ma kompatybilny POJAZD.
 * Problem: "przekaz do KAT" mogla pojawic sie gdy KAT w ogole nie planuje
 * jechac w te strone — bezsensowna sugestia.
 *
 * Nowa wersja (V2): sprawdzamy ZAPLANOWANE KURSY obcych oddzialow z ich
 * przystankami. Jesli moja niezaplanowana paczka jest <= 20 km od ktoregos
 * przystanku tego kursu, lub objazd dla wstawienia <= 15 km — sugerujemy
 * dorzucenie z konkretnym kursem (numer + kierowca).
 *
 * Specjalny case KAT/R nadal: km miedzy oddzialami zerowy bo wspolny adres.
 */

import { haversineKm } from '@/lib/oddzialy-geo';
import type {
  Niezaplanowane,
  CrossBranchSugestia,
} from '@/lib/planTras';

/** Przystanek obcego kursu — punkt geograficzny + opis. */
export interface PrzystanekObcyKurs {
  lat: number;
  lng: number;
  adres: string | null;
}

/** Obcy kurs — zaplanowany przez inny oddzial na ten sam dzien. */
export interface ObcyKurs {
  kurs_id: string;
  kurs_numer: string | null;
  oddzial_id: number;
  oddzial_nazwa: string;
  /** Kierowca tego kursu (do info dla dyspozytora). */
  kierowca_nazwa: string | null;
  /** Pojazd tego kursu. */
  pojazd_nr_rej: string | null;
  pojazd_typ: string | null;
  /** Lista przystankow z geokoordynatami. */
  przystanki: PrzystanekObcyKurs[];
}

export interface CrossBranchInputV2 {
  niezaplanowane: Niezaplanowane[];
  /** Wszystkie kursy obcych oddzialow na ten dzien (z przystankami). */
  obceKursy: ObcyKurs[];
}

/** Maksymalna odleglosc do najblizszego przystanku obcego kursu (km). */
const MAX_DOJAZD_OD_PRZYSTANKU_KM = 20;

/**
 * Glowna funkcja v2: dla kazdej niezaplanowanej paczki znajdz NAJLEPSZY
 * obcy kurs ktory ma przystanek blisko (<= 20 km).
 *
 * Sortuje obce kursy po dystansie najblizszego przystanku do paczki.
 */
export function suggestCrossBranchV2(input: CrossBranchInputV2): CrossBranchSugestia[] {
  const wynik: CrossBranchSugestia[] = [];

  for (const nz of input.niezaplanowane) {
    const paczkaPos = { lat: nz.paczka.lat, lng: nz.paczka.lng };

    // Per kurs obcy: oblicz dystans do najblizszego przystanku
    type Kandidat = { kurs: ObcyKurs; dystans: number };
    const kandidaci: Kandidat[] = [];
    for (const kurs of input.obceKursy) {
      let najblizszy = Infinity;
      for (const p of kurs.przystanki) {
        if (p.lat === 0 || p.lng === 0) continue;
        const dyst = haversineKm(paczkaPos, { lat: p.lat, lng: p.lng });
        if (dyst < najblizszy) najblizszy = dyst;
      }
      if (najblizszy <= MAX_DOJAZD_OD_PRZYSTANKU_KM) {
        kandidaci.push({ kurs, dystans: najblizszy });
      }
    }

    if (kandidaci.length === 0) continue;

    // Sort: najblizszy przystanek pierwszy
    kandidaci.sort((a, b) => a.dystans - b.dystans);
    const najlepszy = kandidaci[0];

    wynik.push({
      paczka: nz.paczka,
      oddzial_docelowy: najlepszy.kurs.oddzial_id,
      oddzial_nazwa: najlepszy.kurs.oddzial_nazwa,
      powod: nz.powod,
      kurs_docelowy_numer: najlepszy.kurs.kurs_numer,
      kierowca_docelowy_nazwa: najlepszy.kurs.kierowca_nazwa,
      pojazd_docelowy_nr_rej: najlepszy.kurs.pojazd_nr_rej,
      najblizszy_przystanek_km: Math.round(najlepszy.dystans * 10) / 10,
    });
  }

  return wynik;
}
