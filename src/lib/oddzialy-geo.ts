// ============================================================
// KOLORY ODDZIAŁÓW — Wariant C2 (naprzemienne jasność/ciemność)
// ============================================================
// Wybrane 06.05.2026 dla maksymalnej rozróżnialności na mapie OSM.
// Sąsiednie hue mają przeciwną jasność (jeden ciemny, jeden jasny).
// 4 piny (R, DG, TG, CH) maja jasne tlo i wymagaja CIEMNEGO tekstu —
// patrz ODDZIAL_TEXT_DARK ponizej.
//
// Zasada KAT/R: ten sam adres fizyczny → na mapie pin jest pol-na-pol
// (lewa polowa = KAT czerwony, prawa = R fiolet) — patrz MapaSewera.tsx.
export const ODDZIAL_COLORS: Record<string, string> = {
  KAT: '#b91c1c', // red-700 — ciemny czerwony
  R:   '#c084fc', // purple-400 — jasny fiolet (DARK TEXT)
  SOS: '#1e3a8a', // blue-900 — navy ciemny
  GL:  '#15803d', // green-700 — ciemny zielony
  DG:  '#facc15', // yellow-400 — jasny żółty (DARK TEXT)
  TG:  '#22d3ee', // cyan-400 — jasny cyan (DARK TEXT)
  CH:  '#ec4899', // pink-500 — jasny pink (DARK TEXT)
  OS:  '#78350f', // amber-900 — ciemny brąz
};

/** Default color gdy oddzial nieznany. */
export const ODDZIAL_COLOR_DEFAULT = '#6b7280';

/** Oddziały które maja jasne tlo i wymagaja ciemnego tekstu na pinie zamiast bialego. */
const ODDZIAL_TEXT_DARK = new Set(['R', 'DG', 'TG', 'CH']);

/** Zwraca kolor tekstu (białą lub czarny) dla danego kodu oddziału — tak żeby
 * był czytelny na pinie kolorowym ODDZIAL_COLORS[kod]. */
export function getOddzialTextColor(kod: string): string {
  return ODDZIAL_TEXT_DARK.has(kod) ? '#1f2937' : '#ffffff';
}

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
const geocodeCache = new Map<string, GeocodeDetailedResult>();

/** Pełny wynik geocodingu z metadanymi — używane przez UI do oceny precyzji. */
export interface GeocodeDetailedResult {
  lat: number;
  lng: number;
  /** True gdy Photon trafil w konkretny numer domu zgodny z query (lub jakikolwiek
   *  numer gdy query bez numeru). False gdy spadl na centroid ulicy/miasta — wtedy
   *  UI moze ostrzec usera ze trzeba wybrac sugestie z dropdownu. */
  hasHouseNumber: boolean;
  /** Sformatowana nazwa zwrocona przez Photon (ul. + nr + miasto). */
  displayName: string;
  postcode?: string;
  district?: string;
  city?: string;
}

// Wyciagnij numer domu z query (np. "Orla Bialego 29, 41-300" -> "29")
// Numer domu = liczba 1-4 cyfr, opcjonalnie + jedna litera, ZA nazwa ulicy.
// NIE mylic z kodem pocztowym (zawsze 5 cyfr z myslnikiem).
function extractHouseNumber(query: string): string | null {
  // Usun kody pocztowe zeby nie wpadly w match numeru
  const cleaned = query.replace(/\d{2}-?\d{3}/g, '');
  const m = cleaned.match(/\b(\d{1,4}[a-zA-Z]?)\b(?!\s*-\s*\d)/g);
  if (!m) return null;
  // Wez ostatni numer (numer domu zwykle przed kodem pocztowym lub miastem)
  return m[m.length - 1].toLowerCase();
}

function extractPostcode(query: string): string | null {
  const m = query.match(/\b(\d{2}-?\d{3})\b/);
  if (!m) return null;
  const raw = m[1];
  return raw.includes('-') ? raw : `${raw.slice(0, 2)}-${raw.slice(2)}`;
}

