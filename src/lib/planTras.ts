/**
 * Auto-planowanie tras dla dyspozytora.
 *
 * Algorytm: Savings (Clarke-Wright) + 2-opt local search.
 * Wejscie: niezaplanowane zlecenia z dnia/oddzialu, dostepne pojazdy, kierowcy.
 * Wyjscie: lista proponowanych kursow (auto, kierowca, kolejnosc przystankow,
 * km, kg, czas) + sekcja cross-branch + lista niezaplanowanych z powodem.
 *
 * Klasyfikacja typow pojazdow: zlecenie z wymaganym typem MUSI dostac auto
 * tego typu lub wiekszego (zgodnie z user feedback "wiekszy = lepszy"). Auto
 * jadace w danym kierunku dokladamy do niego inne zlecenia bez typu.
 *
 * Brak danych m³/palet -> proxy z wagi (PLAN_CONFIG.proxy_*). UI pokaze
 * ostrzezenie ktore zlecenia sa szacowane.
 */

import { PLAN_CONFIG, ZmianaKod, getZmiana, timeStrToMin } from '@/lib/planConfig';
import { haversineKm } from '@/lib/oddzialy-geo';

// ============================================================
// TYPY DANYCH
// ============================================================

/** Punkt geograficzny (oddzial lub adres klienta). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Pojedyncze zlecenie (z DB) z geo i danymi do planowania. */
export interface ZlecenieDoPlanu {
  zlecenie_id: string;
  numer: string;
  oddzial_id: number;
  typ_pojazdu: string | null;
  preferowana_godzina: string | null;
  /** Lista WZ scalonych w jednym zleceniu (suma kg, m³, palet). */
  wz_list: WzDoPlanu[];
}

export interface WzDoPlanu {
  wz_id: string;
  odbiorca: string;
  adres: string;
  lat: number;
  lng: number;
  masa_kg: number;
  /** null = brak danych, uzyjemy proxy z wagi */
  objetosc_m3: number | null;
  /** null = brak danych, uzyjemy proxy z wagi */
  ilosc_palet: number | null;
  klasyfikacja: string | null;
  uwagi: string | null;
}

/** Scalona "paczka" wszystkich zlecen pod tym samym adresem (np. Wolowicz 2x). */
export interface PaczkaPrzystankowa {
  klucz_adresu: string;
  odbiorca: string;
  adres: string;
  lat: number;
  lng: number;
  /** Suma kg wszystkich WZ pod tym adresem. */
  suma_kg: number;
  /** Suma m³ (liczona z proxy gdy brak danych). */
  suma_m3: number;
  /** Suma palet (liczona z proxy gdy brak danych). */
  suma_palet: number;
  /** Najwyzszy wymagany typ pojazdu wsrod scalonych zlecen (null = dowolny). */
  wymagany_typ: string | null;
  /** Jakakolwiek preferowana godzina (najwczesniejsza). */
  okno_godzina: string | null;
  /** Lista zrodlowych zlecen — do generowania kursu. */
  zlecenia: ZlecenieDoPlanu[];
  /** Lista zrodlowych WZ. */
  wz_ids: string[];
  /** Czy dane szacowane (m³ lub palety przez proxy)? Do UI ostrzezenia. */
  ma_proxy: boolean;
}

/** Pojazd dostepny do planowania. */
export interface PojazdSlot {
  flota_id: string | null;
  nr_rej: string;
  typ: string;
  ladownosc_kg: number;
  objetosc_m3: number | null;
  max_palet: number | null;
  is_zewnetrzny: boolean;
}

/** Kierowca dostepny + wybrana zmiana. */
export interface KierowcaSlot {
  kierowca_id: string;
  imie_nazwisko: string;
  zmiana: ZmianaKod;
  /** Czy ma uprawnienia HDS (z pola `uprawnienia` w DB). */
  ma_hds: boolean;
}

/** Pojedynczy proponowany kurs. */
export interface KursPropozycja {
  /** Unikatowe ID propozycji (uuid w UI, do akceptacji per kurs). */
  kurs_id_tmp: string;
  pojazd: PojazdSlot;
  kierowca: KierowcaSlot | null;
  /** Lista przystankow w kolejnosci optymalnej. */
  przystanki: PaczkaPrzystankowa[];
  km_total: number;
  /** Czas calkowity w minutach (zaladunek + jazda + obsluga + powrot). */
  czas_total_min: number;
  /** Suma kg wszystkich paczek. */
  suma_kg: number;
  suma_m3: number;
  suma_palet: number;
  /** Czas startu kursu (HH:MM, ze zmiany kierowcy). */
  start_czas: string;
}

