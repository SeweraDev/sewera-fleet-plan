import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  ODDZIAL_COORDS,
  NAZWA_TO_KOD,
  getRouteAlternatives,
  getRouteGeometry,
  parseCoordsFromQuery,
  pickKmFromAlternatives,
  reverseGeocode,
  searchAddress,
  ODDZIAL_COLORS,
  getOddzialTextColor,
} from '@/lib/oddzialy-geo';
import type { SearchResult } from '@/lib/oddzialy-geo';
import {
  TYPY_KALKULATOR,
  obliczKosztWew,
  obliczKosztyZewWszystkie,
  maStawkiZew,
  findBestAvailableType,
  findAllAvailableTypes,
  mapTypNaCennikowy,
} from '@/lib/stawki-transportowe';
import { TYP_CAPACITY } from '@/lib/suggestRoutes';
import { searchKlienciCache, ensureGeocoded, logSearch, type KlientCacheResult } from '@/lib/wycenaCache';

// Ladownosc per typ CENNIKOWY (nie systemowy) — uzywane do sortowania
// kosztyWew/kosztyZew w spojnej kolejnosci rosnaco po wielkosci pojazdu.
const KG_TYPU_CENNIKOWEGO: Record<string, number> = {
  'do 700kg': 700,
  'do 1,2t bez windy': 1200,
  'z windą do 1,8t': 1800,
  'z windą do 6t': 6300,
  'z windą do 15t': 15800,
  'HDS 9,0t': 9000,
  'HDS 12,0t': 12000,
};

// Sortowanie typow pojazdow rosnaco po ladownosci (kg). Nieznany typ na koncu.
function sortByCapacityKg(typy: string[]): string[] {
  return [...typy].sort((a, b) => {
    const ka = TYP_CAPACITY[a]?.kg ?? 999999;
    const kb = TYP_CAPACITY[b]?.kg ?? 999999;
    return ka - kb;
  });
}

