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
  geocodeAddressDetailed,
  getRouteAlternatives,
  pickKmFromAlternatives,
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

interface WycenTransportTabProps {
  /** Nazwa oddziału zalogowanego usera, np. "Gliwice" */
  oddzialNazwa: string;
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

export function WycenTransportTab({ oddzialNazwa }: WycenTransportTabProps) {
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

  // Zamrożone parametry z czasu ostatniego udanego wyliczenia (żeby header tabeli
  // nie "kłamał" gdy user zmieni dropdown/adres/oddział bez ponownego kliknięcia Wylicz)
  const [lastCalc, setLastCalc] = useState<{ typ: string; adres: string; oddzialNazwa: string } | null>(null);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Mini-mapa state
  const [dostawaCoords, setDostawaCoords] = useState<{ lat: number; lng: number } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  const mojKod = NAZWA_TO_KOD[oddzialNazwa] || '';

  // Debounced address search
  const handleAdresChange = (val: string) => {
    setAdres(val);
    setSelectedCoords(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const results = await searchAddress(val);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setSearching(false);
    }, 300);
  };

  const handleSelectSuggestion = (s: SearchResult) => {
    setAdres(s.name);
    setSelectedCoords({
      lat: s.lat,
      lng: s.lng,
      hasHouseNumber: s.hasHouseNumber,
      displayName: s.name,
    });
    setSuggestions([]);
    setShowSuggestions(false);
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
    };
  }, [wyniki, dostawaCoords]);

  const handleWylicz = useCallback(async () => {
    if (!typPojazdu) {
      setError('Wybierz typ pojazdu');
      return;
    }
    if (!adres || adres.length < 5) {
      setError('Wpisz adres dostawy');
      return;
    }

    setLoading(true);
    setError('');
    setWyniki(null);
    setDostawaCoords(null);
    setGeocodeWarning(null);

    try {
      // 1. Geocoduj adres (użyj wybranych coords jeśli mamy)
      let coords: { lat: number; lng: number } | null;
      let hasHouseNumber: boolean;
      let displayName: string;
      if (selectedCoords) {
        coords = { lat: selectedCoords.lat, lng: selectedCoords.lng };
        hasHouseNumber = !!selectedCoords.hasHouseNumber;
        displayName = selectedCoords.displayName || adres;
      } else {
        const detailed = await geocodeAddressDetailed(adres);
        if (!detailed) {
          setError('Nie udało się znaleźć adresu. Spróbuj podać bardziej szczegółowy adres (ulica, kod pocztowy, miasto).');
          setLoading(false);
          return;
        }
        coords = { lat: detailed.lat, lng: detailed.lng };
        hasHouseNumber = detailed.hasHouseNumber;
        displayName = detailed.displayName;
      }
      if (!coords) {
        setError('Nie udało się znaleźć adresu.');
        setLoading(false);
        return;
      }
      setDostawaCoords(coords);
      // Ostrzeżenie gdy geocoder nie trafił w konkretny numer domu — UI pokaze
      // baner z prosba o klikniecie sugestii z dropdownu (bo wtedy mapa moze
      // pokazywac centroid ulicy lub centroid miasta — niedokladne km).
      if (!hasHouseNumber) {
        setGeocodeWarning(`Adres został zlokalizowany niedokładnie (bez numeru domu): "${displayName}". Sprawdź czerwony pin na mapie. Jeśli to nie ten punkt, wpisz adres ponownie i wybierz właściwą sugestię z listy.`);
      }

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
        const km = pickKmFromAlternatives(alternatives, typPojazdu);

        const wlasneTypy = flotaWlasna.get(kod) || new Set<string>();
        // Wszystkie dostepne typy z rodziny (oryginalny + fallback chain) — kazdy z osobna cena.
        // KAT z HDS 9,0t i HDS 12,0t pokaze obie ceny przy wyborze HDS 9,0t.
        const dostepneTypy = findAllAvailableTypes(typPojazdu, wlasneTypy);
        const kosztyWew: KosztWewOferta[] = [];
        for (const dt of dostepneTypy) {
          const koszt = obliczKosztWew(km, dt.typ);
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
          const oferty = obliczKosztyZewWszystkie(km, dt.typ, kod);
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
          wewTypy: matchingWewTypy,
          zewTypy: matchingZewTypy,
        });
      }

      // 4. TOP najbliższych oddziałów (decyzja usera 30.04 — szczególnie HDS-y
      // mają wysokie koszty, więc liczy się odległość. Ranking po km, nie po cenie.)
      const mojOddzial = results.find(r => r.jestMojOddzial);
      const inneNajblizsze = results
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
      setLastCalc({ typ: typPojazdu, adres, oddzialNazwa });
    } catch (e) {
      console.error('[WycenTransport] error:', e);
      setError('Wystąpił błąd podczas wyliczania. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }, [typPojazdu, adres, mojKod, selectedCoords, oddzialNazwa]);

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
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-auto"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="w-full text-left px-3 py-2 hover:bg-muted transition-colors border-b last:border-0"
                    onClick={() => handleSelectSuggestion(s)}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-tight" title={s.hasHouseNumber ? 'Konkretny adres z numerem' : 'Tylko ulica (bez numeru) — mniej precyzyjne'}>
                        {s.hasHouseNumber === false ? '📌' : '📍'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{s.name}</div>
                        {s.subtitle && (
                          <div className="text-[11px] text-muted-foreground">{s.subtitle}</div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
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

        {/* Wyniki */}
        {wyniki && wyniki.length > 0 && lastCalc && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              Wyniki dla: <span className="text-primary">{lastCalc.typ}</span> → {lastCalc.adres}
            </h3>
            {geocodeWarning && (
              <div className="text-sm bg-orange-100 dark:bg-orange-900/30 border border-orange-400 text-orange-900 dark:text-orange-100 p-3 rounded-md">
                📌 {geocodeWarning}
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
                    return (
                      <tr key={w.kod} className={`${color} border-t`}>
                        <td className="p-3 font-medium">
                          {w.jestMojOddzial ? '📍 ' : ''}{w.nazwa}
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
                                <div key={i} className={i > 0 ? 'pt-1.5 border-t border-dashed border-muted-foreground/30' : ''}>
                                  <span>{formatPLN(k.netto)}</span>
                                  <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">({k.typCennikowy})</span>
                                  {!k.isOriginal && k.direction && (
                                    <span className="ml-1 text-[10px] text-orange-600 dark:text-orange-400">
                                      {k.direction === 'up' ? '↑' : '↓'}
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
                                <div key={i} className={i > 0 ? 'pt-1.5 border-t border-dashed border-muted-foreground/30' : ''}>
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
