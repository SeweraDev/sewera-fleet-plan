/**
 * Konfiguracja auto-planowania tras dla dyspozytora.
 *
 * Wartosci domyslne ustalone z user'em (sesja 29.04):
 *   - rozladunek: 20 min/przystanek
 *   - zaladunek w bazie: 30 min (raz na poczatku kursu)
 *   - 3 zmiany kierowcy (8h każda): RANNA, POSREDNIA, NORMAL
 *   - max 8h normalnej pracy, 9h jako fallback (norma)
 *   - auto wraca do bazy po ostatnim przystanku
 *
 * Te wartosci nie sa w DB — sa stałymi systemowymi. Mozna je ewentualnie
 * przeniesc do tabeli `oddzial_config` w przyszlosci, jak będzie potrzeba
 * roznicowania per oddzial.
 */

export const PLAN_CONFIG = {
  /** Czas rozladunku u klienta (min). Default dla wszystkich przystankow. */
  czas_rozladunku_min: 20,
  /** Czas zaladunku w bazie (min). Liczone raz, na poczatku kursu. */
  czas_zaladunku_min: 30,
  /** Maksymalna dzienna praca kierowcy (min) — 8 godzin. */
  max_pracy_min: 480,
  /** Maksymalna praca z nadgodzina (min) — 9 godzin. Fallback gdy 8h nie wystarcza. */
  max_pracy_z_nadgodzina_min: 540,
  /** Czy auto wraca do bazy po ostatnim przystanku? */
  auto_wraca_do_bazy: true,
  /** Proxy m³ z wagi gdy brak: kg / 200 (srednia gestosc paczki). */
  proxy_m3_per_kg: 1 / 200,
  /** Proxy palet z wagi gdy brak: kg / 600 (1 paleta EUR ~ 600 kg srednio). */
  proxy_palet_per_kg: 1 / 600,
  /** Promien (km) szukania sasiednich oddzialow dla cross-branch sugestii. */
  cross_branch_radius_km: 30,
} as const;

/** 3 schematy zmian kierowcy. Dyspozytor wybiera w modalu Auto-plan per kierowca. */
export const ZMIANY = [
  { kod: 'RANNA',    label: '6:00 – 14:00',  start: '06:00', koniec: '14:00' },
  { kod: 'POSREDNIA', label: '6:30 – 14:30', start: '06:30', koniec: '14:30' },
  { kod: 'NORMAL',   label: '7:00 – 15:00',  start: '07:00', koniec: '15:00' },
] as const;

export type ZmianaKod = typeof ZMIANY[number]['kod'];

/** Default zmiana dla nowego kierowcy w modalu. */
export const ZMIANA_DEFAULT: ZmianaKod = 'NORMAL';

/** Konwersja "HH:MM" -> minuty od polnocy. */
export function timeStrToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Konwersja minut od polnocy -> "HH:MM". */
export function minToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Pobierz konfiguracje zmiany po kodzie. */
export function getZmiana(kod: ZmianaKod) {
  return ZMIANY.find((z) => z.kod === kod) ?? ZMIANY[2];
}

/** Czas pracy zmiany w minutach. */
export function zmianaMinuty(kod: ZmianaKod): number {
  const z = getZmiana(kod);
  return timeStrToMin(z.koniec) - timeStrToMin(z.start);
}
