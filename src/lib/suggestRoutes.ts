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

  // 1. Przekroczenie wagi / objętości / palet
  for (const o of orders) {
    const typ = o.typ_pojazdu;
    const cap = typ ? TYP_CAPACITY[typ] : null;

    if (cap) {
      const overKg = o.suma_kg > cap.kg;
      const overM3 = cap.m3 > 0 && o.suma_m3 > cap.m3;
      const overPal = cap.pal > 0 && o.suma_palet > cap.pal;

      if (overKg || overM3 || overPal) {
        const parts: string[] = [];
        if (overKg) parts.push('waga ' + Math.round(o.suma_kg).toLocaleString('pl-PL') + '/' + cap.kg.toLocaleString('pl-PL') + ' kg');
        if (overM3) parts.push('objętość ' + o.suma_m3.toFixed(1) + '/' + cap.m3 + ' m³');
        if (overPal) parts.push('palety ' + o.suma_palet + '/' + cap.pal + ' pal');
        suggestions.push({
          type: 'overweight',
          severity: 'warning',
          message: o.numer + ': przekroczenie — ' + parts.join(', ') + ' (' + typ + ')',
          orderIds: [o.id],
          orderNumbers: [o.numer],
        });
      }
    } else if (!typ && o.suma_kg > 15800) {
      // Nie mieści się na żadnym pojeździe
      suggestions.push({
        type: 'overweight',
        severity: 'warning',
        message: o.numer + ': ' + Math.round(o.suma_kg).toLocaleString('pl-PL')
          + ' kg — przekracza największy pojazd (15 800 kg)',
        orderIds: [o.id],
        orderNumbers: [o.numer],
      });
    }
  }


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

  result.sort((a, b) => {
    if (a.typ === '_brak') return 1;
    if (b.typ === '_brak') return -1;
    return a.typ.localeCompare(b.typ);
  });

  return result;
}