// Filtruje wyniki Photon do unikalnych lokalizacji (grid ~5 km po lat/lng).
// Uzywane do wykrycia ambiguity: gdy user wpisze "Hadex" i Photon zwroci 4 punkty
// w roznych miastach Slaska, pokazujemy je wszystkie w bannerze do wyboru.
function uniqueLocations<T extends { lat: number; lng: number }>(results: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of results) {
    const key = `${r.lat.toFixed(2)},${r.lng.toFixed(2)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

interface WycenTransportTabProps {
  /** Nazwa oddziału zalogowanego usera, np. "Gliwice" */
  oddzialNazwa: string;
  /** Skad pochodzi wycena — do statystyk admina (publiczna_wycena = bez logowania,
   *  wewnetrzna = z aplikacji). Default: 'wewnetrzna'. */
  zrodlo?: 'publiczna_wycena' | 'wewnetrzna';
}

interface KosztZewOferta {
  netto: number;
  brutto: number;
  paletyExtra?: number;
  ladownoscLabel?: string;
}

/** Pojedyncza oferta wew Sewery — typ + cena. Lista bo oddzial moze miec wiele
 *  typow z tej samej rodziny (np. KAT ma HDS 9,0t i HDS 12,0t — pokazujemy oba). */
interface KosztWewOferta {
  typCennikowy: string;
  netto: number;
  brutto: number;
  /** True dla typu wybranego przez usera; false dla fallback z rodziny */
  isOriginal: boolean;
  direction: 'down' | 'up' | null;
  /** True gdy oddzial NIE MA tego typu pojazdu — pokazujemy cene z cennika
   *  (jakby mial), zeby sprzedawca mogl odpowiedziec klientowi.
   *  UI oznacza taka pozycje szaro + ikonka ostrzezenia. */
  brakPojazdu?: boolean;
}

interface WynikOddzialu {
  kod: string;
  nazwa: string;
  km: number;
  /** Lista ofert wew Sewery — kazda z osobna cena per typ. Pusta gdy oddzial nie ma zadnego pasujacego. */
  kosztyWew: KosztWewOferta[];
  /** Lista ofert zewnetrznych - posortowane od najtanszej. Pusta gdy brak. */
  kosztyZew: KosztZewOferta[];
  jestMojOddzial: boolean;
  wewTypy: string[]; // konkretne typy aut wew pasujące do żądanego typu (z bazy flota)
  zewTypy: string[];
}


// Odwrotne mapowanie kod → nazwa
const KOD_TO_NAZWA: Record<string, string> = {};
for (const [nazwa, kod] of Object.entries(NAZWA_TO_KOD)) {
  KOD_TO_NAZWA[kod] = nazwa;
}

// Leaflet lazy load
let leafletLoaded = false;
function loadLeaflet(): Promise<any> {
  if (leafletLoaded && (window as any).L) return Promise.resolve((window as any).L);
  return new Promise((resolve, reject) => {
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if ((window as any).L) { leafletLoaded = true; resolve((window as any).L); return; }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => { leafletLoaded = true; resolve((window as any).L); };
    script.onerror = () => reject(new Error('Leaflet CDN error'));
    document.head.appendChild(script);
  });
}

export function WycenTransportTab({ oddzialNazwa, zrodlo = 'wewnetrzna' }: WycenTransportTabProps) {
  const [typPojazdu, setTypPojazdu] = useState('');
  const [adres, setAdres] = useState('');
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number; hasHouseNumber?: boolean; displayName?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [wyniki, setWyniki] = useState<WynikOddzialu[] | null>(null);
  const [error, setError] = useState('');
  const [pokazZew, setPokazZew] = useState(false);
  // Info o precyzji geocodingu — gdy pin spadl na centroid ulicy (bez numeru),
  // pokazujemy ostrzezenie nad tabela, zeby user wiedzial ze trzeba doprecyzowac.
  const [geocodeWarning, setGeocodeWarning] = useState<string | null>(null);
  // Alternatywy z numerem domu — pokazywane gdy geocoding zwrocil centroid bez
  // numeru. Klikniecie karty od razu uruchamia ponowne wyliczenie.
  const [geocodeAlternatives, setGeocodeAlternatives] = useState<SearchResult[]>([]);

  // Zamrożone parametry z czasu ostatniego udanego wyliczenia (żeby header tabeli
  // nie "kłamał" gdy user zmieni dropdown/adres/oddział bez ponownego kliknięcia Wylicz)
  const [lastCalc, setLastCalc] = useState<{ typ: string; adres: string; oddzialNazwa: string } | null>(null);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);

  // Banner potwierdzajacy lokalizacje — dwa scenariusze:
  //  - 'nameMismatch': geocoder trafil w cos INNEGO niz user wpisal
  //    (np. "romibud czerwionka" → "Urzad Gminy Czerwionka")
  //  - 'ambiguity': fraza pasuje do >=2 roznych lokalizacji
  //    (np. "hadex" → Hadex Katowice / Bieruń / Jastrzębie / Ochaby)
  // W obu przypadkach blokujemy auto-wyliczenie i prosimy o wybor z alternatyw.
  const [pendingConfirm, setPendingConfirm] = useState<{
    coords: { lat: number; lng: number };
    hasHouseNumber: boolean;
    displayName: string;
    queryAdres: string;
    alternatives: SearchResult[];
    reason: 'nameMismatch' | 'ambiguity';
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Mini-mapa state
  const [dostawaCoords, setDostawaCoords] = useState<{ lat: number; lng: number } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  // Klikniety wiersz tabeli wynikow — rysujemy trase tylko dla wybranego oddzialu
  // w jego kolorze (Opcja B z 12.05). Brak konfliktu z kolorami rankingu tabeli.
  const [selectedOddzialKod, setSelectedOddzialKod] = useState<string | null>(null);
  // Cache geometrii — klucz: kod oddzialu. Resetowany przy nowych wyliczeniach.
  const routeCacheRef = useRef<Map<string, [number, number][]>>(new Map());
  // Layer polyline na mapie — trzymamy referencje zeby usunac przy zmianie wyboru.
  const routeLayerRef = useRef<any>(null);

  const mojKod = NAZWA_TO_KOD[oddzialNazwa] || '';

  // Czy user zalogowany — uzywane do flagi w log statystyk
  const [zalogowany, setZalogowany] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setZalogowany(!!data.session));
  }, []);

  // Debounced address search
  const handleAdresChange = (val: string) => {
    setAdres(val);
    setSelectedCoords(null);
    // Edycja pola → banner "czy to ten adres?" znika (nieaktualny dla nowego query)
    if (pendingConfirm) setPendingConfirm(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // GPS bypass — jesli user wkleil wspolrzedne lub link Google Maps,
    // omijamy autocomplete i ustawiamy coords bezposrednio. Przydatne dla
    // budow bez adresu pocztowego (klient daje pinezke z Google Maps).
    // hasHouseNumber=true bo GPS to dokladny punkt na mapie — nie pokazujemy
    // ostrzezenia "adres niedokladny" mimo ze tekstowo brak numeru domu.
    const gpsCoords = parseCoordsFromQuery(val);
    if (gpsCoords) {
      const provisionalName = `${gpsCoords.lat.toFixed(5)}, ${gpsCoords.lng.toFixed(5)}`;
      setSelectedCoords({
        lat: gpsCoords.lat,
        lng: gpsCoords.lng,
        hasHouseNumber: true,
        displayName: provisionalName,
      });
      setSuggestions([]);
      setShowSuggestions(false);
      // Reverse geocode w tle - jesli Photon zwroci nazwe miejsca, podmieniamy
      // displayName z surowych wspolrzednych na ladniejszy adres ("ul. X, Miasto").
      reverseGeocode(gpsCoords.lat, gpsCoords.lng).then((name) => {
        if (name) {
          setSelectedCoords((prev) =>
            prev && prev.lat === gpsCoords.lat && prev.lng === gpsCoords.lng
              ? { ...prev, displayName: name }
              : prev
          );
        }
      });
      return;
    }

    if (val.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      // Rownolegle: historia Sewery (z bazy zlecen) + Photon (mapa OSM).
      // Historia ma priorytet bo pochodzi z naszych rzeczywistych dostaw — najpewniejsze.
      const [cacheResults, photonResults] = await Promise.all([
        searchKlienciCache(val),
        searchAddress(val),
      ]);
      // Pomin Photon-wyniki ktore duplikuja cache (po lat/lng z dokladnoscia ~100m).
      // needsGeocode w cache = lat=0/lng=0, wiec nie zaduplikuja sie z Photon.
      const cacheWithCoords = cacheResults.filter(c => !c.needsGeocode);
      const filteredPhoton = photonResults.filter(p =>
        !cacheWithCoords.some(c => Math.abs(c.lat - p.lat) < 0.001 && Math.abs(c.lng - p.lng) < 0.001)
      );
      const merged: SearchResult[] = [
        ...cacheResults.slice(0, 5),  // top 5 z historii Sewery (z dostawami)
        ...filteredPhoton.slice(0, 5),  // top 5 z OpenStreetMap
      ];
      setSuggestions(merged);
      setShowSuggestions(merged.length > 0);
      setSearching(false);
    }, 300);
  };

  const handleSelectSuggestion = async (s: SearchResult) => {
    setAdres(s.name);
    setSuggestions([]);
    setShowSuggestions(false);

    // Wynik z cache klientow bez lat/lng (needsGeocode=true) — geocode lazy.
    // Jesli kliknal historyczny adres ktory nigdy nie byl geocode'owany,
    // robimy to teraz i zapisujemy w geocode_cache (raz na cala baze).
    const cacheRes = s as KlientCacheResult;
    if (cacheRes.needsGeocode) {
      setSearching(true);
      // Adres bazowy do geocodingu — czysty adres dostawy (bez "Hadex —" prefix dodawanego w UI).
      const adresDoGeo = cacheRes.odbiorca && s.name.includes(' — ')
        ? s.name.split(' — ').slice(1).join(' — ')
        : s.name;
      const geo = await ensureGeocoded(adresDoGeo);
      setSearching(false);
      if (geo) {
        setSelectedCoords({
          lat: geo.lat,
          lng: geo.lng,
          hasHouseNumber: geo.hasHouseNumber,
          displayName: geo.displayName,
        });
        return;
      }
      // Geocode nie powiodl sie — pokazujemy blad, user musi wpisac dokladny adres
      setError(`Nie udało się zlokalizować adresu "${adresDoGeo}". Wpisz ulicę + numer + miasto.`);
      return;
    }

    setSelectedCoords({
      lat: s.lat,
      lng: s.lng,
      hasHouseNumber: s.hasHouseNumber,
      displayName: s.name,
    });
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Klik w wiersz tabeli wynikow — pokaz/ukryj trase dla tego oddzialu.
  // Toggle: ponowny klik w ten sam wiersz = odznacz. Geometria lazy z cache.
  const handleSelectOddzial = useCallback(async (kod: string) => {
    if (selectedOddzialKod === kod) {
      setSelectedOddzialKod(null);
      return;
    }
    // Prefetch geometrii do cache — UI rysuje useEffect ponizej.
    if (!routeCacheRef.current.has(kod)) {
      const oddzialCoord = ODDZIAL_COORDS[kod];
      if (oddzialCoord && dostawaCoords) {
        const geom = await getRouteGeometry(oddzialCoord, dostawaCoords);
        if (geom) routeCacheRef.current.set(kod, geom);
      }
    }
    setSelectedOddzialKod(kod);
  }, [selectedOddzialKod, dostawaCoords]);

  // Render mini-map when wyniki change
  useEffect(() => {
    if (!wyniki || wyniki.length === 0 || !dostawaCoords || !mapContainerRef.current) return;

    loadLeaflet().then(L => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapContainerRef.current, { zoomControl: true, attributionControl: false });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(map);

      const bounds: [number, number][] = [];

      // Pin dostawy (czerwony)
      const deliveryIcon = L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;background:#dc2626;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:bold;">📍</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([dostawaCoords.lat, dostawaCoords.lng], { icon: deliveryIcon })
        .addTo(map)
        .bindPopup(`<b>Dostawa</b><br/>${adres}`);
      bounds.push([dostawaCoords.lat, dostawaCoords.lng]);

      // Piny oddziałów z wyników
      for (const w of wyniki) {
        const coord = ODDZIAL_COORDS[w.kod];
        if (!coord) continue;
        const color = ODDZIAL_COLORS[w.kod] || '#6b7280';
        const textColor = getOddzialTextColor(w.kod);
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:24px;height:24px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:${textColor};font-size:10px;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,.3)">${w.kod}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        L.marker([coord.lat, coord.lng], { icon })
          .addTo(map)
          .bindPopup(`<b>${w.nazwa}</b><br/>${w.km} km`);
        bounds.push([coord.lat, coord.lng]);
      }

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [30, 30] });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 13);
      }
    }).catch(console.error);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      // Layer polyline znika razem z mapa — referencja juz nieaktualna
      routeLayerRef.current = null;
    };
  }, [wyniki, dostawaCoords]);

  // Rysuj/usun polyline gdy zmienia sie wybrany oddzial. Osobny useEffect zeby
  // nie przerysowywac calej mapy (markery + bounds) tylko przy zmianie wyboru.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const L = (window as any).L;
    if (!L) return;

    // Usun poprzednia polyline jesli byla
    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (!selectedOddzialKod) return;
    const geom = routeCacheRef.current.get(selectedOddzialKod);
    if (!geom || geom.length === 0) return;

    const color = ODDZIAL_COLORS[selectedOddzialKod] || '#6b7280';
    const wynik = wyniki?.find(w => w.kod === selectedOddzialKod);
    const polyline = L.polyline(geom, {
      color,
      weight: 5,
      opacity: 0.85,
    }).addTo(map);
    if (wynik) {
      polyline.bindPopup(`<b>${wynik.nazwa}</b> → dostawa<br/>${wynik.km} km`);
    }
    routeLayerRef.current = polyline;
  }, [selectedOddzialKod, wyniki]);

  // Wykonuje calosc obliczenia kosztow dla podanych coords. Wydzielone z
  // handleWylicz, zeby selectAlternative mogl od razu liczyc dla wybranej karty.
  // userPicked=true gdy adres pochodzi z explicite wybranej podpowiedzi
  // (dropdown / banner alternatyw / GPS) — wtedy NIE pokazujemy bannera o braku
  // numeru, bo user widzial i swiadomie potwierdzil ten punkt.
  const runCalculation = useCallback(async (
    coords: { lat: number; lng: number },
    hasHouseNumber: boolean,
    displayName: string,
    queryAdres: string,
    userPicked: boolean = false,
  ) => {
    setLoading(true);
    setError('');
    setWyniki(null);
    setDostawaCoords(coords);
    setGeocodeWarning(null);
    // Reset wyboru trasy — nowy adres = nowe geometrie, stary cache niewazny
    setSelectedOddzialKod(null);
    routeCacheRef.current.clear();

    // Ostrzezenie + alternatywy gdy pin spadl bez numeru — TYLKO gdy user
    // nie wybral swiadomie z listy. Kiedy klika podpowiedz w dropdownie,
    // widzi co wybiera, wiec nie zasypujemy go bannerem.
    if (!hasHouseNumber && !userPicked) {
      setGeocodeWarning(`Adres został zlokalizowany niedokładnie (bez numeru domu): "${displayName}". Sprawdź czerwony pin na mapie. Wybierz właściwy adres z listy poniżej lub wpisz adres z numerem domu.`);
      // Pokaz WSZYSTKIE alternatywy Photon (top 5) — w OSM czesto nie ma numerow
      // na ulicy, ale Photon zwraca rozne dzielnice/centroidy, user wybiera
      try {
        const alts = await searchAddress(queryAdres);
        setGeocodeAlternatives(alts.slice(0, 5));
      } catch {
        setGeocodeAlternatives([]);
      }
    } else {
      setGeocodeAlternatives([]);
    }

    try {

      // 2. Pobierz flotę WSZYSTKICH oddziałów (aktywne pojazdy własne + zewnętrzne)
      // UWAGA: tabela `flota` zawiera kolumne jest_zewnetrzny - zewnetrzne pojazdy
      // moga byc w obu miejscach (flota.jest_zewnetrzny=true lub flota_zewnetrzna).
      // Filtrujemy lokalnie zeby pomylkowo dodane do flota nie trafialy do wlasnej puli.
      // Czytamy z PUBLICZNYCH widokow (publiczna_flota_typy / publiczna_flota_zew_typy)
      // ktore nie ujawniaja wrazliwych pol (nr_rej, telefon, firma) — dzieki temu strona
      // /wycena dziala bez logowania a wewnatrz appki tez czytamy te same dane.
      const { data: flotaDataRaw } = await supabase
        .from('publiczna_flota_typy' as any)
        .select('typ, oddzial_id, jest_zewnetrzny');

      const { data: flotaZewData } = await supabase
        .from('publiczna_flota_zew_typy' as any)
        .select('typ, oddzial_id');

      // Podziel `flota` po jest_zewnetrzny: false/null = wlasne, true = doloz do zewnetrznych
      const flotaWlasnaRaw = (flotaDataRaw || []).filter(f => !(f as any).jest_zewnetrzny);
      const flotaZewExtraRaw = (flotaDataRaw || []).filter(f => !!(f as any).jest_zewnetrzny);
      const flotaZewMerged = [...(flotaZewData || []), ...flotaZewExtraRaw];

      const { data: oddzialyData } = await supabase
        .from('oddzialy')
        .select('id, nazwa');

      const oddzialIdToKod = new Map<number, string>();
      (oddzialyData || []).forEach(o => {
        const kod = NAZWA_TO_KOD[o.nazwa];
        if (kod) oddzialIdToKod.set(o.id, kod);
      });

      const buildTypMap = (data: any[]) => {
        const map = new Map<string, Set<string>>();
        data.forEach(f => {
          if (!f.oddzial_id) return;
          const kod = oddzialIdToKod.get(f.oddzial_id);
          if (!kod) return;
          if (!map.has(kod)) map.set(kod, new Set());
          map.get(kod)!.add(f.typ);
        });
        return map;
      };
      const flotaWlasna = buildTypMap(flotaWlasnaRaw);
      const flotaZew = buildTypMap(flotaZewMerged);

      // KAT i R dzielą fizycznie to samo miejsce (ul. Kościuszki 326) i tę samą flotę.
      // Mergujemy pule typów pod oba klucze, żeby każdy z nich widział wszystkie auta.
      const mergeKATR = (map: Map<string, Set<string>>) => {
        const kat = map.get('KAT') || new Set<string>();
        const r = map.get('R') || new Set<string>();
        const merged = new Set<string>([...kat, ...r]);
        if (merged.size > 0) {
          map.set('KAT', merged);
          map.set('R', merged);
        }
      };
      mergeKATR(flotaWlasna);
      mergeKATR(flotaZew);

      // 3. Oblicz odległość od KAŻDEGO oddziału
      const oddzialy = Object.entries(ODDZIAL_COORDS);
      const oddzialyFiltered = oddzialy.filter(([kod]) => {
        if (kod === 'R' && mojKod !== 'R') return false;
        if (kod === 'KAT' && mojKod === 'R') return false;
        return true;
      });

      const results: WynikOddzialu[] = [];

      for (const [kod, dane] of oddzialyFiltered) {
        const alternatives = await getRouteAlternatives(dane, coords);
        if (!alternatives || alternatives.length === 0) continue;
        // km dla typu wybranego w dropdownie — uzywane w kolumnie km tabeli.
        // isOriginal=true → najkrotsza km (zgodnosc ze starym kalkulatorem).
        // Fallback typy w komorce ceny licza km osobno (mediana / mediana×1,05).
        const km = pickKmFromAlternatives(alternatives, typPojazdu, true);

        const wlasneTypy = flotaWlasna.get(kod) || new Set<string>();
        // Wszystkie dostepne typy z rodziny (oryginalny + fallback chain) — kazdy z osobna cena.
        // KAT z HDS 9,0t i HDS 12,0t pokaze obie ceny przy wyborze HDS 9,0t.
        const dostepneTypy = findAllAvailableTypes(typPojazdu, wlasneTypy);
        const kosztyWew: KosztWewOferta[] = [];
        // Jesli oddzial NIE MA wybranego typu, dodajemy cene "teoretyczna" z cennika
        // z flaga brakPojazdu=true. Dzieki temu sprzedawca w DG (brak 1,2t) widzi
        // ile by kosztowal 1,2t i moze odpowiedziec klientowi lub zlecic innemu
        // oddzialowi (cross-branch). UI oznaczy taka pozycje szaro + ostrzezenie.
        const maWybranyTyp = dostepneTypy.some(d => d.isOriginal);
        if (!maWybranyTyp) {
          // Cena teoretyczna dla wybranego typu — wybrany typ, najkrotsza km
          const kmTeo = pickKmFromAlternatives(alternatives, typPojazdu, true);
          const kosztTeo = obliczKosztWew(kmTeo, typPojazdu);
          if (kosztTeo) {
            kosztyWew.push({
              typCennikowy: typPojazdu,
              netto: kosztTeo.netto,
              brutto: kosztTeo.brutto,
              isOriginal: true,
              direction: null,
              brakPojazdu: true,
            });
          }
        }
        for (const dt of dostepneTypy) {
          // Wybrany typ (isOriginal=true) → najkrotsza. Fallback → strategia per typ
          // (mediana dla 1,8t, mediana×1,05 dla 6t/MAX/HDS). Pozwala pokazac realny
          // koszt dla wybranego typu (jak stary kalkulator) i bufor dla wiekszych aut.
          const kmDlaTypu = pickKmFromAlternatives(alternatives, dt.typ, dt.isOriginal);
          const koszt = obliczKosztWew(kmDlaTypu, dt.typ);
          if (koszt) {
            kosztyWew.push({
              typCennikowy: dt.typ,
              netto: koszt.netto,
              brutto: koszt.brutto,
              isOriginal: dt.isOriginal,
              direction: dt.direction,
            });
          }
        }
        // Sortuj kosztyWew po ladownosci pojazdu rosnaco — spojny porzadek
        // we wszystkich oddzialach (wybrany typ + fallback razem).
        kosztyWew.sort((a, b) => {
          const ka = KG_TYPU_CENNIKOWEGO[a.typCennikowy] ?? 999999;
          const kb = KG_TYPU_CENNIKOWEGO[b.typCennikowy] ?? 999999;
          return ka - kb;
        });

        // Lista typow systemowych z bazy ktore mapuja sie na ktorykolwiek z dostepnych typow cennikowych
        const dostepneTypyCennikowe = new Set(dostepneTypy.map(d => d.typ));
        const matchingWewTypy = [...wlasneTypy].filter(t => {
          const mapped = mapTypNaCennikowy(t);
          return mapped != null && dostepneTypyCennikowe.has(mapped);
        });

        const zewTypy = flotaZew.get(kod) || new Set<string>();
        // ZEW — analogicznie do wew: wszystkie typy z rodziny ktore oddzial ma w flota_zewnetrzna.
        // Kazdy typ -> obliczKosztyZewWszystkie zwraca liste ofert (firm) z STAWKI_ZEW dla tego typu.
        const dostepneTypyZew = findAllAvailableTypes(typPojazdu, zewTypy);
        const kosztyZew: KosztZewOferta[] = [];
        for (const dt of dostepneTypyZew) {
          // Per-typ km (jak dla wew) — wybrany typ → najkrotsza, fallback → mediana/×1,05
          const kmDlaTypu = pickKmFromAlternatives(alternatives, dt.typ, dt.isOriginal);
          const oferty = obliczKosztyZewWszystkie(kmDlaTypu, dt.typ, kod);
          kosztyZew.push(...oferty);
        }
        const dostepneTypyZewSet = new Set(dostepneTypyZew.map(d => d.typ));
        const matchingZewTypy = [...zewTypy].filter(t => {
          const mapped = mapTypNaCennikowy(t);
          return mapped != null && dostepneTypyZewSet.has(mapped);
        });

        results.push({
          kod,
          nazwa: KOD_TO_NAZWA[kod] || kod,
          km,
          kosztyWew,
          kosztyZew,
          jestMojOddzial: kod === mojKod,
          // Sortowanie po ladownosci pojazdu rosnaco — etykiety floty pod
          // nazwa oddzialu pokazuja "Dostawczy 1,2t, Winda 1,8t, Winda 6,3t..."
          // niezaleznie od kolejnosci wpisow w bazie danych.
          wewTypy: sortByCapacityKg(matchingWewTypy),
          zewTypy: sortByCapacityKg(matchingZewTypy),
        });
      }

      // 4. TOP najbliższych oddziałów (decyzja usera 30.04 — szczególnie HDS-y
      // mają wysokie koszty, więc liczy się odległość. Ranking po km, nie po cenie.)
      // Odrzucamy oddzialy z km==0 (cel dostawy = adres oddzialu) — bezsensowna wycena 0 zl.
      const resultsZKm = results.filter(r => r.km > 0);

      // Specjalny case: cel dostawy to adres oddzialu Sewery (km=0 dla najblizszego)
      const odrzuconyOddzial = results.find(r => r.km === 0);
      if (odrzuconyOddzial && resultsZKm.length === 0) {
        setError(`Adres dostawy to lokalizacja oddziału Sewera ${odrzuconyOddzial.nazwa} — wycena transportu nie ma sensu (0 km). Wpisz inny adres docelowy.`);
        setLoading(false);
        return;
      }

      const mojOddzial = resultsZKm.find(r => r.jestMojOddzial);
      const inneNajblizsze = resultsZKm
        .filter(r => !r.jestMojOddzial && (r.kosztyWew.length > 0 || r.kosztyZew.length > 0))
        .sort((a, b) => a.km - b.km)
        .slice(0, 2); // top 2 najbliższych (plus mój = max 3 wiersze)

      const finalResults: WynikOddzialu[] = [];
      if (mojOddzial) finalResults.push(mojOddzial);
      finalResults.push(...inneNajblizsze);

      // Końcowe sortowanie po km — najbliższy pierwszy
      finalResults.sort((a, b) => a.km - b.km);

      const jestZew = finalResults.some(r => r.kosztyZew.length > 0);
      setPokazZew(jestZew);
      setWyniki(finalResults);
      setLastCalc({ typ: typPojazdu, adres: queryAdres, oddzialNazwa });

      // Statystyki: log udane wyliczenie. Best-effort, nie blokuje UI.
      const myResult = finalResults.find(r => r.jestMojOddzial) || finalResults[0];
      const myNetto = myResult?.kosztyWew.find(k => k.isOriginal)?.netto ?? null;
      logSearch({
        query: queryAdres,
        oddzialKod: mojKod,
        typPojazdu,
        znalezionoAdres: displayName,
        hasHouseNumber,
        nameMatch: true, // jesli doszlismy do runCalculation, nameMatch=true (lub user nadpisal)
        zrodlo,
        zalogowany,
        wynikKm: myResult?.km ?? null,
        wynikKosztNetto: myNetto,
      });
    } catch (e) {
      console.error('[WycenTransport] error:', e);
      setError('Wystąpił błąd podczas wyliczania. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }, [typPojazdu, mojKod, oddzialNazwa, zrodlo, zalogowany]);

  // Entry point dla przycisku Wylicz koszt — najpierw geokoduje, potem liczy
  const handleWylicz = useCallback(async () => {
    if (!typPojazdu) {
      setError('Wybierz typ pojazdu');
      return;
    }
    if (!adres || adres.length < 5) {
      setError('Wpisz adres dostawy');
      return;
    }

    setError('');
    setPendingConfirm(null);

    let coords: { lat: number; lng: number };
    let hasHouseNumber: boolean;
    let displayName: string;
    if (selectedCoords) {
      // User wybral z dropdown autocomplete — widzial co wybiera, ufamy mu (skip nameMatch).
      coords = { lat: selectedCoords.lat, lng: selectedCoords.lng };
      hasHouseNumber = !!selectedCoords.hasHouseNumber;
      displayName = selectedCoords.displayName || adres;
    } else {
      // ensureGeocoded zamiast geocodeAddressDetailed — najpierw sprawdza geocode_cache
      // w DB (cache miedzy wszystkimi userami), potem Photon. Zapisuje TYLKO gdy
      // nameMatch=true, zeby nie zaśmiecać bazy niepoprawnymi mapowaniami.
      const detailed = await ensureGeocoded(adres);
      if (!detailed) {
        setError('Nie udało się znaleźć adresu. Spróbuj wpisać dokładny adres: nazwa firmy + miasto, lub ulica + numer (np. "Hadex Tychy" lub "ul. Kościuszki 326, Katowice").');
        // Statystyki: log nieudane wyszukiwanie (zeby admin widzial jakie frazy nie sa znajdowane)
        logSearch({
          query: adres,
          oddzialKod: mojKod,
          typPojazdu,
          znalezionoAdres: null,
          hasHouseNumber: false,
          nameMatch: false,
          zrodlo,
          zalogowany,
          wynikKm: null,
          wynikKosztNetto: null,
        });
        return;
      }
      coords = { lat: detailed.lat, lng: detailed.lng };
      hasHouseNumber = detailed.hasHouseNumber;
      displayName = detailed.displayName;

      // Ochrona przed falszywa wycena — jesli Photon znalazl COS INNEGO niz user wpisal
      // (np. "Romibud Czerwionka" → "Urzad Gminy Czerwionka-Leszczyny"), wymagamy
      // potwierdzenia. Pobieramy tez liste alternatyw z autocomplete.
      if (!detailed.nameMatch) {
        const alternatives = await searchAddress(adres);
        setPendingConfirm({
          coords,
          hasHouseNumber,
          displayName,
          queryAdres: adres,
          alternatives: alternatives.slice(0, 5),
          reason: 'nameMismatch',
        });
        setWyniki(null);
        // Statystyki: log "name mismatch" — system znalazl ale nazwa nie pasuje.
        // Te wyszukiwania trafia do sekcji "wyceny z problemem" w raporcie admina.
        logSearch({
          query: adres,
          oddzialKod: mojKod,
          typPojazdu,
          znalezionoAdres: displayName,
          hasHouseNumber,
          nameMatch: false,
          zrodlo,
          zalogowany,
          wynikKm: null,
          wynikKosztNetto: null,
        });
        return;
      }

      // Ambiguity guard — gdy fraza pasuje do >=2 roznych lokalizacji (np. "hadex"
      // → 4 oddzialy w Slasku), nie zgaduj. Pokaz banner z lista i niech user wybierze.
      // Sprawdzamy tylko gdy user nie wybral z dropdownu — wtedy nie ma pewnosci co dokladnie chcial.
      const allMatches = await searchAddress(adres);
      const distinct = uniqueLocations(allMatches);
      if (distinct.length >= 2) {
        setPendingConfirm({
          coords,
          hasHouseNumber,
          displayName,
          queryAdres: adres,
          alternatives: distinct.slice(0, 6),
          reason: 'ambiguity',
        });
        setWyniki(null);
        return;
      }
    }
    // userPicked = true gdy adres pochodzi z autocomplete (selectedCoords ustawione)
    // lub GPS — user swiadomie wybral punkt, nie pokazujemy bannera o braku numeru.
    await runCalculation(coords, hasHouseNumber, displayName, adres, !!selectedCoords);
  }, [typPojazdu, adres, selectedCoords, runCalculation, mojKod, zrodlo, zalogowany]);

  // User potwierdzil "Tak, wylicz mimo to" w bannerze nameMatch — kontynuujemy wycene
  const confirmAndCalculate = useCallback(async () => {
    if (!pendingConfirm) return;
    const pc = pendingConfirm;
    setPendingConfirm(null);
    await runCalculation(pc.coords, pc.hasHouseNumber, pc.displayName, pc.queryAdres);
  }, [pendingConfirm, runCalculation]);

  // User wybral alternatywe z bannera — przeliczamy dla wybranego punktu
  const confirmAlternative = useCallback(async (s: SearchResult) => {
    setAdres(s.name);
    setSelectedCoords({ lat: s.lat, lng: s.lng, hasHouseNumber: s.hasHouseNumber, displayName: s.name });
    setPendingConfirm(null);
    setSuggestions([]);
    setShowSuggestions(false);
    await runCalculation({ lat: s.lat, lng: s.lng }, !!s.hasHouseNumber, s.name, s.name, true);
  }, [runCalculation]);

  // Wybor alternatywy z banera "bez numeru" — od razu przelicz dla wybranego punktu
  const selectAlternative = useCallback(async (s: SearchResult) => {
    setAdres(s.name);
    setSelectedCoords({ lat: s.lat, lng: s.lng, hasHouseNumber: s.hasHouseNumber, displayName: s.name });
    setSuggestions([]);
    setShowSuggestions(false);
    await runCalculation({ lat: s.lat, lng: s.lng }, !!s.hasHouseNumber, s.name, s.name, true);
  }, [runCalculation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      setShowSuggestions(false);
      handleWylicz();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">💰 Wyceń transport</CardTitle>
        <p className="text-sm text-muted-foreground">
          Wylicz koszt dostawy z oddziału do adresu budowy. Cennik od 1.04.2026.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Formularz */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Typ pojazdu</Label>
            <Select value={typPojazdu} onValueChange={setTypPojazdu}>
              <SelectTrigger><SelectValue placeholder="Wybierz typ" /></SelectTrigger>
              <SelectContent>
                {TYPY_KALKULATOR.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Label className="text-xs text-muted-foreground">Adres dostawy</Label>
            <Input
              ref={inputRef}
              placeholder="np. sewera chrzanów, ul. Śląska 64a"
              value={adres}
              onChange={e => handleAdresChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            />
            {searching && (
              <div className="absolute right-3 top-[50%] translate-y-1">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-72 overflow-auto"
              >
                {suggestions.map((s, i) => {
                  const isCache = s.source === 'cache';
                  const isSewera = s.source === 'sewera';
                  const icon = isCache ? '🏗️' : isSewera ? '🏢' : (s.hasHouseNumber === false ? '📌' : '📍');
                  const iconTitle = isCache ? 'Historyczny adres dostawy Sewery' :
                    isSewera ? 'Oddział Sewery' :
                    s.hasHouseNumber === false ? 'Tylko ulica (bez numeru) — mniej precyzyjne' : 'Konkretny adres z numerem';
                  const rowBg = isCache ? 'bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-900/30' :
                    isSewera ? 'bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-900/30' :
                    'hover:bg-muted';
                  return (
                    <button
                      key={i}
                      className={`w-full text-left px-3 py-2 transition-colors border-b last:border-0 ${rowBg}`}
                      onClick={() => handleSelectSuggestion(s)}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-base leading-tight" title={iconTitle}>{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{s.name}</div>
                          {s.subtitle && (
                            <div className={`text-[11px] ${isCache ? 'text-green-700 dark:text-green-300 font-medium' : 'text-muted-foreground'}`}>
                              {s.subtitle}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {/* Legenda — pomoc dla usera ze kolory cos znacza */}
                {suggestions.some(s => s.source === 'cache') && (
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/50 border-t">
                    🏗️ Historyczny adres Sewery · 🏢 Oddział · 📍 Mapa
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <Button onClick={handleWylicz} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Wyliczam...
                </>
              ) : (
                '🔍 Wylicz koszt'
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        )}

        {/* Banner potwierdzenia lokalizacji — 2 scenariusze:
            - nameMismatch: Photon trafil w INNY obiekt niz nazwa wpisana (Romibud → Urzad Gminy)
            - ambiguity: fraza pasuje do >=2 roznych lokalizacji (Hadex → 4 sklepy w Slasku) */}
        {pendingConfirm && (
          <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-400 dark:border-red-700 rounded-md p-4 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-xl">⚠️</span>
              <div className="flex-1 space-y-2">
                <div className="font-semibold text-red-900 dark:text-red-100">
                  {pendingConfirm.reason === 'ambiguity'
                    ? `Znaleziono kilka lokalizacji "${pendingConfirm.queryAdres}" — wybierz właściwą`
                    : 'Czy to na pewno ten adres?'}
                </div>
                {pendingConfirm.reason === 'nameMismatch' && (
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">Wpisałeś:</span>{' '}
                      <strong>{pendingConfirm.queryAdres}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground">System znalazł:</span>{' '}
                      <strong className="text-red-900 dark:text-red-100">{pendingConfirm.displayName}</strong>
                    </div>
                  </div>
                )}
                <div className="text-xs text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-900/40 p-2 rounded">
                  {pendingConfirm.reason === 'ambiguity'
                    ? '💡 Fraza pasuje do kilku miejsc na mapie. Kliknij właściwą poniżej, żeby wyliczyć koszt dla tej lokalizacji.'
                    : '💡 Znaleziona lokalizacja może nie być tym czego szukasz. System szuka po mapie OpenStreetMap, w której nie wszystkie firmy są oznaczone. Zalecamy wpisać dokładny adres (ulica + numer + miasto) lub wybrać z alternatyw poniżej.'}
                </div>
              </div>
            </div>

            {pendingConfirm.alternatives.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-red-900 dark:text-red-100">
                  {pendingConfirm.reason === 'ambiguity' ? 'Lokalizacje:' : 'Inne propozycje z mapy:'}
                </div>
                <div className="flex flex-col gap-1">
                  {pendingConfirm.alternatives.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => confirmAlternative(s)}
                      disabled={loading}
                      className="text-left px-3 py-2 bg-white dark:bg-red-950/50 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/60 transition-colors disabled:opacity-50"
                    >
                      <div className="text-sm font-medium">📍 {s.name}</div>
                      {s.subtitle && (
                        <div className="text-[11px] text-red-700 dark:text-red-300">{s.subtitle}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPendingConfirm(null);
                  inputRef.current?.focus();
                }}
                className="border-red-400 text-red-900 dark:text-red-100 hover:bg-red-100 dark:hover:bg-red-900/40"
              >
                ✏️ Popraw adres
              </Button>
              {pendingConfirm.reason === 'nameMismatch' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={confirmAndCalculate}
                  disabled={loading}
                  className="text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/40"
                >
                  Wylicz mimo to (ryzyko niepoprawnej wyceny) →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Wyniki */}
        {wyniki && wyniki.length > 0 && lastCalc && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              Wyniki dla: <span className="text-primary">{lastCalc.typ}</span> → {lastCalc.adres}
            </h3>
            {geocodeWarning && (
              <div className="text-sm bg-orange-100 dark:bg-orange-900/30 border border-orange-400 text-orange-900 dark:text-orange-100 p-3 rounded-md space-y-2">
                <div>📌 {geocodeWarning}</div>
                {geocodeAlternatives.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-xs font-semibold">Wybierz precyzyjny adres:</div>
                    <div className="flex flex-col gap-1">
                      {geocodeAlternatives.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => selectAlternative(s)}
                          disabled={loading}
                          className="text-left px-3 py-2 bg-white dark:bg-orange-950/40 border border-orange-300 dark:border-orange-700 rounded hover:bg-orange-50 dark:hover:bg-orange-900/60 transition-colors disabled:opacity-50"
                        >
                          <div className="text-sm font-medium">📍 {s.name}</div>
                          {s.subtitle && (
                            <div className="text-[11px] text-orange-700 dark:text-orange-300">{s.subtitle}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {(typPojazdu !== lastCalc.typ || adres !== lastCalc.adres || oddzialNazwa !== lastCalc.oddzialNazwa) && (
              <div className="text-sm bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 text-yellow-900 dark:text-yellow-100 p-3 rounded-md">
                ⚠️ Zmieniłeś parametry — kliknij <strong>'Wylicz koszt'</strong>, aby zaktualizować wyniki.
              </div>
            )}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 border-r border-gray-400" colSpan={2}></th>
                    <th className="text-center p-2 font-semibold border-b border-r border-gray-400" colSpan={2}>Sewera</th>
                    {pokazZew && (
                      <th className="text-center p-2 font-semibold border-b" colSpan={2}>Zewnętrzny</th>
                    )}
                  </tr>
                  <tr>
                    <th className="text-left p-3 font-medium">Oddział</th>
                    <th className="text-center p-3 font-medium border-r border-gray-400">km</th>
                    <th className="text-center p-3 font-medium">Netto</th>
                    <th className="text-center p-3 font-medium border-r border-gray-400">Brutto</th>
                    {pokazZew && (
                      <>
                        <th className="text-center p-3 font-medium">Netto</th>
                        <th className="text-center p-3 font-medium">Brutto</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {wyniki.map((w, idx) => {
                    const color = getRowColor(idx, wyniki.length);
                    const isSelected = selectedOddzialKod === w.kod;
                    return (
                      <tr
                        key={w.kod}
                        onClick={() => handleSelectOddzial(w.kod)}
                        className={`${color} border-t cursor-pointer transition-shadow hover:brightness-95 ${isSelected ? 'ring-2 ring-inset ring-slate-900 dark:ring-white' : ''}`}
                        title={isSelected ? 'Kliknij ponownie aby ukryć trasę' : 'Kliknij aby pokazać trasę na mapie'}
                      >
                        <td className="p-3 font-medium">
                          {w.jestMojOddzial ? '📍 ' : ''}{w.nazwa}
                          {isSelected && (
                            <span
                              className="ml-1.5 text-[10px] font-bold"
                              style={{ color: ODDZIAL_COLORS[w.kod] || '#6b7280' }}
                              title="Trasa widoczna na mapie"
                            >
                              ▬▬ trasa
                            </span>
                          )}
                          {w.jestMojOddzial && (
                            <span className="text-xs text-muted-foreground ml-1">(Twój)</span>
                          )}
                          {(w.wewTypy || []).length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              🚛 Sewera: {(w.wewTypy || []).join(', ')}
                            </div>
                          )}
                          {(w.zewTypy || []).length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              🚛 zew: {(w.zewTypy || []).join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="text-center p-3 tabular-nums border-r border-gray-400">
                          {w.km} km
                        </td>
                        <td className="text-center p-3 tabular-nums font-bold">
                          {w.kosztyWew.length === 0 ? '—' : (
                            <div className="space-y-1.5">
                              {w.kosztyWew.map((k, i) => (
                                <div
                                  key={i}
                                  className={`${i > 0 ? 'pt-1.5 border-t border-dashed border-muted-foreground/30' : ''} ${k.brakPojazdu ? 'opacity-60' : ''}`}
                                  title={k.brakPojazdu ? 'Brak takiego pojazdu w tym oddziale — cena teoretyczna z cennika' : undefined}
                                >
                                  <span>{formatPLN(k.netto)}</span>
                                  <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">({k.typCennikowy})</span>
                                  {!k.isOriginal && k.direction && (
                                    <span className="ml-1 text-[10px] text-orange-600 dark:text-orange-400">
                                      {k.direction === 'up' ? '↑' : '↓'}
                                    </span>
                                  )}
                                  {k.brakPojazdu && (
                                    <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400" title="Oddział nie ma tego pojazdu — cena z cennika">
                                      ⚠️ brak pojazdu
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="text-center p-3 tabular-nums border-r border-gray-400">
                          {w.kosztyWew.length === 0 ? '—' : (
                            <div className="space-y-1.5">
                              {w.kosztyWew.map((k, i) => (
                                <div
                                  key={i}
                                  className={`${i > 0 ? 'pt-1.5 border-t border-dashed border-muted-foreground/30' : ''} ${k.brakPojazdu ? 'opacity-60' : ''}`}
                                >
                                  {formatPLN(k.brutto)}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        {pokazZew && (
                          <>
                            <td className="text-center p-3 tabular-nums font-bold">
                              {w.kosztyZew.length === 0 ? '—' : (
                                <div className="space-y-1.5">
                                  {w.kosztyZew.map((k, i) => (
                                    <div key={i} className={i > 0 ? 'pt-1.5 border-t border-dashed border-muted-foreground/30' : ''}>
                                      <span>{formatPLN(k.netto)}</span>
                                      {k.ladownoscLabel && (
                                        <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">({k.ladownoscLabel})</span>
                                      )}
                                      {(k.paletyExtra ?? 0) > 0 && (
                                        <div className="text-[10px] text-amber-700 dark:text-amber-400 font-normal" title="Dodatkowa oplata za rozladunek (mnozona przez liczbe palet)">
                                          + {k.paletyExtra} zł / paleta rozładunek
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="text-center p-3 tabular-nums">
                              {w.kosztyZew.length === 0 ? '—' : (
                                <div className="space-y-1.5">
                                  {w.kosztyZew.map((k, i) => (
                                    <div key={i} className={i > 0 ? 'pt-1.5 border-t border-dashed border-muted-foreground/30' : ''}>
                                      {formatPLN(k.brutto)}
                                      {(k.paletyExtra ?? 0) > 0 && <div className="text-[10px] font-normal opacity-0">.</div>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mini-mapa */}
            <div
              ref={mapContainerRef}
              className="w-full h-[450px] rounded-lg border overflow-hidden"
            />

          </div>
        )}

        {wyniki && wyniki.length === 0 && (
          <div className="text-sm text-muted-foreground bg-muted p-4 rounded-md text-center">
            Nie udało się wyliczyć kosztów. Sprawdź adres i spróbuj ponownie.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// HELPERS
// ============================================================

function formatPLN(amount: number): string {
  return amount.toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' zł';
}

function getRowColor(idx: number, total: number): string {
  if (total === 1) return 'bg-green-200 dark:bg-green-900/50';
  if (idx === 0) return 'bg-green-200 dark:bg-green-900/50';
  if (idx === total - 1) return 'bg-red-200 dark:bg-red-900/50';
  return 'bg-yellow-200 dark:bg-yellow-900/50';
}
