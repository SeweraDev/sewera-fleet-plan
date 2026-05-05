import { useEffect, useRef, useState, useMemo } from 'react';
import type { ZlecenieOddzialuDto } from '@/hooks/useZleceniaOddzialu';
import { ODDZIAL_COORDS, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateKurs } from '@/hooks/useCreateKurs';
import { toast } from 'sonner';

// Hook do floty oddzialu i kierowcy — w jednym miejscu zeby nie obciazac
import { useFlotaOddzialu } from '@/hooks/useFlotaOddzialu';
import { useKierowcyOddzialu } from '@/hooks/useKierowcyOddzialu';

// Kolory oddziałów — wyraziste, niepodobne do siebie
const ODDZIAL_COLORS: Record<string, string> = {
  KAT: '#dc2626',  // czerwony
  R:   '#7c3aed',  // fioletowy
  SOS: '#1e40af',  // granatowy
  GL:  '#059669',  // zielony
  DG:  '#ea580c',  // pomarańczowy
  TG:  '#0891b2',  // turkusowy
  CH:  '#be185d',  // różowy
  OS:  '#ca8a04',  // złoty
};
const DEFAULT_COLOR = '#6b7280';

// Ikony pojazdów per typ — pliki w public/icons/
const ICON_VAN = '/icons/van-12t.png';
const ICON_WINDA = '/icons/winda.png';
const ICON_HDS = '/icons/hds.png';

/** Mapuje typ pojazdu (systemowy lub zewn. z prefiksem zew:) na ścieżkę ikony. */
function getVehicleIcon(typ: string | null | undefined): string | null {
  if (!typ) return null;
  const t = typ.toLowerCase().replace(/^zew:/, '').trim();
  if (t.includes('1,2') || t.includes('1.2') || t.includes('dostawcz')) return ICON_VAN;
  if (t.includes('hds')) return ICON_HDS;
  if (t.includes('winda')) return ICON_WINDA;
  return null;
}

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

interface Props {
  zlecenia: ZlecenieOddzialuDto[];
  oddzialCoords: { lat: number; lng: number } | null;
  oddzialNazwa: string;
  /** Dzień (YYYY-MM-DD) — używany do tworzenia kursu w trybie planera. */
  dzien?: string;
  /** ID oddziału — używany do floty/kierowców w trybie planera. */
  oddzialId?: number;
  /** Włącza tryb planera mapowego: panel boczny + selekcja markerów + tworzenie kursu. */
  planerMode?: boolean;
  /** Callback po utworzeniu kursu (refetch listy zleceń itp.). */
  onKursCreated?: () => void;
}

