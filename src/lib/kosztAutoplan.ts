// Helper: oblicz koszt kursu (faktura klienta) z propozycji auto-planu
// Używa istniejącego silnika rozliczKurs() — buduje wzList z PaczkaPrzystankowa
// i wywołuje algorytm taryfikatora.

import { haversineKm } from '@/lib/oddzialy-geo';
import { rozliczKurs, type RozliczenieKursu, type WzDoRozliczenia } from '@/lib/rozliczenie-kolka';
import type { KursPropozycja, GeoPoint } from '@/lib/planTras';

/**
 * Policz koszt kursu z propozycji auto-planu wg taryfikatora IV 2026.
 * Zwraca pełne rozliczenie (per punkt, per WZ, koszt całkowity).
 *
 * @param kurs propozycja kursu z planTras
 * @param oddzialBaza współrzędne bazy oddziału (do linii prostych)
 */
export function obliczKosztKursuPropozycji(
  kurs: KursPropozycja,
  oddzialBaza: GeoPoint
): RozliczenieKursu {
  const wzList: WzDoRozliczenia[] = [];

  kurs.przystanki.forEach((paczka, idx) => {
    const kolejnosc = idx + 1;
    const km_prosta = haversineKm(oddzialBaza, { lat: paczka.lat, lng: paczka.lng });

    for (const zl of paczka.zlecenia) {
      for (const wz of zl.wz_list) {
        wzList.push({
          id: wz.wz_id,
          numer_wz: '',
          odbiorca: wz.odbiorca,
          adres: wz.adres,
          klasyfikacja: wz.klasyfikacja,
          masa_kg: wz.masa_kg,
          wartosc_netto: null,
          kolejnosc,
          km_prosta,
        });
      }
    }
  });

  return rozliczKurs(kurs.km_total, wzList);
}
