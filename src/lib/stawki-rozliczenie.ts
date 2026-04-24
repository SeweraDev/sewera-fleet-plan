// Stawki rozliczeniowe (taryfikator od 1 IV 2026) — używane przez moduł
// rozliczenia kosztów transportu (kółka). TO NIE JEST TO SAMO co stawki w
// `stawki-transportowe.ts` (kalkulator Wyceń transport) — tam liczymy w jedną
// stronę, tu liczymy per km kółka (oddział → punkty → oddział).
//
// Źródło: \\fs0\users\grzegorz.sekienda\Desktop\transport\taryfikator - co wpisać we Flocie IV 2026.ods_apka.ods
// Spec: memory/project_rozliczenie_kosztow_transportu.md

/** Klasyfikacje rozliczeniowe — spójne z src/lib/klasyfikacje.ts (B/C/D/E/F/H) */
export type KlasyfikacjaKod = 'B' | 'C' | 'D' | 'E' | 'F' | 'H';

/**
 * Stawki zł/km per zakres, per klasyfikacja. Zakresy:
 *   1-10   — pierwsze 10 km (minimum aplikowane gdy dystans < 10 km)
 *   11-20  — kolejne 10 km
 *   21-30  — kolejne 10 km
 *   31-40  — kolejne 10 km
 *   41-60  — kolejne 20 km
 *   60+    — kontynuacja stawki 41-60 dla km powyżej 60
 */
interface StawkiStrefowe {
  s1_10: number;
  s11_20: number;
  s21_30: number;
  s31_40: number;
  s41_60: number;
}

// Stawki z taryfikatora (precyzja wewn., w arkuszu wyświetlane zaokrąglone).
// Zweryfikowane przez sumy skumulowane: np. C do 30 = 132,54 (wymaga 1,474 nie 1,47).
export const STAWKI_IV_2026: Record<KlasyfikacjaKod, StawkiStrefowe> = {
  B: { s1_10: 8.46,  s11_20: 1.71, s21_30: 1.21,   s31_40: 3.01,   s41_60: 3.17   },
  C: { s1_10: 9.76,  s11_20: 2.02, s21_30: 1.474,  s31_40: 3.49,   s41_60: 3.66   },
  D: { s1_10: 12.68, s11_20: 3.83, s21_30: 8.29,   s31_40: 8.21,   s41_60: 5.53   },
  E: { s1_10: 12.68, s11_20: 3.83, s21_30: 8.29,   s31_40: 8.21,   s41_60: 5.53   },
  F: { s1_10: 36.58, s11_20: 3.66, s21_30: 2.684,  s31_40: 1.793,  s41_60: 10.285 },
  H: { s1_10: 27.15, s11_20: 2.77, s21_30: 3.7375, s31_40: 1.8745, s41_60: 8.878  },
};

/**
 * Zaokrąglenie matematyczne do pełnych km (0,5 w górę).
 * 14,0-14,4 → 14; 14,5-14,9 → 15.
 */
export function zaokraglKm(km: number): number {
  return Math.round(km);
}

/**
 * Koszt przejazdu X km typem T wg taryfikatora IV 2026.
 *
 * Zasady:
 * - Minimum 10 km: dystans < 10 km zawsze = pełna stawka za 10 km
 * - Powyżej 10 km: zaokrąglenie matematyczne do pełnych km przed obliczeniem
 * - Powyżej 60 km: suma do 60 km + (km-60) × stawka z zakresu 41-60
 *
 * Używane zarówno dla całego kółka, jak i per punkt (minimum 10 km aplikowane
 * per wywołanie — to świadoma decyzja biznesowa).
 */
export function kosztKolka(kmRaw: number, klasyfikacja: KlasyfikacjaKod): number {
  if (kmRaw < 0) return 0;
  const s = STAWKI_IV_2026[klasyfikacja];
  if (!s) return 0;

  // Minimum 10 km + zaokrąglenie matematyczne
  const km = Math.max(10, zaokraglKm(kmRaw));

  let koszt = Math.min(km, 10) * s.s1_10;
  if (km > 10) koszt += Math.min(km - 10, 10) * s.s11_20;
  if (km > 20) koszt += Math.min(km - 20, 10) * s.s21_30;
  if (km > 30) koszt += Math.min(km - 30, 10) * s.s31_40;
  if (km > 40) koszt += Math.min(km - 40, 20) * s.s41_60;
  if (km > 60) koszt += (km - 60) * s.s41_60; // kontynuacja stawki 41-60

  // Zaokrąglenie do 2 miejsc (grosze)
  return Math.round(koszt * 100) / 100;
}

/** Sprawdź czy klasyfikacja jest obsługiwana przez taryfikator rozliczeniowy */
export function isKlasyfikacjaRozliczalna(kod: string | null | undefined): kod is KlasyfikacjaKod {
  return kod === 'B' || kod === 'C' || kod === 'D' || kod === 'E' || kod === 'F' || kod === 'H';
}
