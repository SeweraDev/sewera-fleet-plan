/**
 * Cache klientow Sewery + cache geocodingu + log wyszukiwan.
 *
 * Trzy zadania:
 *  1. searchKlienciCache() — wyszukuje historyczne adresy dostaw Sewery
 *     (np. wpisujesz "Hadex" → "Hadex Tychy, Hadex Bytom" z liczba dostaw).
 *  2. ensureGeocoded() — lazy geocoding, gdy user klikne wynik z cache bez lat/lng.
 *     Wyniki cache'owane w geocode_cache (kazdy adres geocode'owany RAZ na cala bazie).
 *  3. logSearch() — INSERT do wyszukiwania_log (dla statystyk admina).
 *
 * Trzymane oddzielnie od oddzialy-geo.ts zeby nie mieszac warstw (DB vs lib bez DB).
 */
import { supabase } from '@/integrations/supabase/client';
import { geocodeAddressDetailed, type SearchResult } from '@/lib/oddzialy-geo';

/** Wynik z cache klientow z dodatkowymi metadanymi (liczba dostaw, czy trzeba geocode). */
export interface KlientCacheResult extends SearchResult {
  liczbaDostaw: number;
  ostatniaDostawa: string;
  needsGeocode: boolean;
  /** Oryginalna nazwa odbiorcy z bazy (np. "HADEX SP. Z O.O."). Pokazywane w UI. */
  odbiorca: string;
}

/** Wynik z geocode_cache — odpowiednik GeocodeDetailedResult ale z bazy. */
interface GeocodeCacheRow {
  adres_norm: string;
  lat: number;
  lng: number;
  has_house_number: boolean;
  display_name: string | null;
}

