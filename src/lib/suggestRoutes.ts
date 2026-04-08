// Pojemności typów pojazdów (single source of truth)
export const TYP_CAPACITY: Record<string, { kg: number; m3: number; pal: number }> = {
  'Dostawczy 1,2t': { kg: 1200, m3: 18.5, pal: 7 },
  'Winda 1,8t': { kg: 1800, m3: 18, pal: 7 },
  'Winda 6,3t': { kg: 6300, m3: 32, pal: 13 },
  'Winda MAX 15,8t': { kg: 15800, m3: 60, pal: 22 },
  'HDS 9,0t': { kg: 9000, m3: 0, pal: 12 },
  'HDS 8,9t': { kg: 8900, m3: 0, pal: 12 },
  'HDS 9,1t': { kg: 9100, m3: 0, pal: 12 },
  'HDS 12,0t': { kg: 11700, m3: 0, pal: 12 },
  'HDS 11,7t': { kg: 11700, m3: 0, pal: 12 },
  'HDS 12T': { kg: 12000, m3: 0, pal: 12 },
};

// Typy posortowane od najmniejszego do największego (wg kg)
const SORTED_TYPES = Object.entries(TYP_CAPACITY)
  .filter(([k]) => !['HDS 8,9t', 'HDS 9,1t', 'HDS 11,7t', 'HDS 12T'].includes(k))
  .sort((a, b) => a[1].kg - b[1].kg);

export interface RouteSuggestion {
  type: 'overweight' | 'merge' | 'no_type';
  severity: 'warning' | 'info';
  message: string;
  orderIds: string[];
  orderNumbers: string[];
}

interface OrderInput {
  id: string;
  numer: string;
  typ_pojazdu: string | null;
  suma_kg: number;
  suma_m3: number;
  suma_palet: number;
  adres: string | null;
  lat: number | null;
  lng: number | null;
}

