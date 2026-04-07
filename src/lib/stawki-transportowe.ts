// Stawki transportowe SEWERA — cennik od 1 IV 2026 (netto PLN)
// Transport wewnętrzny (własne samochody) + zewnętrzny

const VAT = 1.23;

// ============================================================
// TRANSPORT WEWNĘTRZNY — stawki per typ pojazdu
// ============================================================

interface StrefaWew {
  maxKm: number;
  cena: number;
}

interface StawkaWew {
  label: string;
  strefy: StrefaWew[];
  stawkaZaKm: number; // powyżej IV strefy (20 km)
}

// Typy cennikowe transport wewnętrzny
const STAWKI_WEW: StawkaWew[] = [
  {
    label: 'do 700kg',
    strefy: [
      { maxKm: 5, cena: 75.2 },
      { maxKm: 10, cena: 91.06 },
      { maxKm: 15, cena: 102.85 },
      { maxKm: 20, cena: 129.27 },
    ],
    stawkaZaKm: 5.69,
  },
  {
    label: 'do 1,2t bez windy',
    strefy: [
      { maxKm: 5, cena: 84.55 },
      { maxKm: 10, cena: 101.63 },
      { maxKm: 15, cena: 113.82 },
      { maxKm: 20, cena: 143.9 },
    ],
    stawkaZaKm: 6.34,
  },
  {
    label: 'z windą do 1,8t',
    strefy: [
      { maxKm: 5, cena: 97.56 },
      { maxKm: 10, cena: 117.89 },
      { maxKm: 15, cena: 132.52 },
      { maxKm: 20, cena: 167.48 },
    ],
    stawkaZaKm: 7.32,
  },
  {
    label: 'z windą do 6t',
    strefy: [
      { maxKm: 5, cena: 126.83 },
      { maxKm: 10, cena: 165.04 },
      { maxKm: 15, cena: 247.97 },
      { maxKm: 20, cena: 330.08 },
    ],
    stawkaZaKm: 11.06,
  },
  {
    label: 'z windą do 15t',
    strefy: [
      { maxKm: 5, cena: 126.83 },
      { maxKm: 10, cena: 165.04 },
      { maxKm: 15, cena: 247.97 },
      { maxKm: 20, cena: 330.08 },
    ],
    stawkaZaKm: 11.06,
  },
  {
    label: 'HDS 9,0t',
    strefy: [
      { maxKm: 5, cena: 271.54 },
      { maxKm: 10, cena: 299.19 },
      { maxKm: 15, cena: 336.59 },
      { maxKm: 20, cena: 355.28 },
    ],
    stawkaZaKm: 17.76,
  },
  {
    label: 'HDS 12,0t',
    strefy: [
      { maxKm: 5, cena: 365.85 },
      { maxKm: 10, cena: 402.44 },
      { maxKm: 15, cena: 429.27 },
      { maxKm: 20, cena: 447.15 },
    ],
    stawkaZaKm: 20.57,
  },
];

// ============================================================
// TRANSPORT ZEWNĘTRZNY — stawki per oddział × typ × odległość
// ============================================================

interface PunktCenowyZew {
  km: number;
  cena: number;
}

interface StawkaZew {
  typCennikowy: string;
  oddzial: string; // kod oddziału: KAT, SOS, GL, DG
  punkty: PunktCenowyZew[];
  stawkaZaKmPonad20: number | null; // null = brak danych, interpoluj z tabeli
}

const STAWKI_ZEW: StawkaZew[] = [
  // HDS 12T — KAT, SOS, GL, DG
  { typCennikowy: 'HDS 12,0t', oddzial: 'KAT', punkty: [{ km: 10, cena: 350 }, { km: 20, cena: 450 }], stawkaZaKmPonad20: null },
  { typCennikowy: 'HDS 12,0t', oddzial: 'SOS', punkty: [{ km: 10, cena: 370 }, { km: 15, cena: 400 }, { km: 20, cena: 420 }, { km: 30, cena: 450 }], stawkaZaKmPonad20: null },
  { typCennikowy: 'HDS 12,0t', oddzial: 'GL', punkty: [{ km: 5, cena: 380 }, { km: 10, cena: 380 }, { km: 15, cena: 430 }, { km: 20, cena: 480 }, { km: 30, cena: 550 }], stawkaZaKmPonad20: null },
  { typCennikowy: 'HDS 12,0t', oddzial: 'DG', punkty: [{ km: 5, cena: 300 }, { km: 10, cena: 350 }, { km: 15, cena: 400 }, { km: 20, cena: 450 }], stawkaZaKmPonad20: null },

  // HDS 12T — Oświęcim
  { typCennikowy: 'HDS 12,0t', oddzial: 'OS', punkty: [{ km: 5, cena: 300 }, { km: 15, cena: 350 }, { km: 20, cena: 450 }, { km: 30, cena: 550 }, { km: 40, cena: 650 }], stawkaZaKmPonad20: 7 },

  // do 1,2T — tylko GL
  { typCennikowy: 'do 1,2t bez windy', oddzial: 'GL', punkty: [{ km: 5, cena: 100 }, { km: 10, cena: 120 }, { km: 15, cena: 140 }, { km: 20, cena: 160 }], stawkaZaKmPonad20: null },
];