// Normalizacja agresywna — uzywana zarowno do dedupu autocomplete (NARMAL
// pojawia sie jako "ŻYTNIA 9 A, SOSNOWIEC" i "ul. ŻYTNIA 9 A, 41-205 SOSNOWIEC"
// dla roznych odbiorcow przy tym samym adresie), jak i do klucza geocode_cache
// (zeby ten sam fizyczny adres trafial w jeden wpis cache, niezaleznie od
// drobnych roznic w zapisie typu prefiksu "ul." czy kodu pocztowego).
function normalizeAdres(adres: string): string {
  return (adres || '')
    .toLowerCase()
    .replace(/\bul\.\s*|\bulica\s+|\bal\.\s*|\baleja\s+/g, '')
    .replace(/\b\d{2}-\d{3}\b/g, '')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Wyszukuje w historii zlecen Sewery klientow/adresy pasujacych do query.
 * Query moze pasowac zarowno do nazwy odbiorcy ("Hadex"), jak i do adresu
 * ("Tychy", "Kościuszki"). Wyniki sortowane: najczesciej wozeni klienci u gory.
 *
 * Dla kazdego adresu sprawdza tez czy mamy juz wspolrzedne w geocode_cache;
 * jesli nie, ustawia needsGeocode=true (geocode odbedzie sie przy kliknieciu).
 */
export async function searchKlienciCache(query: string): Promise<KlientCacheResult[]> {
  if (!query || query.length < 3) return [];

  const q = query.trim();
  // ILIKE szuka case-insensitive. % na obu koncach = zawiera. Bez \\ - postgrest sam escape'uje.
  const orClause = `odbiorca.ilike.%${q}%,adres.ilike.%${q}%`;

  const { data: rows, error } = await supabase
    .from('publiczny_cache_klientow' as any)
    .select('odbiorca, adres, liczba_dostaw, ostatnia_dostawa')
    .or(orClause)
    .order('liczba_dostaw', { ascending: false })
    .limit(20);

  if (error || !rows || rows.length === 0) return [];

  // Dedup po znormalizowanym adresie — ten sam adres moze byc wystawiony na
  // rozne warianty nazwy odbiorcy (np. "NARMAL SZYMONEK 7:00" vs "NARMAL
  // W.SZYMONEK I Z.SZYMONEK SPÓŁKA JAWNA" na ŻYTNIA 9A). Bierzemy odbiorce
  // o najwiekszej liczbie dostaw (tiebreak: najdluzsza nazwa = pelniejsza forma).
  const grouped = new Map<string, { odbiorca: string; adres: string; liczba_dostaw: number; ostatnia_dostawa: string }>();
  for (const r of rows as any[]) {
    const norm = normalizeAdres(r.adres);
    const existing = grouped.get(norm);
    if (!existing) {
      grouped.set(norm, {
        odbiorca: r.odbiorca,
        adres: r.adres,
        liczba_dostaw: r.liczba_dostaw,
        ostatnia_dostawa: r.ostatnia_dostawa,
      });
    } else {
      existing.liczba_dostaw += r.liczba_dostaw;
      if (r.ostatnia_dostawa > existing.ostatnia_dostawa) existing.ostatnia_dostawa = r.ostatnia_dostawa;
      // Wybor odbiorcy: wiekszy liczba_dostaw albo dluzsza nazwa
      if (
        r.liczba_dostaw > existing.liczba_dostaw - r.liczba_dostaw ||
        (r.odbiorca && r.odbiorca.length > (existing.odbiorca || '').length)
      ) {
        existing.odbiorca = r.odbiorca;
      }
    }
  }

  // Spradz ktore adresy mamy juz w geocode_cache (lat/lng od reki).
  const adresyNorm = Array.from(grouped.keys());
  const { data: geoRows } = await supabase
    .from('geocode_cache' as any)
    .select('adres_norm, lat, lng, has_house_number, display_name')
    .in('adres_norm', adresyNorm);

  const geoMap = new Map<string, GeocodeCacheRow>();
  (geoRows as any[] || []).forEach(g => {
    geoMap.set(g.adres_norm, g);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => b[1].liczba_dostaw - a[1].liczba_dostaw)
    .map(([norm, r]) => {
      const geo = geoMap.get(norm);
      const odbiorcaCzysty = (r.odbiorca || '').replace(/sp\.?\s*z?\s*o\.?\s*o\.?/i, '').trim();
      return {
        name: `${odbiorcaCzysty} — ${r.adres}`,
        lat: geo?.lat ?? 0,
        lng: geo?.lng ?? 0,
        hasHouseNumber: geo?.has_house_number ?? false,
        source: 'cache' as const,
        liczbaDostaw: r.liczba_dostaw,
        ostatniaDostawa: r.ostatnia_dostawa,
        odbiorca: r.odbiorca,
        needsGeocode: !geo,
      } as KlientCacheResult;
    });
}

/**
 * Geocode'uje adres jesli nie ma w cache. Po sukcesie zapisuje w geocode_cache —
 * ALE TYLKO gdy nameMatch=true (nazwa znalezionego obiektu pasuje do query).
 *
 * Dlaczego nie zapisujemy gdy nameMatch=false:
 *   Gdyby zapisac "romibud czerwionka" → {lat, lng Urzedu Gminy}, NASTEPNY user
 *   wpisujac to samo dostalby z cache te same zle wspolrzedne BEZ ostrzezenia
 *   (bo cache=zaufane). Truje to baze niepoprawnymi mapowaniami i propaguje blad.
 *   Cache MUSI trzymac tylko potwierdzone mapowania.
 *
 * Idempotentne — drugi raz wywolane dla tego samego adresu zwroci z cache.
 *
 * Zwraca {lat, lng, hasHouseNumber, nameMatch, displayName} lub null gdy Photon nic nie znalazl.
 */
export async function ensureGeocoded(adres: string): Promise<{
  lat: number;
  lng: number;
  hasHouseNumber: boolean;
  nameMatch: boolean;
  displayName: string;
} | null> {
  const norm = normalizeAdres(adres);

  // 1. Sprobuj z cache DB. Wszystko w cache jest "potwierdzone" (nameMatch=true bylo
  //    przy zapisie), wiec mozemy zwrocic nameMatch=true bezwarunkowo.
  const { data: cached } = await supabase
    .from('geocode_cache' as any)
    .select('lat, lng, has_house_number, display_name')
    .eq('adres_norm', norm)
    .maybeSingle();

  if (cached) {
    const row = cached as any;
    // Aktualizuj last_used_at (best-effort, nie blokujemy na bledzie)
    supabase
      .from('geocode_cache' as any)
      .update({ last_used_at: new Date().toISOString() })
      .eq('adres_norm', norm)
      .then(() => {}, () => {});
    return {
      lat: row.lat,
      lng: row.lng,
      hasHouseNumber: row.has_house_number,
      nameMatch: true,
      displayName: row.display_name || adres,
    };
  }

  // 2. Photon (z naszej istniejacej funkcji)
  const detailed = await geocodeAddressDetailed(adres);
  if (!detailed) return null;

  // 3. Zapisz w cache DB — TYLKO gdy nameMatch=true (zob. wyjasnienie na gorze funkcji).
  //    Bez tego sprawdzenia trulibysmy baze "Romibud → Urzad Gminy" i propagowali blad.
  if (detailed.nameMatch) {
    supabase
      .from('geocode_cache' as any)
      .insert({
        adres_norm: norm,
        adres_oryginalny: adres,
        lat: detailed.lat,
        lng: detailed.lng,
        has_house_number: detailed.hasHouseNumber,
        display_name: detailed.displayName,
      })
      .then(() => {}, () => {});
  } else {
    console.log(`[geocode-cache] SKIP zapisu (nameMatch=false): "${adres}" → "${detailed.displayName}"`);
  }

  return {
    lat: detailed.lat,
    lng: detailed.lng,
    hasHouseNumber: detailed.hasHouseNumber,
    nameMatch: detailed.nameMatch,
    displayName: detailed.displayName,
  };
}

/**
 * Zapisuje wyszukiwanie do wyszukiwania_log (statystyki dla admina).
 * Best-effort — nie blokujemy UI na bledzie. Pola opcjonalne sa pomijane gdy null.
 */
export interface LogSearchParams {
  query: string;
  oddzialKod?: string;
  typPojazdu?: string;
  znalezionoAdres?: string;
  hasHouseNumber?: boolean;
  nameMatch?: boolean;
  uzytoCacheKlientow?: boolean;
  zrodlo: 'publiczna_wycena' | 'wewnetrzna';
  zalogowany: boolean;
  wynikKm?: number | null;
  wynikKosztNetto?: number | null;
}

export function logSearch(params: LogSearchParams): void {
  supabase
    .from('wyszukiwania_log' as any)
    .insert({
      query: params.query,
      oddzial_kod: params.oddzialKod ?? null,
      typ_pojazdu: params.typPojazdu ?? null,
      znaleziono_adres: params.znalezionoAdres ?? null,
      has_house_number: params.hasHouseNumber ?? null,
      name_match: params.nameMatch ?? null,
      uzyto_cache_klientow: params.uzytoCacheKlientow ?? false,
      zrodlo: params.zrodlo,
      zalogowany: params.zalogowany,
      wynik_km: params.wynikKm ?? null,
      wynik_koszt_netto: params.wynikKosztNetto ?? null,
    })
    .then(() => {}, (e) => {
      console.warn('[logSearch] failed:', e);
    });
}

