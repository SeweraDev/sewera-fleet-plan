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
  KAT: { lat: 50.2181, lng: 18.9835, adres: 'ul. Kościuszki 326, 40-608 Katowice' },
  R:   { lat: 50.2181, lng: 18.9835, adres: 'ul. Kościuszki 326, 40-608 Katowice' },
  CH:  { lat: 50.1469, lng: 19.3816, adres: 'ul. Śląska 64a, 32-500 Chrzanów' },
  DG:  { lat: 50.3395, lng: 19.2525, adres: 'ul. Kasprzaka 33, 41-303 Dąbrowa Górnicza' },
  GL:  { lat: 50.2744, lng: 18.6956, adres: 'ul. Dojazdowa 11, 44-100 Gliwice' },
  OS:  { lat: 50.0378, lng: 19.1966, adres: 'ul. Wyzwolenia 19, 32-600 Oświęcim' },
  SOS: { lat: 50.2870, lng: 19.1094, adres: 'ul. Rudna 14, 41-214 Sosnowiec' },
  TG:  { lat: 50.4428, lng: 18.8679, adres: 'ul. Nakielska 24, 42-600 Tarnowskie Góry' },
};

/**
 * Mapowanie prefiksu w numerze dokumentu (Ekonom) → kod oddziału w bazie.
 *
 * Dokumenty Sewery (WZ, WZS, PZ, zamówienia R5/R7) niosą w numerze prefiks
 * oddziału wystawiającego, np. "WZ GL/312/26/05/0008451" → "GL", lub
 * "R5/RE/2026/05/00007" → "RE" (drugi segment).
 *
 * 4 prefiksy różnią się od kodu bazy (KK/RE/SO/OM), pozostałe 4 są identyczne.
 * Potwierdzone przez usera 13.05.2026 na realnych dokumentach.
 */
export const PREFIKS_DOKUMENTU_TO_KOD: Record<string, string> = {
  KK: 'KAT',  // Katowice
  RE: 'R',    // Redystrybucja (ten sam adres co KAT)
  SO: 'SOS',  // Sosnowiec
  OM: 'OS',   // Oświęcim
  GL: 'GL',   // Gliwice (identyczny)
  TG: 'TG',   // Tarnowskie Góry (identyczny)
  CH: 'CH',   // Chrzanów (identyczny)
  DG: 'DG',   // Dąbrowa Górnicza (identyczny)
};

/**
 * Wyciąga kod oddziału wystawiającego z numeru dokumentu (WZ/WZS/PZ lub zamówienie).
 *
 * Priorytet: najpierw numer WZ (najpewniejszy), potem numer zamówienia.
 *
 * Format WZ:        "WZ SO/212/26/04/0013513"   → prefix "SO" → "SOS"
 * Format WZS:       "WZS KK/149/26/05/0000026"  → prefix "KK" → "KAT"
 * Format PZ:        "PZ DG/.../..."             → prefix "DG" → "DG"
 * Format zamówienia: "R5/RE/2026/05/00007"     → drugi segment "RE" → "R"
 *                    "R7/SO/2026/04/00139"     → drugi segment "SO" → "SOS"
 *
 * @returns kod oddziału (KAT/R/SOS/GL/DG/TG/CH/OS) lub null gdy nie udało się rozpoznać
 */
export function wyciagnijOddzialZNumeru(
  numer_wz?: string | null,
  nr_zamowienia?: string | null,
): string | null {
  // 1. Spróbuj z numeru WZ — pierwszy segment po "WZ/WZS/PZ "
  if (numer_wz) {
    const m = numer_wz.match(/^(?:WZS?|PZ)\s+([A-Z]{2})\b/i);
    if (m) {
      const prefix = m[1].toUpperCase();
      const kod = PREFIKS_DOKUMENTU_TO_KOD[prefix];
      if (kod) return kod;
    }
  }
  // 2. Spróbuj z numeru zamówienia — drugi segment po "R5/" lub "R7/" / "T7/" / "K7/" / "O7/"
  if (nr_zamowienia) {
    const m = nr_zamowienia.match(/^[A-Z]\d?\s*\/\s*([A-Z]{2})\b/i);
    if (m) {
      const prefix = m[1].toUpperCase();
      const kod = PREFIKS_DOKUMENTU_TO_KOD[prefix];
      if (kod) return kod;
    }
  }
  return null;
}

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