// ============================================================
// MAPOWANIE typów systemowych → typów cennikowych
// ============================================================

const TYP_MAPPING: Record<string, string> = {
  'Dostawczy 1,2t': 'do 1,2t bez windy',
  'Winda 1,8t': 'z windą do 1,8t',
  'Winda 6,3t': 'z windą do 6t',
  'Winda MAX 15,8t': 'z windą do 15t',
  'HDS 8,9t': 'HDS 9,0t',
  'HDS 9,0t': 'HDS 9,0t',
  'HDS 9,1t': 'HDS 9,0t',
  'HDS 11,7t': 'HDS 12,0t',
  'HDS 12,0t': 'HDS 12,0t',
  'HDS 12T': 'HDS 12,0t',
};

// Typy dostępne w kalkulatorze (label cennikowy)
export const TYPY_KALKULATOR = STAWKI_WEW.map(s => s.label);

/** Mapuj typ systemowy na cennikowy. Jeśli już cennikowy — zwróć as-is. */
export function mapTypNaCennikowy(typ: string): string | null {
  if (STAWKI_WEW.find(s => s.label === typ)) return typ;
  return TYP_MAPPING[typ] ?? null;
}

// ============================================================
// FALLBACK TYPÓW — hierarchia "w dół" gdy oddział nie ma danego auta
// ============================================================

// Mapowanie typ cennikowy → typy systemowe (flota.typ)
const CENNIKOWY_TO_SYSTEMOWE: Record<string, string[]> = {
  'do 700kg': [],
  'do 1,2t bez windy': ['Dostawczy 1,2t'],
  'z windą do 1,8t': ['Winda 1,8t'],
  'z windą do 6t': ['Winda 6,3t'],
  'z windą do 15t': ['Winda MAX 15,8t'],
  'HDS 9,0t': ['HDS 9,0t', 'HDS 8,9t', 'HDS 9,1t'],
  'HDS 12,0t': ['HDS 12,0t', 'HDS 11,7t', 'HDS 12T'],
};

// Hierarchia fallback: jeśli nie ma danego typu, próbuj mniejszy
const FALLBACK_CHAIN: Record<string, string[]> = {
  'HDS 12,0t': ['HDS 9,0t'],
  'HDS 9,0t': [],
  'z windą do 15t': ['z windą do 6t', 'z windą do 1,8t'],
  'z windą do 6t': ['z windą do 1,8t'],
  'z windą do 1,8t': [],
  'do 1,2t bez windy': ['do 700kg'],
  'do 700kg': [],
};

/**
 * Znajdź najlepszy dostępny typ cennikowy dla danego oddziału.
 * @param typCennikowy — wybrany typ (np. "HDS 12t")
 * @param flotaTypy — Set typów systemowych dostępnych na oddziale (np. Set(["HDS 8,9t", "Winda 6,3t"]))
 * @returns { typ: string, fallback: boolean } — typ cennikowy do użycia + czy to fallback
 */
export function findBestAvailableType(
  typCennikowy: string,
  flotaTypy: Set<string>
): { typ: string; fallback: boolean } | null {
  // Sprawdź czy oddział ma dokładny typ
  const systemowe = CENNIKOWY_TO_SYSTEMOWE[typCennikowy] || [];
  if (systemowe.some(t => flotaTypy.has(t))) {
    return { typ: typCennikowy, fallback: false };
  }

  // Próbuj fallback chain
  const chain = FALLBACK_CHAIN[typCennikowy] || [];
  for (const fallbackTyp of chain) {
    const fbSystemowe = CENNIKOWY_TO_SYSTEMOWE[fallbackTyp] || [];
    if (fbSystemowe.some(t => flotaTypy.has(t))) {
      return { typ: fallbackTyp, fallback: true };
    }
  }

  return null; // oddział nie ma żadnego pasującego auta
}

