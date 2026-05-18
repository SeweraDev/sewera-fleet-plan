/**
 * Walidacja czy towar fizycznie zmieści się w pace auta.
 *
 * Dane wymiarów paki + limity paletowe/styropianowe są w tabeli `flota`
 * (kolumny dl_paki_cm, szer_paki_cm, wys_paki_cm, miejsc_paletowych,
 * xps_paczek, eps_paczek). Migracja 18.05.2026.
 *
 * Tolerancja: maxWymiar towaru musi być ≤ dł_paki_cm × 10 (cm → mm).
 * Wymiary paki w arkuszu Sewery są zaokrąglone w górę z tolerancją 10cm.
 */

/** Subset kolumn `flota` używany do walidacji wymiarów. */
export interface PojazdWymiary {
  nr_rej: string;
  typ: string;
  ladownosc_kg: number;
  dl_paki_cm: number | null;
  szer_paki_cm: number | null;
  wys_paki_cm: number | null;
  miejsc_paletowych: number | null;
  xps_paczek: number | null;
  eps_paczek: number | null;
}

export interface WynikWalidacji {
  ok: boolean;
  /** Powód odrzucenia (gdy ok=false). */
  powod?: string;
  /** Sygnał ostrzeżenia (gdy ok=true ale wartość blisko limitu, np. 95% paki). */
  ostrzezenie?: string;
}

/**
 * Sprawdza czy towar o danym max wymiarze (mm) zmieści się w pace auta.
 *
 * Zwraca:
 *  - ok=true gdy paka mieści towar z marginesem >5cm
 *  - ok=true + ostrzezenie gdy mieści ale ciasno (margines ≤5cm)
 *  - ok=false + powod gdy nie mieści (max > dł_paki)
 *  - ok=true gdy brak danych o pace (NULL) — nie blokujemy, tylko bez gwarancji
 *
 * @param pojazd dane wymiarów z tabeli flota
 * @param maxWymiarMm najdłuższy wymiar towaru w mm (z getMaxWymiarMm w wzAutoFill)
 */
export function czyAutoZmiesciTowar(
  pojazd: PojazdWymiary,
  maxWymiarMm: number,
): WynikWalidacji {
  if (maxWymiarMm <= 0) return { ok: true };
  if (pojazd.dl_paki_cm == null) {
    return { ok: true, ostrzezenie: `Brak wymiarów paki dla ${pojazd.nr_rej} — sprawdź ręcznie` };
  }
  const dlPakiMm = pojazd.dl_paki_cm * 10;
  if (maxWymiarMm > dlPakiMm) {
    const wystaje = maxWymiarMm - dlPakiMm;
    return {
      ok: false,
      powod: `Towar ${(maxWymiarMm / 1000).toFixed(1)}m dłuższy niż paka ${(dlPakiMm / 1000).toFixed(1)}m (${pojazd.nr_rej}, wystaje ${wystaje}mm)`,
    };
  }
  if (maxWymiarMm > dlPakiMm - 50) {
    // margines < 5cm → ciasno (uwaga na towar wystający lekko poza paletę)
    return {
      ok: true,
      ostrzezenie: `Towar ${(maxWymiarMm / 1000).toFixed(2)}m blisko limitu paki ${(dlPakiMm / 1000).toFixed(2)}m (${pojazd.nr_rej})`,
    };
  }
  return { ok: true };
}

/**
 * Filtruje listę aut do tych, w których towar fizycznie się zmieści.
 * Auta z NULL dł_paki_cm są PRZECHODZĄ (brak danych ≠ brak miejsca).
 */
export function filtrujPojazdyZmieszczace<T extends PojazdWymiary>(
  pojazdy: T[],
  maxWymiarMm: number,
): T[] {
  if (maxWymiarMm <= 0) return pojazdy;
  return pojazdy.filter((p) => czyAutoZmiesciTowar(p, maxWymiarMm).ok);
}
