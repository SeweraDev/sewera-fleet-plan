// Współrzędne oddziałów SEWERA (hardcoded — znane adresy)
export const ODDZIAL_COORDS: Record<string, { lat: number; lng: number; adres: string }> = {
  KAT: { lat: 50.2162, lng: 18.9836, adres: 'ul. Kościuszki 326, 40-608 Katowice' },
  R:   { lat: 50.2162, lng: 18.9836, adres: 'ul. Kościuszki 326, 40-608 Katowice' },
  CH:  { lat: 50.1350, lng: 19.4050, adres: 'ul. Śląska 64a, 32-500 Chrzanów' },
  DG:  { lat: 50.3340, lng: 19.1890, adres: 'ul. Kasprzaka 33, 41-303 Dąbrowa Górnicza' },
  GL:  { lat: 50.2930, lng: 18.6720, adres: 'ul. Dojazdowa 11, 44-100 Gliwice' },
  OS:  { lat: 50.0380, lng: 19.2440, adres: 'ul. Wyzwolenia 19, 32-600 Oświęcim' },
  SOS: { lat: 50.2870, lng: 19.1280, adres: 'ul. Rudna 14, 41-214 Sosnowiec' },
  TG:  { lat: 50.4430, lng: 18.8570, adres: 'ul. Nakielska 24, 42-600 Tarnowskie Góry' },
};

// Mapowanie nazwa oddziału → kod
const NAZWA_TO_KOD: Record<string, string> = {
  'Katowice': 'KAT',
  'Sosnowiec': 'SOS',
  'Gliwice': 'GL',
  'Tarnowskie Góry': 'TG',
  'Chrzanów': 'CH',
  'Dąbrowa Górnicza': 'DG',
  'Oświęcim': 'OS',
  'Redystrybucja': 'R',
};

export function getOddzialCoordsByName(nazwaOddzialu: string): { lat: number; lng: number } | null {
  const kod = NAZWA_TO_KOD[nazwaOddzialu];
  return kod ? ODDZIAL_COORDS[kod] || null : null;
}

// Wyczyść adres z prefixów (Budowa, Hala, Magazyn...) i zostaw tylko ulicę + kod + miasto
function cleanAddressForGeocoding(raw: string): string {
  let a = raw;
  // Usuń prefixy typu "Budowa Żłobka w Sosnowcu," itp.
  a = a.replace(/^(?:Budowa|Hala|Magazyn|Plac|Obiekt|Inwestycja)[^,]*,\s*/i, '');
  // Usuń "nazwa obiektu" przed "ul./al./os."
  const streetIdx = a.search(/(?:ul\.|al\.|os\.|pl\.)/i);
  if (streetIdx > 0) a = a.substring(streetIdx);
  return a.trim();
}