// ============================================================
// OBLICZANIE KOSZTÓW — TRANSPORT WEWNĘTRZNY
// ============================================================

export interface KosztTransportu {
  netto: number;
  brutto: number;
}

/**
 * Oblicz koszt transportu wewnętrznego (własne samochody).
 * @param km — odległość w jedną stronę
 * @param typCennikowy — label z TYPY_KALKULATOR (np. "do 1,2t bez windy")
 */
export function obliczKosztWew(km: number, typCennikowy: string): KosztTransportu | null {
  const stawka = STAWKI_WEW.find(s => s.label === typCennikowy);
  if (!stawka) return null;

  const kmRounded = Math.ceil(km); // zaokrąglenie w górę

  // Znajdź strefę
  for (const strefa of stawka.strefy) {
    if (kmRounded <= strefa.maxKm) {
      return {
        netto: round2(strefa.cena),
        brutto: round2(strefa.cena * VAT),
      };
    }
  }

  // Powyżej IV strefy (>20 km)
  const stawkaIV = stawka.strefy[stawka.strefy.length - 1].cena;
  const nadwyzka = kmRounded - 20;
  const netto = stawkaIV + nadwyzka * stawka.stawkaZaKm;

  return {
    netto: round2(netto),
    brutto: round2(netto * VAT),
  };
}

// ============================================================
// OBLICZANIE KOSZTÓW — TRANSPORT ZEWNĘTRZNY
// ============================================================

/**
 * Oblicz koszt transportu zewnętrznego.
 * Interpolacja liniowa między punktami cenowymi.
 * @param km — odległość w jedną stronę
 * @param typCennikowy — typ cennikowy (np. "HDS 12t")
 * @param oddzialKod — kod oddziału (np. "GL", "KAT")
 * @returns null jeśli brak stawki zew dla tego oddziału/typu
 */
export function obliczKosztZew(km: number, typCennikowy: string, oddzialKod: string): KosztTransportu | null {
  const stawka = STAWKI_ZEW.find(
    s => s.typCennikowy === typCennikowy && s.oddzial === oddzialKod
  );
  if (!stawka || stawka.punkty.length === 0) return null;

  const kmRounded = Math.ceil(km);
  const punkty = stawka.punkty;

  // Poniżej pierwszego punktu — użyj ceny pierwszego punktu
  if (kmRounded <= punkty[0].km) {
    return {
      netto: round2(punkty[0].cena),
      brutto: round2(punkty[0].cena * VAT),
    };
  }

  // Interpolacja liniowa między punktami
  for (let i = 1; i < punkty.length; i++) {
    if (kmRounded <= punkty[i].km) {
      const prev = punkty[i - 1];
      const curr = punkty[i];
      const ratio = (kmRounded - prev.km) / (curr.km - prev.km);
      const netto = prev.cena + ratio * (curr.cena - prev.cena);
      return {
        netto: round2(netto),
        brutto: round2(netto * VAT),
      };
    }
  }

  // Powyżej ostatniego punktu
  if (stawka.stawkaZaKmPonad20 !== null) {
    const ostatni = punkty[punkty.length - 1];
    const netto = ostatni.cena + (kmRounded - ostatni.km) * stawka.stawkaZaKmPonad20;
    return {
      netto: round2(netto),
      brutto: round2(netto * VAT),
    };
  }

  // Brak stawki za km — ekstrapolacja liniowa z dwóch ostatnich punktów
  if (punkty.length >= 2) {
    const p1 = punkty[punkty.length - 2];
    const p2 = punkty[punkty.length - 1];
    const stawkaZaKm = (p2.cena - p1.cena) / (p2.km - p1.km);
    const netto = p2.cena + (kmRounded - p2.km) * stawkaZaKm;
    return {
      netto: round2(netto),
      brutto: round2(netto * VAT),
    };
  }

  return null;
}

/**
 * Sprawdź czy istnieją jakiekolwiek stawki zew dla danego typu cennikowego.
 */
export function maStawkiZew(typCennikowy: string): boolean {
  return STAWKI_ZEW.some(s => s.typCennikowy === typCennikowy);
}

/**
 * Sprawdź czy dany oddział ma stawkę zew dla typu.
 */
export function maStawkeZewDlaOddzialu(typCennikowy: string, oddzialKod: string): boolean {
  return STAWKI_ZEW.some(s => s.typCennikowy === typCennikowy && s.oddzial === oddzialKod);
}

// ============================================================
// HELPERS
// ============================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
