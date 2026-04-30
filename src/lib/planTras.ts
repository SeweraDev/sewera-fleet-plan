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

import { PLAN_CONFIG, ZmianaKod, getZmiana, timeStrToMin, zmianaMinuty } from '@/lib/planConfig';
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
  /** Czas juz zajety w innych kursach dnia (min). 0 = wolny. */
  czas_zajety_min?: number;
}

/** Kierowca dostepny + wybrana zmiana. */
export interface KierowcaSlot {
  kierowca_id: string;
  imie_nazwisko: string;
  zmiana: ZmianaKod;
  /** Czy ma uprawnienia HDS (z pola `uprawnienia` w DB). */
  ma_hds: boolean;
  /** Czas juz zajety w innych kursach dnia (min). 0 = wolny. */
  czas_zajety_min?: number;
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

/** Sugestia cross-branch — przekaz do innego oddzialu ktory JUZ JEDZIE w tamtym kierunku. */
export interface CrossBranchSugestia {
  paczka: PaczkaPrzystankowa;
  /** Oddzial ktory ma kurs w tym kierunku. */
  oddzial_docelowy: number;
  oddzial_nazwa: string;
  /** Powod oryginalny dla ktorego nie da sie zaplanowac u nas. */
  powod: string;
  /** Numer kursu obcego oddzialu do ktorego dorzucamy. */
  kurs_docelowy_numer?: string | null;
  /** Kierowca obcego kursu (info dla dyspozytora). */
  kierowca_docelowy_nazwa?: string | null;
  /** Pojazd obcego kursu. */
  pojazd_docelowy_nr_rej?: string | null;
  /** Odleglosc do najblizszego przystanku obcego kursu (km). */
  najblizszy_przystanek_km: number;
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
  /**
   * Algorytm budowania tras wewnątrz jednej iteracji kurs/pojazd:
   * - 'savings' (default) — Clarke-Wright savings + 2-opt (dotychczasowy)
   * - 'clustering' — kotwica + objazd (nowy, wg decyzji user'a 30.04)
   */
  algorytm?: 'savings' | 'clustering';
  /** Limit objazdu w km dla algorytmu 'clustering'. Default 5. */
  max_objazd_km?: number;
}

// ============================================================
// SCALANIE TYCH SAMYCH ADRESOW (Wolowicz 2x -> 1 paczka)
// ============================================================

/** Klucz adresu do scalania — normalizacja whitespace + lowercase + usuniecie cudzyslowow. */
function normalizeAdres(adres: string): string {
  return adres
    .toLowerCase()
    .replace(/["'„""'']/g, '') // usun rozne typy cudzyslowow
    .replace(/\s+/g, ' ')
    .replace(/[,;]+/g, ',')
    .trim();
}

/** Klucz geolokalizacji — zaokraglenie do 4 miejsc po przecinku (~10m precision). */
function kluczGeo(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Hierarchia typow — wiekszy moze obsluzyc mniejszy W TEJ SAMEJ RODZINIE. */
const TYP_RANK: Record<string, number> = {
  'Dostawczy 1,2t': 1,
  'Winda 1,8t': 2,
  'Winda 6,3t': 3,
  'Winda MAX': 4,
  'Winda MAX 15,8t': 4,
  'HDS 8,9t': 5,
  'HDS 9,0t': 5,
  'HDS 9,1t': 5,
  'HDS 11,7t': 6,
  'HDS 12,0t': 6,
  'HDS 12T': 6,
};

/**
 * Rodziny pojazdów. STRICT match miedzy rodzinami — np. klient wymagajacy
 * Dostawczy 1,2t (waska uliczka) NIE zostanie obsluzony przez Winde czy HDS,
 * bo wieksze auto tam nie wjedzie. Wewnatrz rodziny wiekszy moze zastapic
 * mniejszy (Winda MAX zamiast Winda 1,8t, HDS 12 zamiast HDS 9).
 */
const TYP_RODZINA: Record<string, string> = {
  'Dostawczy 1,2t': 'Dostawczy',
  'Winda 1,8t': 'Winda',
  'Winda 6,3t': 'Winda',
  'Winda MAX': 'Winda',
  'Winda MAX 15,8t': 'Winda',
  'HDS 8,9t': 'HDS',
  'HDS 9,0t': 'HDS',
  'HDS 9,1t': 'HDS',
  'HDS 11,7t': 'HDS',
  'HDS 12,0t': 'HDS',
  'HDS 12T': 'HDS',
};

function stripTyp(typ: string | null): string {
  if (!typ) return '';
  return typ.replace(/^zew:/, '').trim();
}

function rankTypu(typ: string | null): number {
  return TYP_RANK[stripTyp(typ)] ?? 0;
}

function rodzinaTypu(typ: string | null): string | null {
  return TYP_RODZINA[stripTyp(typ)] ?? null;
}

/** Wybierz "wiekszy" z dwoch typow (lub null gdy oba puste). */
function maxTyp(a: string | null, b: string | null): string | null {
  const ra = rankTypu(a);
  const rb = rankTypu(b);
  if (ra === 0 && rb === 0) return null;
  return ra >= rb ? a : b;
}

/**
 * Scal zlecenia tego samego adresu w paczki przystankowe.
 *
 * Klucz scalania: lat/lng z geokodowania (zaokrąglone do 4 miejsc po przecinku
 * = ~10m). Dla niezgokodowanych (lat=0, lng=0) fallback na znormalizowany adres
 * (lowercase + bez cudzyslowow + scalanie whitespace).
 *
 * Dzieki kluczowi lat/lng radzimy sobie z OCR errors typu "ul. Mostowa 2" vs
 * "ul. M 2" — Photon geokoduje oba do tego samego punktu.
 */
export function scalAdresy(zlecenia: ZlecenieDoPlanu[]): PaczkaPrzystankowa[] {
  const mapa = new Map<string, PaczkaPrzystankowa>();
  for (const zl of zlecenia) {
    for (const wz of zl.wz_list) {
      const klucz = wz.lat && wz.lng
        ? kluczGeo(wz.lat, wz.lng)
        : normalizeAdres(wz.adres);
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
// CAPACITY CHECK — czy paczka(i) miesci sie w pojezdzie
// ============================================================

/**
 * Czy pojazd P moze obsluzyc paczke pod katem typu?
 *
 * Logika ranking-based: 'wiekszy moze obsluzyc mniejszy' (zgodnie z faktycznym
 * workflow user'a — np. ZL-KAT/.../007 [Dostawczy 1,2t] dla MEGRES SZPITAL TYCHY
 * pojechalo Winda 6,3t bez problemu).
 *
 * - typ wymagany pusty -> dowolne auto OK
 * - typ wymagany podany -> rank pojazdu >= rank wymagany
 *
 * UWAGA: jesli klient ma TWARDY wymog (waska uliczka, ramp HDS itp.), trzeba
 * dodac dedykowane pole 'twardy_wymog' w zleceniu (przyszla iteracja).
 * Aktualnie sam typ_pojazdu jest 'preferowany typ' / klasa.
 */
function pojazdSpelniaTyp(pojazd: PojazdSlot, paczka: PaczkaPrzystankowa): boolean {
  if (!paczka.wymagany_typ) return true; // dowolny typ
  // Strict family match — Dostawczy = waska uliczka (twardy maks),
  // Winda = wymaga windy do rozladunku, HDS = wymaga dzwigu.
  // Wieksze auto z innej rodziny NIE zastapi (np. MAX nie wjedzie w
  // waska uliczke do 1,2t, Dostawczy nie ma windy ani dzwigu).
  const rP = rodzinaTypu(paczka.wymagany_typ);
  const rV = rodzinaTypu(pojazd.typ);
  if (rP !== rV) return false;
  // W ramach tej samej rodziny — wiekszy moze zastapic mniejszy
  return rankTypu(pojazd.typ) >= rankTypu(paczka.wymagany_typ);
}

/** Czy suma paczek miesci sie w pojezdzie (kg + m³ + palety)? */
function miesciSieWPojezdzie(
  pojazd: PojazdSlot,
  paczki: PaczkaPrzystankowa[]
): boolean {
  let sum_kg = 0;
  let sum_m3 = 0;
  let sum_palet = 0;
  for (const p of paczki) {
    sum_kg += p.suma_kg;
    sum_m3 += p.suma_m3;
    sum_palet += p.suma_palet;
  }
  if (sum_kg > pojazd.ladownosc_kg) return false;
  if (pojazd.objetosc_m3 != null && sum_m3 > pojazd.objetosc_m3) return false;
  if (pojazd.max_palet != null && sum_palet > pojazd.max_palet) return false;
  return true;
}

// ============================================================
// CZAS KURSU — zaladunek + jazda + obsluga + powrot
// ============================================================

/**
 * Oblicz czas calkowity kursu w minutach.
 * Sekwencja: [base, p[0], p[1], ..., p[n-1], base?]
 *
 * @param indeksyPaczek kolejnosc paczek (indeksy w distMin matrix, gdzie 0 = baza)
 */
function obliczCzasKursu(
  indeksyPaczek: number[],
  distMin: number[][],
  wracaDoBazy: boolean
): number {
  let czas = PLAN_CONFIG.czas_zaladunku_min;
  let prev = 0; // baza
  for (const idx of indeksyPaczek) {
    czas += distMin[prev][idx];
    czas += PLAN_CONFIG.czas_rozladunku_min;
    prev = idx;
  }
  if (wracaDoBazy && indeksyPaczek.length > 0) {
    czas += distMin[prev][0];
  }
  return czas;
}

/**
 * Oblicz km calkowite trasy.
 */
function obliczKmKursu(
  indeksyPaczek: number[],
  distKm: number[][],
  wracaDoBazy: boolean
): number {
  let km = 0;
  let prev = 0;
  for (const idx of indeksyPaczek) {
    km += distKm[prev][idx];
    prev = idx;
  }
  if (wracaDoBazy && indeksyPaczek.length > 0) {
    km += distKm[prev][0];
  }
  return Math.round(km * 10) / 10;
}

// ============================================================
// SAVINGS ALGORITHM (Clarke-Wright)
// ============================================================
// Idea: zacznij z kazda paczka jako osobny kurs (baza-paczka-baza). Policz
// "savings(i,j) = dist(0,i) + dist(0,j) - dist(i,j)" — ile zaoszczedzimy
// jesli polaczymy te dwa kursy w jeden. Sortuj po malejacych savings,
// dla kazdej pary sprob polaczyc trasy (przestrzegajac capacity + czas pracy).

interface Trasa {
  paczki: number[]; // indeksy w paczki[] (1-based, bo 0=baza w distMin)
}

function savingsAlgorithm(
  paczki: PaczkaPrzystankowa[],
  pojazd: PojazdSlot,
  distKm: number[][],
  distMin: number[][],
  maxCzasMin: number,
  wracaDoBazy: boolean
): Trasa[] {
  const n = paczki.length;
  if (n === 0) return [];

  // Filtruj paczki ktore w ogole pasuja do tego pojazdu (typ wymagany + capacity 1 paczki)
  const dostepne: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!pojazdSpelniaTyp(pojazd, paczki[i])) continue;
    if (!miesciSieWPojezdzie(pojazd, [paczki[i]])) continue;
    dostepne.push(i);
  }
  if (dostepne.length === 0) return [];

  // Start: kazda paczka = osobna trasa
  const trasy: Trasa[] = dostepne.map((i) => ({ paczki: [i + 1] })); // +1 bo 0=baza

  // Liczymy savings dla kazdej pary
  type Saving = { i: number; j: number; value: number };
  const savings: Saving[] = [];
  for (let a = 0; a < dostepne.length; a++) {
    for (let b = a + 1; b < dostepne.length; b++) {
      const i = dostepne[a] + 1;
      const j = dostepne[b] + 1;
      const s = distKm[0][i] + distKm[0][j] - distKm[i][j];
      savings.push({ i, j, value: s });
    }
  }
  savings.sort((a, b) => b.value - a.value);

  // Helper: znajdz trase zawierajaca dany indeks paczki
  const findTrasa = (idx: number): { trasa: Trasa; pozycja: 'start' | 'end' | 'mid' | null } => {
    for (const t of trasy) {
      const pos = t.paczki.indexOf(idx);
      if (pos === -1) continue;
      if (pos === 0) return { trasa: t, pozycja: 'start' };
      if (pos === t.paczki.length - 1) return { trasa: t, pozycja: 'end' };
      return { trasa: t, pozycja: 'mid' };
    }
    return { trasa: null as any, pozycja: null };
  };

  // Probuj laczyc pary w kolejnosci malejacych savings
  for (const s of savings) {
    if (s.value <= 0) break;
    const ti = findTrasa(s.i);
    const tj = findTrasa(s.j);
    if (!ti.trasa || !tj.trasa) continue;
    if (ti.trasa === tj.trasa) continue;
    // Polaczenie mozliwe tylko gdy oba sa na koncach tras (start/end)
    if (ti.pozycja === 'mid' || tj.pozycja === 'mid') continue;

    // Konstruuj polaczona trase: i na koncu, j na poczatku (lub odwracaj)
    let nowa: number[];
    if (ti.pozycja === 'end' && tj.pozycja === 'start') {
      nowa = [...ti.trasa.paczki, ...tj.trasa.paczki];
    } else if (ti.pozycja === 'start' && tj.pozycja === 'end') {
      nowa = [...tj.trasa.paczki, ...ti.trasa.paczki];
    } else if (ti.pozycja === 'end' && tj.pozycja === 'end') {
      nowa = [...ti.trasa.paczki, ...tj.trasa.paczki.slice().reverse()];
    } else {
      nowa = [...ti.trasa.paczki.slice().reverse(), ...tj.trasa.paczki];
    }

    // Sprawdz capacity calkowita
    const paczkiNowe = nowa.map((idx) => paczki[idx - 1]);
    if (!miesciSieWPojezdzie(pojazd, paczkiNowe)) continue;
    // Sprawdz czas calkowity
    const czas = obliczCzasKursu(nowa, distMin, wracaDoBazy);
    if (czas > maxCzasMin) continue;

    // OK — laczymy. Usun obie stare trasy, dodaj nowa.
    const idxI = trasy.indexOf(ti.trasa);
    if (idxI >= 0) trasy.splice(idxI, 1);
    const idxJ = trasy.indexOf(tj.trasa);
    if (idxJ >= 0) trasy.splice(idxJ, 1);
    trasy.push({ paczki: nowa });
  }

  return trasy;
}

// ============================================================
// CLUSTERING ALGORITHM (kotwica + objazd) — alternatywa do Savings
// ============================================================
// Idea biznesowa (decyzja usera 30.04):
// 1. Wybierz najdalsza paczka kompatybilna z pojazdem = KOTWICA (cel trasy)
// 2. Dla kazdej innej paczki sprawdz cheapest insertion w trase:
//    objazd = dist(before,X) + dist(X,after) - dist(before,after)
//    Jesli najlepszy objazd <= MAX_OBJAZD_KM -> dorzuc na tej pozycji
// 3. Pakuj az capacity (kg/m3/palety) lub czas pracy sie zapcha
// 4. 2-opt na koncu zeby zoptymalizowac kolejnosc

function clusteringAlgorithm(
  paczki: PaczkaPrzystankowa[],
  pojazd: PojazdSlot,
  distKm: number[][],
  distMin: number[][],
  maxCzasMin: number,
  wracaDoBazy: boolean,
  maxObjazdKm: number
): Trasa[] {
  // 1. Filtruj paczki kompatybilne z pojazdem (typowo + capacity per paczka)
  const idxKompat: number[] = [];
  for (let i = 0; i < paczki.length; i++) {
    if (!pojazdSpelniaTyp(pojazd, paczki[i])) continue;
    if (!miesciSieWPojezdzie(pojazd, [paczki[i]])) continue;
    idxKompat.push(i + 1); // distMin: 0 = baza, 1..N = paczki
  }
  if (idxKompat.length === 0) return [];

  // 2. KOTWICA = paczka najdalej od bazy (po km)
  let kotwicaIdx = idxKompat[0];
  let najdalej = distKm[0][kotwicaIdx];
  for (const idx of idxKompat) {
    if (distKm[0][idx] > najdalej) {
      najdalej = distKm[0][idx];
      kotwicaIdx = idx;
    }
  }

  // 3. Inicjalizuj trase: [kotwica]
  let trasa: number[] = [kotwicaIdx];
  const dodane = new Set<number>([kotwicaIdx]);
  let sum_kg = paczki[kotwicaIdx - 1].suma_kg;
  let sum_m3 = paczki[kotwicaIdx - 1].suma_m3;
  let sum_palet = paczki[kotwicaIdx - 1].suma_palet;

  // 4. Iteracyjnie dorzucaj paczki o najmniejszym objezdzie
  while (true) {
    let bestIdx: number | null = null;
    let bestPos: number | null = null;
    let bestObjazd = Infinity;

    for (const idx of idxKompat) {
      if (dodane.has(idx)) continue;
      const p = paczki[idx - 1];
      if (sum_kg + p.suma_kg > pojazd.ladownosc_kg) continue;
      if (pojazd.objetosc_m3 != null && sum_m3 + p.suma_m3 > pojazd.objetosc_m3) continue;
      if (pojazd.max_palet != null && sum_palet + p.suma_palet > pojazd.max_palet) continue;

      // Cheapest insertion: dla kazdej pozycji policz objazd
      for (let pos = 0; pos <= trasa.length; pos++) {
        const before = pos === 0 ? 0 : trasa[pos - 1];
        // after: gdy pos === trasa.length to liczymy do bazy (jesli wracaDoBazy)
        const after = pos === trasa.length
          ? (wracaDoBazy ? 0 : null)
          : trasa[pos];
        const oryg = after === null ? 0 : distKm[before][after];
        const noweDoBefore = distKm[before][idx];
        const noweDoAfter = after === null ? 0 : distKm[idx][after];
        const objazd = noweDoBefore + noweDoAfter - oryg;
        if (objazd < bestObjazd) {
          bestObjazd = objazd;
          bestIdx = idx;
          bestPos = pos;
        }
      }
    }

    if (bestIdx == null || bestPos == null) break;
    if (bestObjazd > maxObjazdKm) break;

    // Wstaw kandydata
    const noweTrasa = [...trasa.slice(0, bestPos), bestIdx, ...trasa.slice(bestPos)];
    const czasMin = obliczCzasKursu(noweTrasa, distMin, wracaDoBazy);
    if (czasMin > maxCzasMin) break; // czas pracy przekroczony — zatrzymaj

    trasa = noweTrasa;
    dodane.add(bestIdx);
    const p = paczki[bestIdx - 1];
    sum_kg += p.suma_kg;
    sum_m3 += p.suma_m3;
    sum_palet += p.suma_palet;
  }

  // 5. 2-opt
  const optTrasa = twoOpt(trasa, distKm);

  return [{ paczki: optTrasa }];
}

// ============================================================
// 2-OPT LOCAL SEARCH — popraw kolejnosc w kazdej trasie
// ============================================================

function twoOpt(trasa: number[], distKm: number[][]): number[] {
  if (trasa.length < 3) return trasa;
  let best = trasa.slice();
  let improved = true;
  // Pelna ścieżka: 0 (baza) -> trasa -> 0 (baza). Liczymy z wstawionymi 0.
  const totalKm = (route: number[]) => {
    let km = 0;
    let prev = 0;
    for (const idx of route) {
      km += distKm[prev][idx];
      prev = idx;
    }
    km += distKm[prev][0];
    return km;
  };
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = best.slice();
        // Odwroc segment [i, j]
        const seg = candidate.slice(i, j + 1).reverse();
        candidate.splice(i, j - i + 1, ...seg);
        if (totalKm(candidate) < totalKm(best)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

// ============================================================
// PRZYDZIAL KIEROWCY DO TRASY
// ============================================================
// Reguly:
// - Kierowca z uprawnieniami HDS moze prowadzic wszystko
// - Kierowca BEZ HDS nie moze HDS-a (typ pojazdu zawiera "HDS")
// - Czas trasy musi sie zmiescic w godzinach zmiany kierowcy

/**
 * Przydziel kierowce do trasy.
 *
 * Logika:
 * - Pojazd HDS wymaga kierowcy z HDS uprawnieniami
 * - Czas trasy + juz_zajety_czas_kierowcy <= czas_zmiany (8h normy)
 *   ALBO <= 9h (max z nadgodzina) jesli zmiana standardowa nie wystarcza
 * - W jednym zaplanowaniu auto-plan moze przydzielic kierowce do drugiego kursu
 *   jesli ma wolny czas (uzyciKierowcy.czas_uzyty_min)
 */
function przydzielKierowce(
  trasaCzasMin: number,
  pojazd: PojazdSlot,
  kierowcyDostepni: KierowcaSlot[],
  uzyciKierowcyCzas: Map<string, number>
): KierowcaSlot | null {
  const pojazdHDS = /HDS/.test(pojazd.typ);
  for (const k of kierowcyDostepni) {
    if (pojazdHDS && !k.ma_hds) continue;

    // Calkowity zajety czas = czas_zajety_min (z istniejacych kursow w DB) +
    // czas_uzyty_w_tej_sesji (kierowca dostal juz inny kurs auto-plan)
    const czasJuzZajety = (k.czas_zajety_min ?? 0) + (uzyciKierowcyCzas.get(k.kierowca_id) ?? 0);

    // Limity:
    // - Zwykla zmiana 8h (480 min) — pierwszy wybor
    // - Z nadgodzina 9h (540 min) — fallback gdy nie ma innego kierowcy
    const z = getZmiana(k.zmiana);
    const czasZmiany = timeStrToMin(z.koniec) - timeStrToMin(z.start);
    const limitMin = Math.max(czasZmiany, PLAN_CONFIG.max_pracy_z_nadgodzina_min);

    if (czasJuzZajety + trasaCzasMin > limitMin) continue;
    return k;
  }
  return null;
}

// ============================================================
// USTALANIE POWODU NIEZAPLANOWANEGO
// ============================================================
// Konkretny powod dla user'a (zamiast generycznego "brak miejsca").

function ustalPowodNiezaplanowanego(p: PaczkaPrzystankowa, input: PlanInput): string {
  // 1. Czy istnieje POJAZD ktory typowo i wagowo moze obsluzyc?
  const pojazdyKompatybilne = input.pojazdy.filter((pp) => pojazdSpelniaTyp(pp, p));
  if (pojazdyKompatybilne.length === 0) {
    if (p.wymagany_typ) {
      return `Wymagany typ pojazdu: ${p.wymagany_typ} (lub większy). Brak takiego pojazdu w oddziale.`;
    }
    return 'Brak pojazdu kompatybilnego z paczką';
  }

  // 2. Czy ktorys pojazd ma wystarczajaca pojemnosc kg?
  const maPojemnoscKg = pojazdyKompatybilne.some((pp) => pp.ladownosc_kg >= p.suma_kg);
  if (!maPojemnoscKg) {
    const maxKg = Math.max(...pojazdyKompatybilne.map((pp) => pp.ladownosc_kg));
    return `Waga ${Math.round(p.suma_kg)} kg przekracza pojemność największego dostępnego pojazdu (${maxKg} kg)`;
  }

  // 3. Czy jakis kompatybilny pojazd jest WOLNY (czas zajety < limit)?
  const limitMin = PLAN_CONFIG.max_pracy_z_nadgodzina_min;
  const wolnePojazdy = pojazdyKompatybilne.filter((pp) => (pp.czas_zajety_min ?? 0) < limitMin);
  if (wolnePojazdy.length === 0) {
    return 'Wszystkie kompatybilne pojazdy mają już pełny grafik dnia (≥9h)';
  }

  // 4. Czy jest kierowca z odpowiednimi uprawnieniami i czasem pracy?
  const wymagaHDS = wolnePojazdy.every((pp) => /HDS/.test(pp.typ));
  const kierowcyOk = input.kierowcy.filter((k) => {
    if (wymagaHDS && !k.ma_hds) return false;
    return (k.czas_zajety_min ?? 0) < limitMin;
  });
  if (kierowcyOk.length === 0) {
    if (wymagaHDS) {
      return 'Brak kierowcy z uprawnieniami HDS dostępnego w wybranych zmianach';
    }
    return 'Brak dostępnego kierowcy w wybranych zmianach (wszyscy mają pełny grafik)';
  }

  // 5. Inne — najpewniej za daleko / nie pasuje czasowo do istniejacej trasy
  return 'Paczka nie pasuje czasowo do żadnej dostępnej trasy';
}

// ============================================================
// GLOWNA FUNKCJA — planTras
// ============================================================

export async function planTras(input: PlanInput): Promise<PlanResult> {
  const t0 = performance.now();
  // 1. Scalanie tych samych adresow
  const paczki = scalAdresy(input.zlecenia);
  console.log(`[planTras] scalono ${input.zlecenia.length} zlecen w ${paczki.length} paczek`);

  if (paczki.length === 0) {
    return { kursy: [], crossBranch: [], niezaplanowane: [], liczba_z_proxy: 0 };
  }

  // 2. Distance matrix (baza + paczki)
  const punkty: GeoPoint[] = [input.oddzial_baza, ...paczki.map((p) => ({ lat: p.lat, lng: p.lng }))];
  const { km: distKm, minuty: distMin } = await buildDistanceMatrix(punkty);

  // 3. Pojazdy posortowane:
  //    - wlasne (Sewera) przed zewnetrznymi (oszczednosc - flota zewn jako fallback)
  //    - w obrebie tego samego = wieksza ladownosc_kg pierwsza
  //      (Winda MAX 15800 > HDS 12 11700 > HDS 9 8900 > Winda 6,3 6300 > Dostawczy 1100)
  //    - dzieki temu duze auto bedzie pelne zanim algorytm wezmie mniejsze (efekt
  //      zakupu Windy MAX zeby robic 1 kolko zamiast 2x mniejszym)
  const pojazdySorted = [...input.pojazdy].sort((a, b) => {
    if (a.is_zewnetrzny !== b.is_zewnetrzny) return a.is_zewnetrzny ? 1 : -1;
    return b.ladownosc_kg - a.ladownosc_kg;
  });

  const kursy: KursPropozycja[] = [];
  const niezaplanowane: Niezaplanowane[] = [];
  // Czas juz uzyty per kierowca w TEJ SESJI auto-planu (oprocz czas_zajety_min z DB).
  // Dzieki temu kierowca moze dostac 2 kursy w jednej sesji jesli laczny czas <= 9h.
  const uzyciKierowcyCzas = new Map<string, number>();
  // Czas juz uzyty per pojazd w tej sesji (do limitu pojazdu — nie liczymy 8h tylko
  // bardziej liberalnie 12h, bo pojazd moze byc na 2 zmianach roznych kierowcow).
  const uzyciPojazdCzas = new Map<string, number>();
  const uzytePaczki = new Set<number>(); // indeksy w paczki[]

  // 4. Iteracja PER KIEROWCA — kazdy kierowca dostaje SWOJ pojazd na caly dzien
  //    (1 auto = 1 kierowca w jednym dniu, fizyczna rzeczywistosc).
  //    Per kierowca petla while buduje wiele kursow (4-5 jesli krotkie) az czas <= 9h.
  //
  //    Sortuj kierowcow po dostepnym czasie (najwiecej -> pierwszy bierze najwiekszy pojazd)
  const kierowcySorted = [...input.kierowcy].sort((a, b) => {
    const dostA = (zmianaMinuty(a.zmiana) - (a.czas_zajety_min ?? 0));
    const dostB = (zmianaMinuty(b.zmiana) - (b.czas_zajety_min ?? 0));
    return dostB - dostA;
  });

  // Pojazdy juz przypisane (1 pojazd = 1 kierowca/dzien)
  const pojazdyPrzypisane = new Set<string>();
  // Pomocnik: wybierz najlepszy wolny pojazd dla kierowcy + dostepnych paczek
  const wybierzPojazdDlaKierowcy = (
    kierowca: KierowcaSlot,
    dostepneIdxy: number[]
  ): { pojazd: PojazdSlot; key: string } | null => {
    for (const candidate of pojazdySorted) {
      const cKey = candidate.flota_id || candidate.nr_rej;
      if (pojazdyPrzypisane.has(cKey)) continue;
      // HDS wymaga uprawnien
      if (/HDS/.test(candidate.typ) && !kierowca.ma_hds) continue;
      // Czy ktorakolwiek paczka dostepna pasuje do tego pojazdu?
      const pasuje = dostepneIdxy.some((gi) => {
        const p = paczki[gi];
        return pojazdSpelniaTyp(candidate, p) && miesciSieWPojezdzie(candidate, [p]);
      });
      if (!pasuje) continue;
      return { pojazd: candidate, key: cKey };
    }
    return null;
  };

  for (const kierowca of kierowcySorted) {
    const dostepneIdxy = paczki.map((_, i) => i).filter((i) => !uzytePaczki.has(i));
    if (dostepneIdxy.length === 0) break;

    const wybor = wybierzPojazdDlaKierowcy(kierowca, dostepneIdxy);
    if (!wybor) continue; // brak wolnego kompatybilnego pojazdu — pomijamy
    const { pojazd, key: pojazdKey } = wybor;
    pojazdyPrzypisane.add(pojazdKey);

    const KIEROWCA_LIMIT = PLAN_CONFIG.max_pracy_z_nadgodzina_min; // 540 min = 9h

    // Petla budowania kursow dla pary (kierowca, pojazd)
    while (true) {
      const obecnyCzasKierowcy = uzyciKierowcyCzas.get(kierowca.kierowca_id) ?? 0;
      const pozostalyKierowca = KIEROWCA_LIMIT - (kierowca.czas_zajety_min ?? 0) - obecnyCzasKierowcy;
      if (pozostalyKierowca < 60) break; // mniej niz 1h zostalo — krotszy kurs nie ma sensu

      const dostepneTeraz = paczki
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => !uzytePaczki.has(i))
        .map(({ p }) => p);
      if (dostepneTeraz.length === 0) break;

      const maxCzasMin = Math.min(PLAN_CONFIG.max_pracy_min, pozostalyKierowca);

      // Mapowanie indeksow lokalnych
      const globalIdxPerLocalIdx: number[] = [];
      paczki.forEach((p, gi) => {
        if (!uzytePaczki.has(gi)) globalIdxPerLocalIdx.push(gi);
      });

      const localPunkty: GeoPoint[] = [input.oddzial_baza, ...dostepneTeraz.map((p) => ({ lat: p.lat, lng: p.lng }))];
      const localDistKm: number[][] = Array.from({ length: localPunkty.length }, () =>
        Array(localPunkty.length).fill(0)
      );
      const localDistMin: number[][] = Array.from({ length: localPunkty.length }, () =>
        Array(localPunkty.length).fill(0)
      );
      const lookup = (li: number) => (li === 0 ? 0 : globalIdxPerLocalIdx[li - 1] + 1);
      for (let i = 0; i < localPunkty.length; i++) {
        for (let j = 0; j < localPunkty.length; j++) {
          localDistKm[i][j] = distKm[lookup(i)][lookup(j)];
          localDistMin[i][j] = distMin[lookup(i)][lookup(j)];
        }
      }

      const algorytmWybor = input.algorytm ?? 'savings';
      const maxObjazdKm = input.max_objazd_km ?? 5;
      const trasy = algorytmWybor === 'clustering'
        ? clusteringAlgorithm(
            dostepneTeraz,
            pojazd,
            localDistKm,
            localDistMin,
            maxCzasMin,
            PLAN_CONFIG.auto_wraca_do_bazy,
            maxObjazdKm
          )
        : savingsAlgorithm(
            dostepneTeraz,
            pojazd,
            localDistKm,
            localDistMin,
            maxCzasMin,
            PLAN_CONFIG.auto_wraca_do_bazy
          );
      if (trasy.length === 0) break;

      // Wez trase z najwieksza waga
      trasy.sort((a, b) => {
        const wagaA = a.paczki.reduce((s, idx) => s + dostepneTeraz[idx - 1].suma_kg, 0);
        const wagaB = b.paczki.reduce((s, idx) => s + dostepneTeraz[idx - 1].suma_kg, 0);
        if (wagaB !== wagaA) return wagaB - wagaA;
        return b.paczki.length - a.paczki.length;
      });
      const najlepsza = trasy[0];

      const optKolejnosc = twoOpt(najlepsza.paczki, localDistKm);
      const km = obliczKmKursu(optKolejnosc, localDistKm, PLAN_CONFIG.auto_wraca_do_bazy);
      const czasMin = obliczCzasKursu(optKolejnosc, localDistMin, PLAN_CONFIG.auto_wraca_do_bazy);
      if (czasMin > pozostalyKierowca) break; // nie miesci sie czasowo

      // Czas startu = start zmiany + juz zajety czas kierowcy
      const zmianaKierowcy = getZmiana(kierowca.zmiana);
      const startMin = timeStrToMin(zmianaKierowcy.start) + (kierowca.czas_zajety_min ?? 0) + obecnyCzasKierowcy;
      const startCzas = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;

      uzyciKierowcyCzas.set(kierowca.kierowca_id, obecnyCzasKierowcy + czasMin);
      uzyciPojazdCzas.set(pojazdKey, (uzyciPojazdCzas.get(pojazdKey) ?? 0) + czasMin);

      const przystanki: PaczkaPrzystankowa[] = optKolejnosc.map((li) => {
        const localIdx = li - 1;
        const gi = globalIdxPerLocalIdx[localIdx];
        uzytePaczki.add(gi);
        return paczki[gi];
      });

      let suma_kg = 0;
      let suma_m3 = 0;
      let suma_palet = 0;
      for (const p of przystanki) {
        suma_kg += p.suma_kg;
        suma_m3 += p.suma_m3;
        suma_palet += p.suma_palet;
      }

      kursy.push({
        kurs_id_tmp: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pojazd,
        kierowca,
        przystanki,
        km_total: km,
        czas_total_min: czasMin,
        suma_kg: Math.round(suma_kg * 10) / 10,
        suma_m3: Math.round(suma_m3 * 10) / 10,
        suma_palet: Math.ceil(suma_palet),
        start_czas: startCzas,
      });
    }
  }

  // 5. Pozostale paczki = niezaplanowane — z konkretnym powodem
  paczki.forEach((p, i) => {
    if (uzytePaczki.has(i)) return;
    const powod = ustalPowodNiezaplanowanego(p, input);
    niezaplanowane.push({ paczka: p, powod });
  });

  const t1 = performance.now();
  console.log(
    `[planTras] gotowe: ${kursy.length} kursow, ${niezaplanowane.length} niezaplanowanych, ${Math.round(t1 - t0)} ms`
  );

  return {
    kursy,
    crossBranch: [], // Faza 3 doda
    niezaplanowane,
    liczba_z_proxy: paczki.filter((p) => p.ma_proxy).length,
  };
}

// Pomocnicze do testowania jednostkowego (export internal helpers)
export { normalizeAdres, rankTypu, rodzinaTypu, maxTyp };
// timeStrToMin reexport dla wygody w UI
export { timeStrToMin };
// PLAN_CONFIG i getZmiana reexport zeby UI nie musial importu z dwoch plikow
export { PLAN_CONFIG, getZmiana };
