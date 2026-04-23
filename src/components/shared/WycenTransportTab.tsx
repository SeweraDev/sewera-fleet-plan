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
  geocodeAddress,
  getRouteAlternatives,
  pickKmFromAlternatives,
  searchAddress,
} from '@/lib/oddzialy-geo';
import type { SearchResult } from '@/lib/oddzialy-geo';
import {
  TYPY_KALKULATOR,
  obliczKosztWew,
  obliczKosztZew,
  listApplicableTypes,
} from '@/lib/stawki-transportowe';
import type { KosztTransportu } from '@/lib/stawki-transportowe';

interface WycenTransportTabProps {
  /** Nazwa oddziału zalogowanego usera, np. "Gliwice" */
  oddzialNazwa: string;
}

interface WycenaOpcja {
  typ: string; // typ cennikowy np. 'HDS 9,0t'
  koszt: KosztTransportu;
  isFallback: boolean;
  direction: 'down' | 'up' | null;
  rawTypy: string[]; // konkretne typy systemowe w puli (np. ['HDS 11,7t'])
}

interface WynikOddzialu {
  kod: string;
  nazwa: string;
  km: number;
  wewOpcje: WycenaOpcja[];
  zewOpcje: WycenaOpcja[];
  jestMojOddzial: boolean;
}

const MAX_KM_INNE_ODDZIALY = 25;