// Format display name from Photon properties
function formatDisplayName(props: any): string {
  const parts: string[] = [];
  if (props.street) {
    let s = props.street;
    if (props.housenumber) s += ' ' + props.housenumber;
    parts.push(s);
  } else if (props.name) {
    parts.push(props.name);
  }
  if (props.postcode) parts.push(props.postcode);
  if (props.city) parts.push(props.city);
  else if (props.district) parts.push(props.district);
  else if (props.county) parts.push(props.county);
  return parts.filter(Boolean).join(', ');
}

// Wybierz najlepszy wynik Photon — preferencja:
//   1. housenumber dokladnie pasujacy do query
//   2. postcode dokladnie pasujacy do query
//   3. jakikolwiek housenumber
//   4. pierwszy z listy
function pickBestPhotonFeature(features: any[], wantedNumber: string | null, wantedPostcode: string | null): any | null {
  if (!features || features.length === 0) return null;
  // Bounding box Slask
  const inRegion = features.filter(f => {
    const [lng, lat] = f.geometry?.coordinates || [0, 0];
    return lat >= 49.0 && lat <= 52.0 && lng >= 17.0 && lng <= 21.0;
  });
  if (inRegion.length === 0) return null;

  // 1. Trafienie numeru
  if (wantedNumber) {
    const exact = inRegion.find(f => (f.properties?.housenumber || '').toLowerCase() === wantedNumber);
    if (exact) return exact;
  }
  // 2. Trafienie kodu pocztowego
  if (wantedPostcode) {
    const byPostcode = inRegion.find(f => f.properties?.postcode === wantedPostcode);
    if (byPostcode) return byPostcode;
  }
  // 3. Jakikolwiek numer (lepsze niz centroid ulicy)
  const withNumber = inRegion.find(f => !!f.properties?.housenumber);
  if (withNumber) return withNumber;
  // 4. Pierwszy w regionie
  return inRegion[0];
}

// Geocoding adresu → Photon (Komoot) — darmowy, bez klucza API, bez rate limitu.
// Zwraca podstawowe {lat, lng} dla kompatybilnosci. Pelne metadane uzyj geocodeAddressDetailed.
export async function geocodeAddress(adres: string): Promise<{ lat: number; lng: number } | null> {
  const result = await geocodeAddressDetailed(adres);
  return result ? { lat: result.lat, lng: result.lng } : null;
}

