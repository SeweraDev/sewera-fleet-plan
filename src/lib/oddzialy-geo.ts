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
export const NAZWA_TO_KOD: Record<string, string> = {
  'Katowice': 'KAT',
  'Sosnowiec': 'SOS',
  'Gliwice': 'GL',
  'Tarnowskie Góry': 'TG',
  'T.Góry': 'TG',
  'Chrzanów': 'CH',
  'Dąbrowa Górnicza': 'DG',
  'D.Górnicza': 'DG',
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

// Cache geocodingu — tylko udane wyniki (null NIE jest cache'owany → retry)
const geocodeCache = new Map<string, { lat: number; lng: number }>();

// Geocoding adresu → Photon (Komoot) — darmowy, bez klucza API, bez rate limitu
export async function geocodeAddress(adres: string): Promise<{ lat: number; lng: number } | null> {
  if (!adres || adres.length < 5) return null;

  const cleaned = cleanAddressForGeocoding(adres);
  const cacheKey = cleaned.trim().toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  // Buduj query — usuń "ul." prefix (Photon lepiej rozumie bez niego)
  const queryBase = cleaned.replace(/^ul\.\s*/i, '').replace(/,\s*Polska$/i, '');

  try {
    const q = encodeURIComponent(queryBase + ' Poland');
    const res = await fetch(`https://photon.komoot.io/api/?q=${q}&limit=1`);
    if (!res.ok) {
      console.warn(`[geocode] Photon HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      const result = { lat, lng };
      console.log(`[geocode] OK: "${queryBase}" → ${lat}, ${lng}`);
      geocodeCache.set(cacheKey, result);
      return result;
    }
    console.log(`[geocode] empty: "${queryBase}"`);
  } catch (e) {
    console.warn(`[geocode] error:`, e);
  }

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
      const OSRM_CORRECTION = 1.2; // OSRM zaniża dystans vs Google Maps
      const km = Math.round(data.routes[0].distance * OSRM_CORRECTION / 100) / 10;
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
      const km = Math.round(data.routes[0].distance / 100) / 10;
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