// Delay helper
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cache geocodingu — tylko udane wyniki (null NIE jest cache'owany → retry przy następnym razie)
const geocodeCache = new Map<string, { lat: number; lng: number }>();

// Kolejka requestów Nominatim — max 1 req/s
let lastNominatimRequest = 0;

async function nominatimFetch(query: string): Promise<any[]> {
  // Czekaj żeby nie przekroczyć 1 req/s
  const now = Date.now();
  const elapsed = now - lastNominatimRequest;
  if (elapsed < 1100) {
    await delay(1100 - elapsed);
  }
  lastNominatimRequest = Date.now();

  const q = encodeURIComponent(query);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=pl`,
    { headers: { 'User-Agent': 'SeweraFleetPlan/1.0' } }
  );
  if (!res.ok) {
    console.warn(`[geocode] Nominatim HTTP ${res.status} for: ${query}`);
    return [];
  }
  return await res.json();
}

// Geocoding adresu → Nominatim (darmowy, 1 req/s z kolejką)
export async function geocodeAddress(adres: string): Promise<{ lat: number; lng: number } | null> {
  if (!adres || adres.length < 5) return null;

  const cleaned = cleanAddressForGeocoding(adres);
  const cacheKey = cleaned.trim().toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  // Buduj próby geocodingu
  const attempts: string[] = [];

  // Próba 1: ul. + kod + miasto (najdokładniejsza)
  const streetMatch = cleaned.match(/((?:ul\.|al\.|os\.|pl\.)[^,]+)/i);
  const pcMatch = cleaned.match(/(\d{2}-\d{3})\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s]+)/);
  if (streetMatch && pcMatch) {
    attempts.push(`${streetMatch[1].trim()}, ${pcMatch[1]} ${pcMatch[2].trim()}, Polska`);
  }
  // Próba 2: pełny oczyszczony adres
  attempts.push(`${cleaned}, Polska`);
  // Próba 3: tylko kod pocztowy + miasto
  if (pcMatch) {
    attempts.push(`${pcMatch[1]} ${pcMatch[2].trim()}, Polska`);
  }

  for (const attempt of attempts) {
    try {
      const data = await nominatimFetch(attempt);
      if (data && data.length > 0) {
        const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        console.log(`[geocode] OK: "${attempt}" → ${result.lat}, ${result.lng}`);
        geocodeCache.set(cacheKey, result);
        return result;
      }
      console.log(`[geocode] empty: "${attempt}"`);
    } catch (e) {
      console.warn(`[geocode] error: "${attempt}"`, e);
    }
  }

  console.warn(`[geocode] FAILED all attempts for: "${adres}" (cleaned: "${cleaned}")`);
  // NIE cache'ujemy null — retry przy następnym razie
  return null;
}

// Odległość po drogach → OSRM (darmowy publiczny serwer)
export async function getRouteDistance(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<number | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      const km = Math.round(data.routes[0].distance / 1000);
      console.log(`[osrm] ${km} km`);
      return km;
    }
    console.warn(`[osrm] no route`, data);
  } catch (e) {
    console.warn(`[osrm] error`, e);
  }
  return null;
}

// Oblicz łączną trasę: oddział → stop1 → stop2 → ... (OSRM multi-waypoint)
export async function calculateRouteTotal(
  oddzialNazwa: string,
  adresy: string[]
): Promise<number | null> {
  if (!adresy.length || !oddzialNazwa) return null;

  const from = getOddzialCoordsByName(oddzialNazwa);
  if (!from) return null;

  // Geocoduj wszystkie adresy (sekwencyjnie — Nominatim rate limit)
  const waypoints: { lat: number; lng: number }[] = [from];
  for (const adres of adresy) {
    const coords = await geocodeAddress(adres);
    if (coords) waypoints.push(coords);
  }

  if (waypoints.length < 2) return null;

  // OSRM multi-waypoint
  try {
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      const km = Math.round(data.routes[0].distance / 1000);
      console.log(`[osrm-route] ${waypoints.length} punktów → ${km} km`);
      return km;
    }
  } catch (e) {
    console.warn(`[osrm-route] error`, e);
  }
  return null;
}

// Cache dystansu — klucz: "oddział:adres". Null NIE jest cache'owany.
const distanceCache = new Map<string, number>();

// Oblicz dystans od oddziału do adresu dostawy (km po drogach)
export async function calculateDistance(oddzialNazwa: string, adresDostawy: string): Promise<number | null> {
  if (!adresDostawy || !oddzialNazwa) return null;

  const cacheKey = `${oddzialNazwa}:${adresDostawy.trim().toLowerCase()}`;
  if (distanceCache.has(cacheKey)) return distanceCache.get(cacheKey)!;

  const from = getOddzialCoordsByName(oddzialNazwa);
  if (!from) {
    console.warn(`[distance] unknown oddział: "${oddzialNazwa}"`);
    return null;
  }

  const to = await geocodeAddress(adresDostawy);
  if (!to) return null;

  const km = await getRouteDistance(from, to);
  if (km != null) {
    distanceCache.set(cacheKey, km);
  }
  return km;
}