/** Sugestia cross-branch dla zlecenia ktorego nie da sie obsluzyc w oddziale. */
export interface CrossBranchSugestia {
  paczka: PaczkaPrzystankowa;
  /** Oddzial ktory ma kompatybilne auto. */
  oddzial_docelowy: number;
  oddzial_nazwa: string;
  /** Powod oryginalny dla ktorego nie da sie zaplanowac w obecnym oddziale. */
  powod: string;
  /** Szacowana odleglosc dojazdu dodatkowego (km). 0 = ten sam adres bazowy (KAT↔R). */
  km_dojazdu: number;
}

/** Niezaplanowane zlecenia + powod. */
export interface Niezaplanowane {
  paczka: PaczkaPrzystankowa;
  powod: string;
}

export interface PlanResult {
  kursy: KursPropozycja[];
  crossBranch: CrossBranchSugestia[];
  niezaplanowane: Niezaplanowane[];
  /** Liczba paczek z proxy (dla UI ostrzezenia). */
  liczba_z_proxy: number;
}

export interface PlanInput {
  oddzial_id: number;
  oddzial_nazwa: string;
  oddzial_baza: GeoPoint;
  dzien: string;
  zlecenia: ZlecenieDoPlanu[];
  pojazdy: PojazdSlot[];
  kierowcy: KierowcaSlot[];
}

// ============================================================
// SCALANIE TYCH SAMYCH ADRESOW (Wolowicz 2x -> 1 paczka)
// ============================================================

/** Klucz adresu do scalania — normalizacja whitespace + lowercase. */
function normalizeAdres(adres: string): string {
  return adres
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[,;]+/g, ',')
    .trim();
}

/** Hierarchia typow — wiekszy moze obsluzyc mniejszy. */
const TYP_RANK: Record<string, number> = {
  'Dostawczy 1,2t': 1,
  'Winda 1,8t': 2,
  'Winda 6,3t': 3,
  'Winda MAX': 4,
  'HDS 9,0t': 5,
  'HDS 12,0t': 6,
};

function rankTypu(typ: string | null): number {
  if (!typ) return 0;
  // Strip prefix "zew:" jesli jest
  const t = typ.replace(/^zew:/, '').trim();
  return TYP_RANK[t] ?? 0;
}

/** Wybierz "wiekszy" z dwoch typow (lub null gdy oba puste). */
function maxTyp(a: string | null, b: string | null): string | null {
  const ra = rankTypu(a);
  const rb = rankTypu(b);
  if (ra === 0 && rb === 0) return null;
  return ra >= rb ? a : b;
}

/** Scal zlecenia tego samego adresu w paczki przystankowe. */
export function scalAdresy(zlecenia: ZlecenieDoPlanu[]): PaczkaPrzystankowa[] {
  const mapa = new Map<string, PaczkaPrzystankowa>();
  for (const zl of zlecenia) {
    for (const wz of zl.wz_list) {
      const klucz = normalizeAdres(wz.adres);
      const istnieje = mapa.get(klucz);

      // Liczymy m³ i palety: realne lub proxy z wagi
      const m3_realne = wz.objetosc_m3;
      const palet_realne = wz.ilosc_palet;
      const m3_eff = m3_realne ?? wz.masa_kg * PLAN_CONFIG.proxy_m3_per_kg;
      const palet_eff = palet_realne ?? wz.masa_kg * PLAN_CONFIG.proxy_palet_per_kg;
      const ma_proxy = m3_realne == null || palet_realne == null;

      if (istnieje) {
        istnieje.suma_kg += wz.masa_kg;
        istnieje.suma_m3 += m3_eff;
        istnieje.suma_palet += palet_eff;
        istnieje.wymagany_typ = maxTyp(istnieje.wymagany_typ, zl.typ_pojazdu);
        // Najwczesniejsza preferowana godzina
        if (zl.preferowana_godzina && (!istnieje.okno_godzina || zl.preferowana_godzina < istnieje.okno_godzina)) {
          istnieje.okno_godzina = zl.preferowana_godzina;
        }
        if (!istnieje.zlecenia.find((z) => z.zlecenie_id === zl.zlecenie_id)) {
          istnieje.zlecenia.push(zl);
        }
        istnieje.wz_ids.push(wz.wz_id);
        if (ma_proxy) istnieje.ma_proxy = true;
      } else {
        mapa.set(klucz, {
          klucz_adresu: klucz,
          odbiorca: wz.odbiorca,
          adres: wz.adres,
          lat: wz.lat,
          lng: wz.lng,
          suma_kg: wz.masa_kg,
          suma_m3: m3_eff,
          suma_palet: palet_eff,
          wymagany_typ: zl.typ_pojazdu || null,
          okno_godzina: zl.preferowana_godzina || null,
          zlecenia: [zl],
          wz_ids: [wz.wz_id],
          ma_proxy,
        });
      }
    }
  }
  // Zaokraglaj sumy
  for (const p of mapa.values()) {
    p.suma_m3 = Math.round(p.suma_m3 * 10) / 10;
    p.suma_palet = Math.ceil(p.suma_palet);
  }
  return Array.from(mapa.values());
}

