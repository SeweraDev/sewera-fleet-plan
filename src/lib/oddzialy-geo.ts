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

export function getOddzialCoordsById(oddzialId: number, oddzialNazwa: string): { lat: number; lng: number } | null {
  return getOddzialCoordsByName(oddzialNazwa);
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

// Cache geocodingu — nie pytaj ponownie o ten sam adres
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

// Geocoding adresu → Nominatim (darmowy, 1 req/s)
export async function geocodeAddress(adres: string): Promise<{ lat: number; lng: number } | null> {
  if (!adres || adres.length < 5) return null;

  const cleaned = cleanAddressForGeocoding(adres);
  const cacheKey = cleaned.trim().toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey) || null;

  // Próba 1: pełny oczyszczony adres
  const attempts = [cleaned];
  // Próba 2: tylko kod pocztowy + miasto (jeśli jest)
  const pcMatch = cleaned.match(/(\d{2}-\d{3})\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s]+)/);
  if (pcMatch) {
    const streetMatch = cleaned.match(/((?:ul\.|al\.|os\.|pl\.)[^,]+)/i);
    if (streetMatch) attempts.push(`${streetMatch[1]}, ${pcMatch[1]} ${pcMatch[2]}`);
    attempts.push(`${pcMatch[1]} ${pcMatch[2]}`);
  }

  for (const attempt of attempts) {
    try {
      const q = encodeURIComponent(attempt + ', Polska');
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=pl`,
        { headers: { 'User-Agent': 'SeweraFleetPlan/1.0' } }
      );
      const data = await res.json();
      if (data && data.length > 0) {
        const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        geocodeCache.set(cacheKey, result);
        return result;
      }
    } catch {
      // Nominatim error — próbuj następny attempt
    }
  }

  geocodeCache.set(cacheKey, null);
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
      return Math.round(data.routes[0].distance / 1000); // metry → km
    }
  } catch {
    // OSRM error
  }
  return null;
}

// Cache dystansu — klucz: "oddzialId:adres"
const distanceCache = new Map<string, number | null>();

// Oblicz dystans od oddziału do adresu dostawy (km po drogach)
export async function calculateDistance(oddzialNazwa: string, adresDostawy: string): Promise<number | null> {
  if (!adresDostawy) return null;

  const cacheKey = `${oddzialNazwa}:${adresDostawy.trim().toLowerCase()}`;
  if (distanceCache.has(cacheKey)) return distanceCache.get(cacheKey) || null;

  const from = getOddzialCoordsByName(oddzialNazwa);
  if (!from) return null;

  const to = await geocodeAddress(adresDostawy);
  if (!to) return null;

  const km = await getRouteDistance(from, to);
  distanceCache.set(cacheKey, km);
  return km;
}