// Haversine — odległość w metrach
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Normalizacja adresu do porównania
function normalizeAddress(a: string): string {
  return a
    .toLowerCase()
    .replace(/[ąáà]/g, 'a').replace(/[ćč]/g, 'c').replace(/[ęé]/g, 'e')
    .replace(/[łľ]/g, 'l').replace(/[ńň]/g, 'n').replace(/[óöő]/g, 'o')
    .replace(/[śšş]/g, 's').replace(/[żźž]/g, 'z').replace(/[ůúü]/g, 'u')
    .replace(/[,.\-\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Czy dwa zlecenia są "pod tym samym adresem"?
function isSameLocation(a: OrderInput, b: OrderInput): boolean {
  // Sprawdź współrzędne (< 150m)
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    return haversineM(a.lat, a.lng, b.lat, b.lng) < 150;
  }
  // Fallback: porównanie adresów tekstowo
  if (a.adres && b.adres) {
    return normalizeAddress(a.adres) === normalizeAddress(b.adres);
  }
  return false;
}

// Znajdź najmniejszy pojazd który pomieści ładunek (tylko z dostępnych)
function findSmallestFittingType(
  kg: number, m3: number, pal: number,
  availableTypes?: string[]
): string | null {
  const types = availableTypes
    ? SORTED_TYPES.filter(([name]) => availableTypes.includes(name))
    : SORTED_TYPES;
  for (const [name, cap] of types) {
    if (kg <= cap.kg
      && (cap.m3 === 0 || m3 <= cap.m3)
      && (cap.pal === 0 || pal <= cap.pal)) {
      return name;
    }
  }
  return null;
}

// Grupuj zlecenia wg lokalizacji
function groupByLocation(orders: OrderInput[]): OrderInput[][] {
  const used = new Set<string>();
  const groups: OrderInput[][] = [];

  for (const order of orders) {
    if (used.has(order.id)) continue;
    const group = [order];
    used.add(order.id);

    for (const other of orders) {
      if (used.has(other.id)) continue;
      if (isSameLocation(order, other)) {
        group.push(other);
        used.add(other.id);
      }
    }
    if (group.length > 1) {
      groups.push(group);
    }
  }
  return groups;
}

export function computeSuggestions(orders: OrderInput[], availableTypes?: string[]): RouteSuggestion[] {
  const suggestions: RouteSuggestion[] = [];

  // 1. Przekroczenie wagi
  for (const o of orders) {
    const typ = o.typ_pojazdu;
    const cap = typ ? TYP_CAPACITY[typ] : null;

    if (cap && o.suma_kg > cap.kg) {
      const trips = Math.ceil(o.suma_kg / cap.kg);
      suggestions.push({
        type: 'overweight',
        severity: 'warning',
        message: o.numer + ': ' + Math.round(o.suma_kg).toLocaleString('pl-PL')
          + ' kg — potrzebne ' + trips + ' kursy ' + typ
          + ' (pojemnosc ' + cap.kg.toLocaleString('pl-PL') + ' kg)',
        orderIds: [o.id],
        orderNumbers: [o.numer],
      });
    } else if (!typ && o.suma_kg > 15800) {
      // Nie mieści się na żadnym pojeździe
      suggestions.push({
        type: 'overweight',
        severity: 'warning',
        message: o.numer + ': ' + Math.round(o.suma_kg).toLocaleString('pl-PL')
          + ' kg — przekracza najwększy pojazd (15 800 kg)',
        orderIds: [o.id],
        orderNumbers: [o.numer],
      });
    }
  }

  // 2. Ten sam adres — sugestia połączenia
  const locGroups = groupByLocation(orders);
  for (const group of locGroups) {
    const totalKg = group.reduce((s, o) => s + o.suma_kg, 0);
    const totalM3 = group.reduce((s, o) => s + o.suma_m3, 0);
    const totalPal = group.reduce((s, o) => s + o.suma_palet, 0);
    const numery = group.map(o => o.numer);
    const ids = group.map(o => o.id);

    // Etykieta adresu — weź najkrótszą formę
    const adres = group[0].adres || '?';
    const label = adres.length > 40 ? adres.substring(0, 37) + '...' : adres;

    const fittingType = findSmallestFittingType(totalKg, totalM3, totalPal, availableTypes);

    if (fittingType) {
      suggestions.push({
        type: 'merge',
        severity: 'info',
        message: label + ': ' + numery.join(' + ')
          + ' = ' + Math.round(totalKg).toLocaleString('pl-PL') + ' kg'
          + ' (miesci sie na ' + fittingType + ')',
        orderIds: ids,
        orderNumbers: numery,
      });
    } else {
      suggestions.push({
        type: 'merge',
        severity: 'info',
        message: label + ': ' + numery.join(' + ')
          + ' = ' + Math.round(totalKg).toLocaleString('pl-PL') + ' kg'
          + ' (ten sam adres — zaplanuj razem)',
        orderIds: ids,
        orderNumbers: numery,
      });
    }
  }

  // 3. Brak typu — sugestia na podstawie sąsiada pod tym samym adresem
  for (const o of orders) {
    if (o.typ_pojazdu) continue;

    // Szukaj sąsiada z typem pod tym samym adresem
    const neighbor = orders.find(n => n.id !== o.id && n.typ_pojazdu && isSameLocation(o, n));
    if (neighbor) {
      suggestions.push({
        type: 'no_type',
        severity: 'info',
        message: o.numer + ': brak typu — sugerowany ' + neighbor.typ_pojazdu
          + ' (ten sam adres co ' + neighbor.numer + ')',
        orderIds: [o.id],
        orderNumbers: [o.numer],
      });
    } else {
      // Sugeruj na podstawie wagi
      const suggested = findSmallestFittingType(o.suma_kg, o.suma_m3, o.suma_palet, availableTypes);
      if (suggested) {
        suggestions.push({
          type: 'no_type',
          severity: 'info',
          message: o.numer + ': brak typu — sugerowany ' + suggested
            + ' (na podstawie wagi ' + Math.round(o.suma_kg) + ' kg)',
          orderIds: [o.id],
          orderNumbers: [o.numer],
        });
      }
    }
  }

  // Sortuj: ostrzeżenia → merge → brak typu
  const ORDER = { overweight: 0, merge: 1, no_type: 2 };
  suggestions.sort((a, b) => ORDER[a.type] - ORDER[b.type]);

  return suggestions;
}

// Podsumowanie per typ pojazdu
export interface TypeSummary {
  typ: string;
  label: string;
  count: number;
  totalKg: number;
  totalM3: number;
  totalPal: number;
  totalKm: number;
  minKursy: number;
  capacity: { kg: number; m3: number; pal: number } | null;
}

export function computeTypeSummary(
  orders: Array<OrderInput & { dystans_km: number | null }>
): TypeSummary[] {
  const groups = new Map<string, typeof orders>();

  for (const o of orders) {
    const typ = o.typ_pojazdu || '_brak';
    if (!groups.has(typ)) groups.set(typ, []);
    groups.get(typ)!.push(o);
  }

  const result: TypeSummary[] = [];
  for (const [typ, items] of groups) {
    const totalKg = items.reduce((s, o) => s + o.suma_kg, 0);
    const totalM3 = items.reduce((s, o) => s + o.suma_m3, 0);
    const totalPal = items.reduce((s, o) => s + o.suma_palet, 0);
    const totalKm = items.reduce((s, o) => s + (o.dystans_km ?? 0), 0);
    const cap = typ !== '_brak' ? TYP_CAPACITY[typ] || null : null;

    // Min. kursów = ceil(totalKg / pojemność) ale min 1
    let minKursy = 1;
    if (cap && cap.kg > 0) {
      minKursy = Math.max(1, Math.ceil(totalKg / cap.kg));
      if (cap.pal > 0 && totalPal > 0) {
        minKursy = Math.max(minKursy, Math.ceil(totalPal / cap.pal));
      }
    }

    result.push({
      typ,
      label: typ === '_brak' ? 'Bez typu' : typ,
      count: items.length,
      totalKg,
      totalM3,
      totalPal,
      totalKm,
      minKursy,
      capacity: cap,
    });
  }

  // Sortuj: z typem (alfabetycznie) → bez typu na końcu
  result.sort((a, b) => {
    if (a.typ === '_brak') return 1;
    if (b.typ === '_brak') return -1;
    return a.typ.localeCompare(b.typ);
  });

  return result;
}
