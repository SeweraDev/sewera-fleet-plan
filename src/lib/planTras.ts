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
// CAPACITY CHECK — czy paczka(i) miesci sie w pojezdzie
// ============================================================

/** Czy pojazd P moze obsluzyc paczke pod katem typu? */
function pojazdSpelniaTyp(pojazd: PojazdSlot, paczka: PaczkaPrzystankowa): boolean {
  if (!paczka.wymagany_typ) return true; // dowolny typ
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

function przydzielKierowce(
  trasaCzasMin: number,
  pojazd: PojazdSlot,
  kierowcyDostepni: KierowcaSlot[],
  uzyciKierowcy: Set<string>
): KierowcaSlot | null {
  const pojazdHDS = /HDS/.test(pojazd.typ);
  for (const k of kierowcyDostepni) {
    if (uzyciKierowcy.has(k.kierowca_id)) continue;
    if (pojazdHDS && !k.ma_hds) continue;
    const z = getZmiana(k.zmiana);
    const dostepneMin = timeStrToMin(z.koniec) - timeStrToMin(z.start);
    if (trasaCzasMin > dostepneMin) continue;
    return k;
  }
  return null;
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

  // 3. Pojazdy posortowane: wlasne (Sewera) przed zewnętrznymi, w obrebie tego samego ranking typu
  const pojazdySorted = [...input.pojazdy].sort((a, b) => {
    if (a.is_zewnetrzny !== b.is_zewnetrzny) return a.is_zewnetrzny ? 1 : -1;
    return rankTypu(b.typ) - rankTypu(a.typ); // wieksze pierwsze (HDS przed Dostawczy)
  });

  const kursy: KursPropozycja[] = [];
  const niezaplanowane: Niezaplanowane[] = [];
  const uzyciKierowcy = new Set<string>();
  const uzytePaczki = new Set<number>(); // indeksy w paczki[]

  // 4. Dla kazdego pojazdu sprob zaplanowac trase z paczek nieuzytych
  for (const pojazd of pojazdySorted) {
    const dostepnePaczki = paczki
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => !uzytePaczki.has(i))
      .map(({ p }) => p);

    if (dostepnePaczki.length === 0) break;

    // 8h zwykle, 9h fallback gdy 8h nie zaplanuje wszystkiego
    const maxCzasMin = PLAN_CONFIG.max_pracy_min;

    // Mapowanie globalnych indeksow paczek -> lokalnych dla savings
    const globalIdxPerLocalIdx: number[] = [];
    paczki.forEach((p, gi) => {
      if (!uzytePaczki.has(gi)) globalIdxPerLocalIdx.push(gi);
    });

    // Budujemy lokalne paczki + lokalna distance matrix dla savings (slice z global)
    const localPunkty: GeoPoint[] = [input.oddzial_baza, ...dostepnePaczki.map((p) => ({ lat: p.lat, lng: p.lng }))];
    const localDistKm: number[][] = Array.from({ length: localPunkty.length }, () =>
      Array(localPunkty.length).fill(0)
    );
    const localDistMin: number[][] = Array.from({ length: localPunkty.length }, () =>
      Array(localPunkty.length).fill(0)
    );
    // Mapuj 0=baza, 1..k = lokalne paczki
    const lookup = (li: number) => (li === 0 ? 0 : globalIdxPerLocalIdx[li - 1] + 1);
    for (let i = 0; i < localPunkty.length; i++) {
      for (let j = 0; j < localPunkty.length; j++) {
        localDistKm[i][j] = distKm[lookup(i)][lookup(j)];
        localDistMin[i][j] = distMin[lookup(i)][lookup(j)];
      }
    }

    const trasy = savingsAlgorithm(
      dostepnePaczki,
      pojazd,
      localDistKm,
      localDistMin,
      maxCzasMin,
      PLAN_CONFIG.auto_wraca_do_bazy
    );

    if (trasy.length === 0) continue;

    // Wez tylko najlepsza (najwiecej paczek dla tego pojazdu); pojedynczy pojazd = 1 kurs/dzien
    trasy.sort((a, b) => b.paczki.length - a.paczki.length);
    const najlepsza = trasy[0];

    // 2-opt
    const optKolejnosc = twoOpt(najlepsza.paczki, localDistKm);
    const km = obliczKmKursu(optKolejnosc, localDistKm, PLAN_CONFIG.auto_wraca_do_bazy);
    const czasMin = obliczCzasKursu(optKolejnosc, localDistMin, PLAN_CONFIG.auto_wraca_do_bazy);

    // Kierowca
    const kierowca = przydzielKierowce(czasMin, pojazd, input.kierowcy, uzyciKierowcy);
    if (!kierowca) {
      // Brak dostepnego kierowcy — pomijamy ten pojazd, paczki zostaja
      continue;
    }
    uzyciKierowcy.add(kierowca.kierowca_id);

    // Zaznacz uzyte paczki (mapowanie z lokalnych indeksow lokalna_paczki[idx-1] -> globalny)
    const przystanki: PaczkaPrzystankowa[] = optKolejnosc.map((li) => {
      const localIdx = li - 1; // li>=1
      const gi = globalIdxPerLocalIdx[localIdx];
      uzytePaczki.add(gi);
      return paczki[gi];
    });

    // Sumy
    let suma_kg = 0;
    let suma_m3 = 0;
    let suma_palet = 0;
    for (const p of przystanki) {
      suma_kg += p.suma_kg;
      suma_m3 += p.suma_m3;
      suma_palet += p.suma_palet;
    }

    // Czas startu: ze zmiany kierowcy
    const startCzas = getZmiana(kierowca.zmiana).start;

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

  // 5. Pozostale paczki = niezaplanowane
  paczki.forEach((p, i) => {
    if (uzytePaczki.has(i)) return;
    let powod: string;
    if (p.wymagany_typ) {
      // Sprawdz czy w ogole jest pojazd tego typu
      const istnieje = input.pojazdy.some((pp) => rankTypu(pp.typ) >= rankTypu(p.wymagany_typ));
      if (!istnieje) {
        powod = `Brak pojazdu typu ${p.wymagany_typ} lub wiekszego w oddziale`;
      } else {
        powod = 'Brak miejsca w pojezdzie typu lub czasu pracy kierowcy';
      }
    } else if (p.suma_kg > Math.max(...input.pojazdy.map((pp) => pp.ladownosc_kg))) {
      powod = `Waga ${p.suma_kg} kg przekracza pojemnosc kazdego pojazdu`;
    } else {
      powod = 'Brak dostepnego pojazdu/kierowcy lub czasu pracy';
    }
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
export { normalizeAdres, rankTypu, maxTyp };
// timeStrToMin reexport dla wygody w UI
export { timeStrToMin };
// PLAN_CONFIG i getZmiana reexport zeby UI nie musial importu z dwoch plikow
export { PLAN_CONFIG, getZmiana };