export default function ZleceniaMapView({ zlecenia, oddzialCoords, oddzialNazwa, dzien, oddzialId, planerMode, onKursCreated }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filtry trybu planera
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const baseDzien = dzien || today;
  const [pokazZalegle, setPokazZalegle] = useState(true);

  // Filtruj zlecenia wg trybu planera
  const filteredZlecenia = useMemo(() => {
    if (!planerMode) return zlecenia;
    return zlecenia.filter(z => {
      // Tylko bez kursu (jeszcze niezaplanowane)
      if (z.kurs_numer || z.kurs_nrrej) return false;
      if (z.status === 'anulowana') return false;
      // Wybrany dzień zawsze + zaległe (z poprzednich dni) gdy checkbox włączony
      if (z.dzien === baseDzien) return true;
      if (pokazZalegle && z.dzien < baseDzien) return true;
      return false;
    });
  }, [zlecenia, planerMode, baseDzien, pokazZalegle]);

  const pins = filteredZlecenia.filter(z => z.lat != null && z.lng != null);
  const bezAdresu = filteredZlecenia.filter(z => !z.adres || z.adres.trim().length < 5);
  const czekaNaGeocoding = filteredZlecenia.filter(z => z.adres && z.adres.trim().length >= 5 && z.lat == null);

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Koszyk — zlecenia zaznaczone
  const koszyk = useMemo(
    () => filteredZlecenia.filter(z => selectedIds.has(z.id)),
    [filteredZlecenia, selectedIds]
  );
  const sumaKg = koszyk.reduce((s, z) => s + z.suma_kg, 0);
  const sumaM3 = koszyk.reduce((s, z) => s + z.suma_m3, 0);
  const sumaPal = koszyk.reduce((s, z) => s + z.suma_palet, 0);
  const klasyfikacjeKoszyk = Array.from(new Set(koszyk.flatMap(z => z.klasyfikacje))).sort();

  // Flota i kierowcy — tylko w trybie planera
  const { flota } = useFlotaOddzialu(planerMode ? (oddzialId ?? null) : null);
  const { kierowcy } = useKierowcyOddzialu(planerMode ? (oddzialId ?? null) : null);
  const [pojazdId, setPojazdId] = useState<string>(''); // 'flota:UUID' lub 'zew:NR_REJ'
  const [kierowcaId, setKierowcaId] = useState<string>('');

  const pojazdWybrany = useMemo(() => {
    if (!pojazdId) return null;
    if (pojazdId.startsWith('flota:')) return flota.find(f => f.id === pojazdId.slice(6) && !f.jest_zewnetrzny) || null;
    if (pojazdId.startsWith('zew:')) return flota.find(f => f.nr_rej_raw === pojazdId.slice(4) && f.jest_zewnetrzny) || null;
    return null;
  }, [pojazdId, flota]);

  const procentPojazdu = pojazdWybrany ? (sumaKg / pojazdWybrany.ladownosc_kg) * 100 : 0;

  const { create, submitting } = useCreateKurs(() => {
    setSelectedIds(new Set());
    setPojazdId('');
    setKierowcaId('');
    onKursCreated?.();
  });

  const handleUtworzKurs = async () => {
    if (!oddzialId) { toast.error('Brak ID oddziału'); return; }
    if (koszyk.length === 0) { toast.error('Wybierz przynajmniej jedno zlecenie'); return; }
    if (!pojazdWybrany) { toast.error('Wybierz pojazd'); return; }

    await create({
      oddzial_id: oddzialId,
      dzien: baseDzien,
      kierowca_id: kierowcaId || null,
      flota_id: pojazdWybrany.jest_zewnetrzny ? null : pojazdWybrany.id,
      nr_rej_zewn: pojazdWybrany.jest_zewnetrzny ? (pojazdWybrany.nr_rej_raw ?? null) : null,
      zlecenie_ids: koszyk.map(z => z.id),
    });
  };

  useEffect(() => {
    let cancelled = false;

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || !L) return;

      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const center = oddzialCoords ? [oddzialCoords.lat, oddzialCoords.lng] : [50.27, 19.02];
      const map = L.map(containerRef.current).setView(center, 11);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const allPoints: [number, number][] = [];

      // Piny wszystkich oddziałów Sewera — każdy w swoim kolorze
      const myKod = oddzialNazwa ? (NAZWA_TO_KOD[oddzialNazwa] || '') : '';
      const myColor = ODDZIAL_COLORS[myKod] || DEFAULT_COLOR;
      const shownCoords = new Set<string>();

      // KAT i R mają te same współrzędne — pokaż oba kody
      const coordLabels = new Map<string, string[]>();
      for (const [kod, coords] of Object.entries(ODDZIAL_COORDS)) {
        const key = coords.lat.toFixed(4) + ',' + coords.lng.toFixed(4);
        if (!coordLabels.has(key)) coordLabels.set(key, []);
        coordLabels.get(key)!.push(kod);
      }

      for (const [kod, coords] of Object.entries(ODDZIAL_COORDS)) {
        const coordKey = coords.lat.toFixed(4) + ',' + coords.lng.toFixed(4);
        if (shownCoords.has(coordKey)) continue;
        shownCoords.add(coordKey);

        const codes = coordLabels.get(coordKey) || [kod];
        const isMine = codes.includes(myKod);
        const color = ODDZIAL_COLORS[codes[0]] || DEFAULT_COLOR;
        const label = codes.join('/');

        const size = isMine ? 32 : 24;
        const border = isMine ? '3px solid white' : '2px solid white';
        const shadow = isMine ? '0 2px 8px rgba(0,0,0,.5)' : '0 1px 4px rgba(0,0,0,.3)';
        const fontSize = isMine ? '11px' : '9px';

        const icon = L.divIcon({
          className: '',
          html: '<div style="background:' + color + ';width:' + size + 'px;height:' + size + 'px;border-radius:50%;border:' + border + ';box-shadow:' + shadow + ';display:flex;align-items:center;justify-content:center;color:white;font-size:' + fontSize + ';font-weight:bold;letter-spacing:-0.5px">' + label + '</div>',
          iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -size/2 - 2],
        });

        L.marker([coords.lat, coords.lng], { icon: icon, zIndexOffset: isMine ? 1000 : 0 })
          .addTo(map)
          .bindPopup('<strong>' + label + '</strong><br/>' + coords.adres + (isMine ? '<br/><em>Twoj oddzial</em>' : ''));
      }

      // Grupuj piny zleceń wg lokalizacji
      const groups = new Map<string, typeof pins>();
      pins.forEach(z => {
        if (z.lat == null || z.lng == null) return;
        const key = z.lat.toFixed(4) + ',' + z.lng.toFixed(4);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(z);
      });

      markersRef.current.clear();
      groups.forEach((groupPins) => {
        const first = groupPins[0];
        if (first.lat == null || first.lng == null) return;
        allPoints.push([first.lat, first.lng]);

        // W trybie planera: obwódka zmienia kolor gdy zaznaczony (dowolny WZ z grupy)
        const groupSelected = planerMode && groupPins.some(z => selectedIds.has(z.id));
        const markerColor = groupSelected ? '#10b981' /* zielony */ : myColor;

        // Ikona pojazdu (dominująca w grupie)
        const typCounts = new Map<string, number>();
        groupPins.forEach(z => {
          const iconUrl = getVehicleIcon(z.typ_pojazdu);
          if (iconUrl) typCounts.set(iconUrl, (typCounts.get(iconUrl) || 0) + 1);
        });
        let dominantIcon: string | null = null;
        let maxIconCnt = 0;
        typCounts.forEach((cnt, url) => { if (cnt > maxIconCnt) { maxIconCnt = cnt; dominantIcon = url; } });

        const count = groupPins.length;
        const badge = count > 1
          ? '<span style="position:absolute;top:-8px;right:-8px;background:' + markerColor + ';color:white;border-radius:50%;min-width:18px;height:18px;padding:0 4px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);z-index:2">' + count + '</span>'
          : '';

        const checkmark = groupSelected
          ? '<span style="position:absolute;bottom:-4px;right:-4px;width:16px;height:16px;background:#10b981;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;border:2px solid white;z-index:3">✓</span>'
          : '';

        // Pin: białe koło z obwódką oddziału + ikona pojazdu w środku (jeśli typ rozpoznany)
        const inner = dominantIcon
          ? '<img src="' + dominantIcon + '" style="width:26px;height:26px;object-fit:contain;display:block" alt=""/>'
          : '<div style="width:14px;height:14px;border-radius:50%;background:' + markerColor + '"></div>';

        const icon = L.divIcon({
          className: '',
          html: '<div style="position:relative;background:white;width:36px;height:36px;border-radius:50%;border:3px solid ' + markerColor + ';box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;' + (planerMode ? 'cursor:pointer' : '') + '">' + inner + checkmark + badge + '</div>',
          iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
        });

        const popupParts = groupPins.map(z => {
          const kg = Math.round(z.suma_kg);
          const m3 = z.suma_m3 > 0 ? ' · ' + (Math.round(z.suma_m3 * 10) / 10) + ' m3' : '';
          const pal = z.suma_palet > 0 ? ' · ' + z.suma_palet + ' pal' : '';
          const km = z.dystans_km != null ? ' · ' + z.dystans_km + ' km' : '';
          const typLabel = z.typ_pojazdu ? ' [' + z.typ_pojazdu + ']' : '';
          const isSel = planerMode && selectedIds.has(z.id);
          return '<div style="min-width:180px' + (groupPins.length > 1 ? ';padding:4px 0;border-bottom:1px solid #eee' : '') + (isSel ? ';background:#d1fae5' : '') + '">'
            + '<strong>' + (z.odbiorca || 'Brak odbiorcy') + '</strong>' + typLabel + (isSel ? ' <span style="color:#10b981">✓</span>' : '') + '<br/>'
            + '<span style="font-size:12px;color:#666">' + (z.adres || '') + '</span><br/>'
            + '<span style="font-size:12px">' + kg + ' kg' + m3 + pal + '</span><br/>'
            + '<span style="font-size:12px">' + (z.preferowana_godzina || 'Dowolna') + km + '</span><br/>'
            + '<span style="font-size:11px;color:#999">' + z.numer + '</span>'
            + '</div>';
        });

        const marker = L.marker([first.lat, first.lng], { icon: icon }).addTo(map);
        if (planerMode) {
          // Klik = toggle WSZYSTKICH zleceń w tej grupie (ten sam adres)
          marker.on('click', () => {
            setSelectedIds(prev => {
              const n = new Set(prev);
              const allSelected = groupPins.every(z => n.has(z.id));
              if (allSelected) {
                groupPins.forEach(z => n.delete(z.id));
              } else {
                groupPins.forEach(z => n.add(z.id));
              }
              return n;
            });
          });
          // Klucz markera — pierwszy id z grupy
          markersRef.current.set(first.id, marker);
        } else {
          marker.bindPopup(popupParts.join(''));
        }
      });

      if (allPoints.length > 1) {
        map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 13 });
      }
    }).catch(() => {
      if (!cancelled) setError('Nie udalo sie zaladowac mapy');
    });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [pins.length, oddzialCoords?.lat, oddzialNazwa, planerMode, selectedIds]);

  if (error) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">{error}</div>;
  }

  // W trybie planera: nie blokuj UI gdy brak pinów (może user filtruje datę)
  if (pins.length === 0 && !planerMode) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Ladowanie wspolrzednych... Poczekaj chwile.</div>;
  }

  // Renderowanie z panelem bocznym tylko w trybie planera
  if (planerMode) {
    return (
      <div className="space-y-2">
        {/* Pasek filtrow */}
        <div className="flex items-center gap-3 px-2 py-2 bg-muted/40 rounded-lg text-sm">
          <span className="font-medium">Dzień: <b>{baseDzien}</b></span>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={pokazZalegle} onCheckedChange={(v) => setPokazZalegle(!!v)} />
            <span>Pokaż także zaległe z poprzednich dni</span>
          </label>
          <span className="ml-auto text-xs text-muted-foreground">
            Klik markera = zaznacz / odznacz. Wszystkie zlecenia spod tego adresu wpadną do koszyka.
          </span>
        </div>

        {filteredZlecenia.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Brak zleceń bez kursu na ten dzień{pokazZalegle ? ' ani z poprzednich dni' : ''}.
            {!pokazZalegle && ' Zaznacz checkbox „Pokaż także zaległe z poprzednich dni" powyżej, aby zobaczyć starsze zlecenia.'}
          </div>
        )}
        {filteredZlecenia.length > 0 && pins.length === 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-400">
            🔄 Ładuję współrzędne {filteredZlecenia.length} zleceń... To może potrwać kilkanaście sekund (Photon limit 1 req/s).
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-2">
          <div ref={containerRef} className="rounded-lg border overflow-hidden" style={{ height: 600 }} />

          {/* Panel boczny — koszyk */}
          <div className="rounded-lg border bg-card flex flex-col" style={{ height: 600 }}>
            <div className="px-3 py-2 border-b font-semibold text-sm flex items-center gap-2">
              🧺 Koszyk ({koszyk.length})
              {koszyk.length > 0 && (
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Wyczyść
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {koszyk.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">
                  Klik w marker na mapie, aby dodać zlecenie do koszyka.
                </div>
              ) : (
                koszyk.map(z => (
                  <div key={z.id} className="text-xs p-2 rounded border bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-start justify-between gap-1">
                      <div className="font-medium truncate flex-1">{z.odbiorca || 'Brak odbiorcy'}</div>
                      <button
                        onClick={() => toggleId(z.id)}
                        className="text-red-600 hover:text-red-800 text-xs font-bold"
                        title="Usuń z koszyka"
                      >✕</button>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{z.adres}</div>
                    <div className="flex justify-between text-[10px] mt-0.5">
                      <span>{Math.round(z.suma_kg)} kg{z.suma_palet > 0 ? ` • ${z.suma_palet} pal` : ''}</span>
                      <span className="font-mono text-muted-foreground">{z.numer}</span>
                    </div>
                    {z.klasyfikacje.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {z.klasyfikacje.map(k => (
                          <span key={k} className="text-[9px] px-1 rounded bg-white dark:bg-gray-800 border font-mono">{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Sumy + walidacja */}
            <div className="px-3 py-2 border-t bg-muted/30 text-xs space-y-1">
              <div className="flex justify-between">
                <span>Razem:</span>
                <span className="font-semibold">
                  {Math.round(sumaKg)} kg
                  {sumaM3 > 0 && ` • ${Math.round(sumaM3 * 10) / 10} m³`}
                  {sumaPal > 0 && ` • ${sumaPal} pal`}
                </span>
              </div>
              {klasyfikacjeKoszyk.length > 0 && (
                <div className="flex justify-between">
                  <span>Klasy:</span>
                  <span className="font-mono">{klasyfikacjeKoszyk.join(', ')}</span>
                </div>
              )}
            </div>

            {/* Wybor pojazdu / kierowcy / godziny */}
            <div className="px-3 py-2 border-t space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Pojazd</label>
                <Select value={pojazdId} onValueChange={setPojazdId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Wybierz pojazd…" />
                  </SelectTrigger>
                  <SelectContent>
                    {flota.map(f => (
                      <SelectItem
                        key={(f.jest_zewnetrzny ? 'zew:' + f.nr_rej_raw : 'flota:' + f.id)}
                        value={(f.jest_zewnetrzny ? 'zew:' + f.nr_rej_raw : 'flota:' + f.id)}
                      >
                        {f.nr_rej} • {f.typ} • {Math.round(f.ladownosc_kg / 1000 * 10) / 10}t
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pojazdWybrany && (
                  <div className="mt-1">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${procentPojazdu > 100 ? 'bg-red-500' : procentPojazdu > 90 ? 'bg-orange-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(procentPojazdu, 100)}%` }}
                      />
                    </div>
                    <div className={`text-[10px] mt-0.5 ${procentPojazdu > 100 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                      {Math.round(sumaKg)} / {pojazdWybrany.ladownosc_kg} kg ({Math.round(procentPojazdu)}%)
                      {procentPojazdu > 100 && ' ⚠ przekroczona ładowność'}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground">Kierowca (opcjonalnie)</label>
                <Select value={kierowcaId || '__none__'} onValueChange={(v) => setKierowcaId(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Wybierz kierowcę…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— bez kierowcy —</SelectItem>
                    {kierowcy.map(k => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.imie_nazwisko}{k.uprawnienia ? ` (${k.uprawnienia})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                onClick={handleUtworzKurs}
                disabled={submitting || koszyk.length === 0 || !pojazdWybrany || procentPojazdu > 100}
              >
                {submitting ? 'Tworzenie…' : `✅ Utwórz kurs (${koszyk.length})`}
              </Button>
            </div>
          </div>
        </div>

        {bezAdresu.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-3 py-2 text-xs">
            <span className="font-medium text-red-700 dark:text-red-400">
              Brak adresu w WZ ({bezAdresu.length}) — uzupełnij w zleceniu:
            </span>
            <ul className="mt-1 space-y-0.5 text-red-600 dark:text-red-300">
              {bezAdresu.map(z => (<li key={z.id}>{z.numer} — {z.odbiorca || '?'}</li>))}
            </ul>
          </div>
        )}
        {czekaNaGeocoding.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 px-3 py-2 text-xs">
            <span className="font-medium text-orange-700 dark:text-orange-400">
              ⚠️ Szukam lokalizacji ({czekaNaGeocoding.length})
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div ref={containerRef} className="rounded-lg border overflow-hidden" style={{ height: 600 }} />
      {bezAdresu.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-3 py-2 text-xs">
          <span className="font-medium text-red-700 dark:text-red-400">
            Brak adresu w WZ ({bezAdresu.length}) — uzupelnij w zleceniu:
          </span>
          <ul className="mt-1 space-y-0.5 text-red-600 dark:text-red-300">
            {bezAdresu.map(z => (
              <li key={z.id}>{z.numer} — {z.odbiorca || '?'}</li>
            ))}
          </ul>
        </div>
      )}
      {czekaNaGeocoding.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 px-3 py-2 text-xs">
          <span className="font-medium text-orange-700 dark:text-orange-400">
            ⚠️ Szukam lokalizacji / niezlokalizowane ({czekaNaGeocoding.length}):
          </span>
          <div className="text-[11px] text-orange-600 dark:text-orange-300 mt-0.5">
            Jeśli zlecenie pozostaje tu dłużej — popraw adres w edycji (dodaj ulicę, kod, miasto).
          </div>
          <ul className="mt-1 space-y-0.5 text-orange-600 dark:text-orange-300">
            {czekaNaGeocoding.map(z => (
              <li key={z.id}>{z.numer} — {z.adres}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