// ============================================================
// DISTANCE MATRIX (OSRM table service)
// ============================================================

/**
 * Pobierz macierz odleglosci (km) i czasow jazdy (min) dla N punktow.
 * Uzywa OSRM /table/v1/ co pozwala na 1 zapytanie zamiast N².
 *
 * Fallback gdy OSRM padnie: haversine × 1.4 (typowe dla Polski miejskiej/wiejskiej).
 *
 * @returns { km: number[][], minuty: number[][] } gdzie [i][j] = z i do j
 */
export async function buildDistanceMatrix(
  points: GeoPoint[]
): Promise<{ km: number[][]; minuty: number[][] }> {
  const n = points.length;
  if (n === 0) return { km: [], minuty: [] };

  // Empty matrix init
  const km: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const minuty: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  // OSRM table service
  try {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.distances && data.durations) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const d_m = data.distances[i][j]; // metry
          const t_s = data.durations[i][j]; // sekundy
          if (d_m != null && t_s != null) {
            // Korekta x1.1 dla zgodnosci z reszta systemu (krotkie dystanse)
            const km_raw = d_m / 1000;
            const km_korekta = km_raw < 20 ? km_raw * 1.1 : km_raw;
            km[i][j] = Math.round(km_korekta * 10) / 10;
            minuty[i][j] = Math.round(t_s / 60);
          } else {
            // OSRM brak — fallback haversine
            const h = haversineKm(points[i], points[j]) * 1.4;
            km[i][j] = Math.round(h * 10) / 10;
            minuty[i][j] = Math.round((h / 50) * 60); // zalozenie 50 km/h
          }
        }
      }
      console.log(`[planTras] distance matrix OSRM OK (${n}x${n})`);
      return { km, minuty };
    }
    console.warn('[planTras] OSRM table service brak danych — fallback haversine');
  } catch (e) {
    console.warn('[planTras] OSRM error — fallback haversine:', e);
  }

  // Fallback: haversine × 1.4 dla wszystkich par
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const h = haversineKm(points[i], points[j]) * 1.4;
      km[i][j] = Math.round(h * 10) / 10;
      minuty[i][j] = Math.round((h / 50) * 60);
    }
  }
  return { km, minuty };
}

// ============================================================
// PLACEHOLDER dla glownego algorytmu (Faza 2b)
// ============================================================

/**
 * Glowna funkcja planowania — Faza 2b doda Savings + 2-opt + capacity.
 * Ten plik jest WIP.
 */
export async function planTras(input: PlanInput): Promise<PlanResult> {
  const paczki = scalAdresy(input.zlecenia);
  console.log(`[planTras] scalono ${input.zlecenia.length} zlecen w ${paczki.length} paczek`);
  return {
    kursy: [],
    crossBranch: [],
    niezaplanowane: paczki.map((p) => ({ paczka: p, powod: 'Algorytm WIP — Faza 2b' })),
    liczba_z_proxy: paczki.filter((p) => p.ma_proxy).length,
  };
}

// Pomocnicze do testowania jednostkowego (export internal helpers)
export { normalizeAdres, rankTypu, maxTyp };
// timeStrToMin reexport dla wygody w UI
export { timeStrToMin };
// PLAN_CONFIG i getZmiana reexport zeby UI nie musial importu z dwoch plikow
export { PLAN_CONFIG, getZmiana };