export async function geocodeAddressDetailed(adres: string): Promise<GeocodeDetailedResult | null> {
  if (!adres || adres.length < 5) return null;

  const cleaned = cleanAddressForGeocoding(adres);
  const cacheKey = cleaned.trim().toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  // Buduj query — usuń "ul." prefix (Photon lepiej rozumie bez niego)
  const queryBase = cleaned.replace(/^ul\.\s*/i, '').replace(/,\s*Polska$/i, '');
  const wantedNumber = extractHouseNumber(queryBase);
  const wantedPostcode = extractPostcode(queryBase);

  try {
    const q = encodeURIComponent(queryBase + ' Poland');
    // Limit=5 — szukamy najlepszego wsrod 5 kandydatow (przy limit=1 Photon czesto
    // zwracal centroid ulicy zamiast konkretnego numeru). Patrz pickBestPhotonFeature.
    const res = await fetch(`https://photon.komoot.io/api/?q=${q}&limit=5`);
    if (!res.ok) {
      console.warn(`[geocode] Photon HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const best = pickBestPhotonFeature(data.features, wantedNumber, wantedPostcode);
    if (!best) {
      console.log(`[geocode] empty: "${queryBase}"`);
      return null;
    }
    const [lng, lat] = best.geometry.coordinates;
    const props = best.properties || {};
    const hasHouseNumber = !!props.housenumber && (!wantedNumber || (props.housenumber || '').toLowerCase() === wantedNumber);
    const result: GeocodeDetailedResult = {
      lat,
      lng,
      hasHouseNumber,
      displayName: formatDisplayName(props),
      postcode: props.postcode,
      district: props.district,
      city: props.city,
    };
    console.log(`[geocode] OK: "${queryBase}" → ${result.displayName} (${lat}, ${lng}) precise=${hasHouseNumber}`);
    geocodeCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.warn(`[geocode] error:`, e);
  }

  return null;
}

/**
 * Geocoding z fallbackami — uzyteczne gdy adres ma artefakty OCR (np. "WOLNOSG"
 * zamiast "WOLNOSCI"). Probujemy w kolejnosci:
 *   1. Pelny adres → najdokladniejsze
 *   2. Tylko kod pocztowy + miasto (np. "42-460 Mierzecice") → centroid miasta
 *
 * Zwraca tez flage `exact: true` gdy znalezlismy ulice, `false` gdy spadlismy
 * do centroidu miasta — wtedy UI moze wymagac od user reki korekty.
 */
export interface GeocodeFallbackResult {
  lat: number;
  lng: number;
  exact: boolean;
}

export async function geocodeAddressWithFallback(
  adres: string,
): Promise<GeocodeFallbackResult | null> {
  if (!adres || adres.length < 3) return null;

  // 1. Pelny adres
  const exact = await geocodeAddress(adres);
  if (exact) return { ...exact, exact: true };

  // 2. Fallback — wyciagnij kod pocztowy + miasto, sprobuj zlokalizowac sam ten fragment.
  // Wzorzec: "12-345 Miasto" lub "12345 Miasto" (OCR czesto gubi mysiknik)
  const cityM = adres.match(/(\d{2}-?\d{3})\s+([A-ZĄĆĘŁŃÓŚŹŻ][\w\sĄĆĘŁŃÓŚŹŻąćęłńóśźż\-]+)/);
  if (cityM) {
    const kod = cityM[1].includes("-") ? cityM[1] : `${cityM[1].slice(0, 2)}-${cityM[1].slice(2)}`;
    const miasto = cityM[2].trim().split(/[,\s]+/)[0]; // pierwsze slowo (najczesciej miasto)
    const fallback = await geocodeAddress(`${kod} ${miasto}`);
    if (fallback) return { ...fallback, exact: false };
  }

  // 3. Sam miasto bez kodu (jesli OCR zniszczyl kod)
  const justCity = adres.match(/[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{3,}$/);
  if (justCity) {
    const fallback = await geocodeAddress(justCity[0]);
    if (fallback) return { ...fallback, exact: false };
  }

  return null;
}

// Wyszukiwanie adresów → Photon (autocomplete)
export interface SearchResult {
  name: string;
  lat: number;
  lng: number;
  /** True gdy sugestia wskazuje konkretny numer domu — pewniejszy punkt na mapie.
   *  Sugestie bez numeru sa centroidem ulicy/miasta — wymaga uwagi usera. */
  hasHouseNumber?: boolean;
  postcode?: string;
  district?: string;
  /** Krotki tekst pomocniczy (np. "41-300 Dabrowa Gornicza, Gornicze")
   *  do wyswietlenia pod glowna nazwa w dropdownie. */
  subtitle?: string;
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
    hasHouseNumber: true, // adresy oddzialow sa pelne (ul. + numer)
    subtitle: 'Oddział Sewera',
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

    const photonResults: SearchResult[] = [];
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
      if (seweraResults.some(s => Math.abs(s.lat - lat) < 0.01 && Math.abs(s.lng - lng) < 0.01)) continue;

      // Subtitle: kod pocztowy + miasto + dzielnica — zeby user widzial CO wybiera
      // (rozne dzielnice tego samego miasta to czesty problem przy 'Orla Bialego' w DG itp.)
      const subParts: string[] = [];
      if (props.postcode) subParts.push(props.postcode);
      if (props.city) subParts.push(props.city);
      if (props.district && props.district !== props.city) subParts.push(props.district);

      photonResults.push({
        name,
        lat,
        lng,
        hasHouseNumber: !!props.housenumber,
        postcode: props.postcode,
        district: props.district,
        subtitle: subParts.join(', ') || undefined,
      });
    }
    // Sortuj wyniki Photon — z numerem domu PRZED bez numeru (precyzyjniejsze).
    photonResults.sort((a, b) => {
      const ah = a.hasHouseNumber ? 1 : 0;
      const bh = b.hasHouseNumber ? 1 : 0;
      return bh - ah;
    });
    return [...seweraResults, ...photonResults].slice(0, 8);
  } catch {
    return seweraResults;
  }
}

// Odległość po drogach → OSRM (darmowy publiczny serwer)

// Zaokrąglenie km (bez globalnej korekty). Strategie km zależne od typu pojazdu
// — patrz pickKmFromAlternatives().
function roundKm(rawKm: number): number {
  return Math.round(rawKm);
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

// ============================================================
// LINIA PROSTA (Haversine) — odległość geograficzna po powierzchni Ziemi
// ============================================================
// Używana do rozliczeń karty drogowej i weryfikacji km zgłoszonych przez
// kierowcę — dyspozytor widzi czy km rzeczywiste są sensowne vs prosta.

const EARTH_R = 6371; // km

export function haversineKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_R * c;
}

// Odległość w linii prostej od oddziału do punktu (lat/lng). Zwraca km
// zaokrąglone do jednego miejsca po przecinku (standard dla linii prostej).
export function getKmProstaFromOddzial(
  oddzialNazwa: string,
  lat: number | null | undefined,
  lng: number | null | undefined
): number | null {
  if (lat == null || lng == null) return null;
  const from = getOddzialCoordsByName(oddzialNazwa);
  if (!from) return null;
  const km = haversineKm(from, { lat, lng });
  return Math.round(km * 10) / 10;
}

// ============================================================
// STRATEGIA WYBORU TRASY
// ============================================================
// Dla wszystkich typów pojazdów bierzemy NAJDŁUŻSZĄ z dostępnych alternatyw
// OSRM — biznesowa zasada "nie dopłacać do transportu". Wraz z globalną
// korektą ×1.1 w roundKm daje km porównywalne lub nieco wyższe niż Google,
// co zabezpiecza fakturowanie przed zaniżeniem.

/**
 * Strategia wyboru km z alternatyw OSRM zależna od typu pojazdu:
 *
 * - Dostawczy 1,2t (małe auto) → najkrótsza + warunkowy mnożnik:
 *   - dystans ≤ 10 km → ×1.1 (krótki dystans, ~1-2 km różnicy istotne w cenniku)
 *   - dystans > 10 km → bez mnożnika (OSRM już dokładny)
 *
 * - Pozostałe typy (Winda, HDS) → mediana z alternatyw — odrzucamy 2 skrajne
 *   wartości z 3 alternatyw OSRM (najkrótsza i najdłuższa, zostaje środkowa).
 *   Dla 2 alternatyw → średnia. Dla 1 → ta jedna.
 *   Logika: większe auta jadą głównymi drogami, mediana = realny kompromis.
 *
 * @param alternatives lista km z OSRM (do 3 wariantów)
 * @param typPojazdu opcjonalny typ — label cennikowy lub systemowy
 */
export function pickKmFromAlternatives(alternatives: number[], typPojazdu?: string | null): number {
  if (alternatives.length === 0) return 0;
  const sorted = [...alternatives].sort((a, b) => a - b);

  // Małe auta — najkrótsza, ×1.1 tylko dla dystansu ≤ 10 km
  const tp = (typPojazdu || '').toLowerCase();
  if (tp.includes('1,2t') || tp.includes('dostawczy')) {
    const najkrotsza = sorted[0];
    if (najkrotsza <= 10) {
      return Math.round(najkrotsza * 1.1);
    }
    return najkrotsza;
  }

  // Pozostałe — mediana / środkowa
  if (sorted.length >= 3) {
    return sorted[Math.floor(sorted.length / 2)];
  }
  if (sorted.length === 2) {
    return Math.round((sorted[0] + sorted[1]) / 2);
  }
  return sorted[0];
}

// Pobierz WSZYSTKIE warianty trasy z OSRM (do 3 alternatyw).
// Używane razem z pickKmFromAlternatives do wyboru km wg strategii typu pojazdu.
export async function getRouteAlternatives(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<number[] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=2`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      const kms = data.routes.map((r: any) => roundKm(r.distance / 1000));
      return kms;
    }
    console.warn(`[osrm-alt] no routes`, data);
  } catch (e) {
    console.warn(`[osrm-alt] error`, e);
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

// Oblicz dystans od oddziału do adresu dostawy (km po drogach, najdłuższa
// z alternatyw OSRM + globalna korekta ×1.1 w roundKm).
export async function calculateDistance(
  oddzialNazwa: string,
  adresDostawy: string
): Promise<number | null> {
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

  const alternatives = await getRouteAlternatives(from, to);
  if (!alternatives || alternatives.length === 0) return null;

  const km = pickKmFromAlternatives(alternatives);
  distanceCache.set(cacheKey, km);
  return km;
}