const ODDZIAL_COLORS: Record<string, string> = {
  KAT: '#dc2626', R: '#7c3aed', SOS: '#1e40af', GL: '#059669',
  DG: '#ea580c', TG: '#0891b2', CH: '#be185d', OS: '#ca8a04',
};

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
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [wyniki, setWyniki] = useState<WynikOddzialu[] | null>(null);
  const [error, setError] = useState('');
  const [pokazZew, setPokazZew] = useState(false);

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
    setSelectedCoords({ lat: s.lat, lng: s.lng });
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
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:24px;height:24px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:bold;">${w.kod}</div>`,
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

    try {
      // 1. Geocoduj adres (użyj wybranych coords jeśli mamy)
      const coords = selectedCoords || await geocodeAddress(adres);
      if (!coords) {
        setError('Nie udało się znaleźć adresu. Spróbuj podać bardziej szczegółowy adres (ulica, kod pocztowy, miasto).');
        setLoading(false);
        return;
      }
      setDostawaCoords(coords);

      // 2. Pobierz flotę WSZYSTKICH oddziałów (aktywne pojazdy własne + zewnętrzne)
      const { data: flotaData } = await supabase
        .from('flota')
        .select('typ, oddzial_id')
        .eq('aktywny', true);

      const { data: flotaZewData } = await supabase
        .from('flota_zewnetrzna')
        .select('typ, oddzial_id')
        .eq('aktywny', true);

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
      const flotaWlasna = buildTypMap(flotaData || []);
      const flotaZew = buildTypMap(flotaZewData || []);

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
        const km = pickKmFromAlternatives(alternatives);

        // Wew: wszystkie aplikowalne typy z puli własnej → po jednym wpisie per typ cennikowy
        const wlasneTypy = flotaWlasna.get(kod) || new Set<string>();
        const wewAppl = listApplicableTypes(typPojazdu, wlasneTypy);
        const wewOpcje: WycenaOpcja[] = [];
        for (const a of wewAppl) {
          const koszt = obliczKosztWew(km, a.typ);
          if (!koszt) continue;
          wewOpcje.push({
            typ: a.typ,
            koszt,
            isFallback: a.isFallback,
            direction: a.direction,
            rawTypy: a.rawTypy,
          });
        }

        // Zew: wszystkie aplikowalne typy z puli zewnętrznej → po jednym wpisie per typ cennikowy
        const zewTypySet = flotaZew.get(kod) || new Set<string>();
        const zewAppl = listApplicableTypes(typPojazdu, zewTypySet);
        const zewOpcje: WycenaOpcja[] = [];
        for (const a of zewAppl) {
          const koszt = obliczKosztZew(km, a.typ, kod);
          if (!koszt) continue;
          zewOpcje.push({
            typ: a.typ,
            koszt,
            isFallback: a.isFallback,
            direction: a.direction,
            rawTypy: a.rawTypy,
          });
        }

        results.push({
          kod,
          nazwa: KOD_TO_NAZWA[kod] || kod,
          km,
          wewOpcje,
          zewOpcje,
          jestMojOddzial: kod === mojKod,
        });
      }

      // 4. Filtruj
      const minCena = (r: WynikOddzialu): number => {
        const all = [...r.wewOpcje, ...r.zewOpcje].map(o => o.koszt.netto);
        return all.length > 0 ? Math.min(...all) : 9999;
      };
      const maCene = (r: WynikOddzialu) => r.wewOpcje.length > 0 || r.zewOpcje.length > 0;

      const mojOddzial = results.find(r => r.jestMojOddzial);
      const inne = results
        .filter(r => !r.jestMojOddzial && r.km <= MAX_KM_INNE_ODDZIALY && maCene(r))
        .sort((a, b) => minCena(a) - minCena(b));

      const finalResults: WynikOddzialu[] = [];
      if (mojOddzial) finalResults.push(mojOddzial);
      for (const r of inne) {
        finalResults.push(r);
      }

      finalResults.sort((a, b) => minCena(a) - minCena(b));

      const jestZew = finalResults.some(r => r.zewOpcje.length > 0);
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
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-0"
                    onClick={() => handleSelectSuggestion(s)}
                  >
                    📍 {s.name}
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
                    const wewOpcje = w.wewOpcje || [];
                    const zewOpcje = w.zewOpcje || [];
                    const wewRawy = Array.from(new Set(wewOpcje.flatMap(o => o.rawTypy || [])));
                    const zewRawy = Array.from(new Set(zewOpcje.flatMap(o => o.rawTypy || [])));
                    return (
                      <tr key={w.kod} className={`${color} border-t align-top`}>
                        <td className="p-3 font-medium">
                          {w.jestMojOddzial ? '📍 ' : ''}{w.nazwa}
                          {w.jestMojOddzial && (
                            <span className="text-xs text-muted-foreground ml-1">(Twój)</span>
                          )}
                          {wewRawy.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              🚛 Sewera: {wewRawy.join(', ')}
                            </div>
                          )}
                          {zewRawy.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              🚛 zew: {zewRawy.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="text-center p-3 tabular-nums border-r border-gray-400">
                          {w.km} km
                        </td>
                        <td className="p-3">
                          {renderOpcjeCell(wewOpcje, 'netto')}
                        </td>
                        <td className="p-3 border-r border-gray-400">
                          {renderOpcjeCell(wewOpcje, 'brutto')}
                        </td>
                        {pokazZew && (
                          <>
                            <td className="p-3">
                              {renderOpcjeCell(zewOpcje, 'netto')}
                            </td>
                            <td className="p-3">
                              {renderOpcjeCell(zewOpcje, 'brutto')}
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

            <p className="text-xs text-muted-foreground">
              Ceny netto w PLN (VAT 23%). Odległość w jedną stronę (OSRM).
              Oddziały z odległością {'>'} {MAX_KM_INNE_ODDZIALY} km od budowy nie są wyświetlane (oprócz Twojego).
            </p>
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

function renderOpcjeCell(opcje: WycenaOpcja[] | undefined, field: 'netto' | 'brutto') {
  const list = opcje || [];
  if (list.length === 0) {
    return <div className="text-center tabular-nums">—</div>;
  }
  return (
    <div className="space-y-1">
      {list.map((o, i) => {
        if (!o || !o.koszt) return null;
        return (
          <div key={(o.typ || '') + i} className="text-center tabular-nums leading-tight">
            <div className={field === 'brutto' ? 'font-bold' : ''}>
              {formatPLN(o.koszt[field])}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {o.isFallback && (o.direction === 'up' ? '↑ ' : o.direction === 'down' ? '↓ ' : '↳ ')}
              {o.typ}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getRowColor(idx: number, total: number): string {
  if (total === 1) return 'bg-green-200 dark:bg-green-900/50';
  if (idx === 0) return 'bg-green-200 dark:bg-green-900/50';
  if (idx === total - 1) return 'bg-red-200 dark:bg-red-900/50';
  return 'bg-yellow-200 dark:bg-yellow-900/50';
}