// Wykrywa GPS w polu adresu - obsluguje 3 formaty:
//   1. Surowe wspolrzedne: "50.2181, 18.9835" lub "50.2181 18.9835"
//   2. Link Google Maps z @lat,lng (np. https://www.google.com/maps/@50.2181,18.9835,15z)
//   3. Link Google Maps z ?q=lat,lng (np. https://maps.google.com/?q=50.2181,18.9835)
//   4. URI geo:lat,lng (mobile share intent)
// Zwraca null gdy query nie pasuje do zadnego formatu lub wspolrzedne sa nieprawidlowe.
// Pozwala wkleic pinezke z Google Maps do pola adresu - przydatne dla budow bez numeru.
export function parseCoordsFromQuery(query: string): { lat: number; lng: number } | null {
  if (!query) return null;
  const trimmed = query.trim();

  // 1. Link Google Maps z @lat,lng (najczesty format share z Google Maps)
  const atMatch = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 2. Link Google Maps z ?q=lat,lng lub &q=lat,lng (URL encoded "%2C" tez OK)
  const qMatch = trimmed.match(/[?&]q=(-?\d+\.\d+)(?:,|%2C|\s)\s*(-?\d+\.\d+)/i);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 3. URI geo:lat,lng (Android share intent)
  const geoMatch = trimmed.match(/^geo:(-?\d+\.\d+),(-?\d+\.\d+)/i);
  if (geoMatch) {
    const lat = parseFloat(geoMatch[1]);
    const lng = parseFloat(geoMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 4. Surowe wspolrzedne "50.2181, 18.9835" lub "50.2181 18.9835"
  // Na koncu bo regex jest najluzniejszy, moglby zlapac falszywie z 1-3.
  const rawMatch = trimmed.match(/^(-?\d{1,2}\.\d+)[\s,]+(-?\d{1,3}\.\d+)$/);
  if (rawMatch) {
    const lat = parseFloat(rawMatch[1]);
    const lng = parseFloat(rawMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  return null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Reverse geocoding - z lat/lng do tekstowego adresu (Photon).
// Uzywane po wykryciu GPS w polu adresu zeby pokazac userowi nazwe miejsca.
// Zwraca null gdy Photon nie znalazl niczego lub blad sieci.
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const f = data.features?.[0];
    if (!f) return null;
    return formatDisplayName(f.properties || {});
  } catch (e) {
    console.warn('[reverse-geocode] error', e);
    return null;
  }
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
 * Strategia wyboru km z alternatyw OSRM (od 12.05.2026, rewizja per-original):
 *
 * ≤ 10 km (krotka trasa miejska) — NAJKROTSZA ×1.1 dla WSZYSTKICH typow:
 *   Decyzja biznesowa: krotkie miejskie trasy zwykle bez objazdow tonazowych,
 *   wszystkie pojazdy realnie pojada najkrotsza. Mnoznik ×1.1 = bufor 10% na
 *   zatory/manewry/parkowanie.
 *
 * > 10 km — strategia zalezna od trybu (isOriginal):
 *
 *   isOriginal === true (typ wybrany przez usera w dropdownie):
 *     → ZAWSZE najkrotsza km, niezaleznie od typu pojazdu.
 *     Zgodnosc ze starym kalkulatorem Sewery — klient zamawiajacy konkretny
 *     typ dostaje cene za najkrotsza droge. Sprzedawca moze podac jasna
 *     cene zgodna z dotychczasowymi praktykami.
 *
 *   isOriginal !== true (fallback — oddzial nie ma wybranego typu, pokazujemy
 *   ceny innych pojazdow z floty albo cene teoretyczna):
 *     - Dostawczy 1,2t → najkrotsza
 *     - Winda 1,8t (lzejsza ciezarowka kat. C) → mediana z alternatyw
 *     - Winda 6,3t / MAX / HDS 9 / HDS 12 → mediana × 1,05
 *     Logika: fallback do wiekszego pojazdu = realna trasa moze byc dluzsza
 *     (ograniczenia tonazowe, drogi przez tereny pokopalniane). Bufor chroni
 *     marze gdy oddzial musi uzyc innego pojazdu niz zamowiony.
 *
 * @param alternatives lista km z OSRM (do 3 wariantów)
 * @param typPojazdu opcjonalny typ — label cennikowy lub systemowy
 * @param isOriginal true gdy to typ wybrany przez usera (najkrotsza), false/undefined gdy fallback
 */
export function pickKmFromAlternatives(alternatives: number[], typPojazdu?: string | null, isOriginal?: boolean): number {
  if (alternatives.length === 0) return 0;
  const sorted = [...alternatives].sort((a, b) => a - b);
  const najkrotsza = sorted[0];

  // Mediana SUROWA (bez zaokraglania — zaokraglimy finalny wynik nizej)
  let mediana: number;
  if (sorted.length >= 3) mediana = sorted[Math.floor(sorted.length / 2)];
  else if (sorted.length === 2) mediana = (sorted[0] + sorted[1]) / 2;
  else mediana = sorted[0];

  const tp = (typPojazdu || '').toLowerCase();
  let surowyKm: number;

  // ≤10 km — najkrotsza ×1.1 dla WSZYSTKICH typow
  if (najkrotsza <= 10) {
    surowyKm = najkrotsza * 1.1;
  } else if (isOriginal === true) {
    // Typ wybrany przez usera → zawsze najkrotsza (zgodnosc ze starym kalkulatorem)
    surowyKm = najkrotsza;
  } else if (tp.includes('1,2t') || tp.includes('dostawczy')) {
    // Fallback dla 1,2t — najkrotsza
    surowyKm = najkrotsza;
  } else if (tp.includes('1,8t') || tp.includes('1,8')) {
    // Fallback dla windy 1,8t — mediana (lzejsza ciezarowka kat. C)
    surowyKm = mediana;
  } else {
    // Fallback dla windy 6,3t / MAX / HDS — mediana × 1,05
    surowyKm = mediana * 1.05;
  }

  // FINALNE zaokraglenie do calych km — jedyne miejsce gdzie zaokraglamy.
  // Math.max(1, ...) tylko gdy surowyKm > 0 — zabezpiecza przed zaokragleniem
  // bardzo krotkich tras (np. 0,4 km KAT → Fabryczna 9 = 357m) do 0 km, co
  // wyrzucalo oddzial z wynikow przez filtr `km > 0`. Surowe 0 (cel = adres
  // oddzialu, OSRM zwraca 0,0 m) zostaje 0 — wtedy slusznie odrzucamy.
  return surowyKm > 0 ? Math.max(1, Math.round(surowyKm)) : 0;
}

// Pobierz WSZYSTKIE warianty trasy z OSRM (do 3 alternatyw).
// Używane razem z pickKmFromAlternatives do wyboru km wg strategii typu pojazdu.
// UWAGA: zwracamy SUROWE km z OSRM (z dwoma miejscami po przecinku). Zaokraglenie
// do calych km odbywa sie dopiero w pickKmFromAlternatives na FINALNYM wyniku —
// inaczej tracimy precyzje (np. 4.77 km najkrotsza × 1.1 powinno dac 5 km, ale
// gdy zaokraglimy 4.77 -> 5 zanim ×1.1, dostajemy 5 × 1.1 = 5.5 -> 6 km).
export async function getRouteAlternatives(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<number[] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=2`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      // Debug: pokaz wszystkie alternatywy OSRM (raw km + czas)
      const debug = data.routes.map((r: any) => ({
        km: +(r.distance / 1000).toFixed(2),
        min: +(r.duration / 60).toFixed(1),
      }));
      console.log(`[osrm-alt] from=(${from.lat.toFixed(4)},${from.lng.toFixed(4)}) to=(${to.lat.toFixed(4)},${to.lng.toFixed(4)})`, debug);
      // Surowe km — zaokraglenie zrobi pickKmFromAlternatives na finalnym wyniku
      const kms = data.routes.map((r: any) => r.distance / 1000);
      return kms;
    }
    console.warn(`[osrm-alt] no routes`, data);
  } catch (e) {
    console.warn(`[osrm-alt] error`, e);
  }
  return null;
}

// Pobierz geometrie trasy (najszybsza wg OSRM) jako lista punktow [lat, lng].
// Uzywane do wizualizacji trasy na mapie (Leaflet polyline). Nie wplywa na km
// w wycenie — to osobne zapytanie z overview=full geometries=geojson.
export async function getRouteGeometry(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<[number, number][] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
      // GeoJSON ma format [lng, lat], Leaflet wymaga [lat, lng]
      return data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
    }
  } catch (e) {
    console.warn(`[osrm-geometry] error`, e);
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
