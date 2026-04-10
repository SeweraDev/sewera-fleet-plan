// Współrzędne oddziałów SEWERA (hardcoded — znane adresy)
export const ODDZIAL_COORDS: Record<string, { lat: number; lng: number; adres: string }> = {
  KAT: { lat: 50.2162, lng: 18.9836, adres: 'ul. Kościuszki 326, 40-608 Katowice' },
  R:   { lat: 50.2162, lng: 18.9836, adres: 'ul. Kościuszki 326, 40-608 Katowice' },
  CH:  { lat: 50.1350, lng: 19.4050, adres: 'ul. Śląska 64a, 32-500 Chrzanów' },
  DG:  { lat: 50.3340, lng: 19.1890, adres: 'ul. Kasprzaka 33, 41-303 Dąbrowa Górnicza' },
  GL:  { lat: 50.2930, lng: 18.6720, adres: 'ul. Dojazdowa 11, 44-100 Gliwice' },
  OS:  { lat: 50.0377, lng: 19.1963, adres: 'ul. Wyzwolenia 19, 32-600 Oświęcim' },
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
  // Jeśli przed "ul./al./os." jest nazwa miasta — zachowaj ją
  const streetIdx = a.search(/(?:ul\.|al\.|os\.|pl\.)/i);
  if (streetIdx > 0) {
    const prefix = a.substring(0, streetIdx).trim().replace(/[,\s]+$/, '');
    const street = a.substring(streetIdx);
    // Sprawdź czy prefix to nazwa miasta (nie "firma" — miasto to 1-2 słowa bez wielkich liter w środku)
    const isCityLike = prefix.length > 2 && prefix.length < 30 && !prefix.includes('SP') && !prefix.includes('S.A');
    a = isCityLike ? street + ', ' + prefix : street;
  }
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
      // Bounding box: Sewera operuje na Śląsku i okolicach (~200km od Katowic)
      // Odrzuć wyniki daleko poza region (błędny geocoding)
      if (lat < 49.0 || lat > 52.0 || lng < 17.0 || lng > 21.0) {
        console.warn(`[geocode] poza regionem: "${queryBase}" → ${lat}, ${lng} — odrzucam`);
        return null;
      }
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

// Wyszukiwanie adresów → Photon (autocomplete)
export interface SearchResult {
  name: string;
  lat: number;
  lng: number;
}

// Helper: kod → nazwa (wewnętrzny)
const KOD_TO_NAZWA_INTERNAL: Record<string, string> = {
  KAT: 'Katowice', CH: 'Chrzanów', DG: 'Dąbrowa Górnicza',
  GL: 'Gliwice', OS: 'Oświęcim', SOS: 'Sosnowiec', TG: 'Tarnowskie Góry',
};

// Oddziały Sewera jako podpowiedzi autocomplete
const SEWERA_SUGGESTIONS: SearchResult[] = Object.entries(ODDZIAL_COORDS)
  .filter(([kod]) => kod !== 'R') // R = duplikat KAT
  .map(([kod, dane]) => ({
    name: `Sewera ${KOD_TO_NAZWA_INTERNAL[kod] || kod}, ${dane.adres}`,
    lat: dane.lat,
    lng: dane.lng,
  }));

export async function searchAddress(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 3) return [];

  const lower = query.toLowerCase();

  // Jeśli query zawiera "sewera", pokaż pasujące oddziały
  const seweraResults: SearchResult[] = [];
  if (lower.includes('sewera')) {
    const rest = lower.replace('sewera', '').trim();
    for (const s of SEWERA_SUGGESTIONS) {
      if (!rest || s.name.toLowerCase().includes(rest)) {
        seweraResults.push(s);
      }
    }
  }

  const cleaned = query.replace(/^ul\.\s*/i, '').trim();
  const q = encodeURIComponent(cleaned + ' Poland');

  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${q}&limit=5`);
    if (!res.ok) return seweraResults;
    const data = await res.json();
    if (!data.features) return seweraResults;

    const results: SearchResult[] = [...seweraResults];
    for (const f of data.features) {
      const [lng, lat] = f.geometry.coordinates;
      // Bounding box Śląsk
      if (lat < 49.0 || lat > 52.0 || lng < 17.0 || lng > 21.0) continue;

      const props = f.properties || {};
      const parts: string[] = [];
      if (props.name) parts.push(props.name);
      if (props.street) {
        let street = props.street;
        if (props.housenumber) street += ' ' + props.housenumber;
        if (!parts.includes(street)) parts.push(street);
      }
      if (props.city) parts.push(props.city);
      else if (props.county) parts.push(props.county);

      const name = parts.join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      // Nie duplikuj oddziałów Sewera
      if (!seweraResults.some(s => Math.abs(s.lat - lat) < 0.01 && Math.abs(s.lng - lng) < 0.01)) {
        results.push({ name, lat, lng });
      }
    }
    return results.slice(0, 8);
  } catch {
    return seweraResults;
  }
}

// Odległość po drogach → OSRM (darmowy publiczny serwer)

// Zaokrąglenie km + korekta ×1.1 do 10 km (OSRM zaniża krótkie trasy)
function roundKm(rawKm: number): number {
  const corrected = rawKm <= 10 ? rawKm * 1.1 : rawKm;
  return Math.round(corrected);
}

export async function getRouteDistance(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<number | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      const km = roundKm(data.routes[0].distance / 1000);
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

  // Geocoduj wszystkie adresy (sekwencyjnie)
  const waypoints: { lat: number; lng: number }[] = [from];
  for (const adres of adresy) {
    const coords = await geocodeAddress(adres);
    if (coords) waypoints.push(coords);
  }

  if (waypoints.length < 2) return null;

  // Dodaj powrót do oddziału
  waypoints.push(from);

  // OSRM multi-waypoint: oddział → stop1 → stop2 → ... → oddział
  try {
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      const rawKm = data.routes[0].distance / 1000;
      // Zaokrąglenie bez korekty ×1.1 (trasy wielopunktowe są dokładniejsze)
      const km = (rawKm % 1 >= 0.4) ? Math.ceil(rawKm) : Math.floor(rawKm);
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
