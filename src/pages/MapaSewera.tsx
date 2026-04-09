import { useState, useEffect, useRef } from 'react';
import { AppLayout } from '@/components/shared/AppLayout';
import { useMapaZlecen } from '@/hooks/useMapaZlecen';
import type { MapaZlecenieDto } from '@/hooks/useMapaZlecen';
import { ODDZIAL_COORDS, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';

// Kolory oddziałów
const ODDZIAL_COLORS: Record<string, string> = {
  KAT: '#dc2626', R: '#7c3aed', SOS: '#1e40af', GL: '#059669',
  DG: '#ea580c', TG: '#0891b2', CH: '#be185d', OS: '#ca8a04',
};
const DEFAULT_COLOR = '#6b7280';

// Kolory per kurs — cykliczne
const KURS_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#ca8a04',
  '#4f46e5', '#0d9488', '#b91c1c', '#65a30d', '#c026d3', '#0284c7', '#ea580c', '#64748b'];

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

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function formatDatePL(iso: string): string {
  const [y, m, d] = iso.split('-');
  const days = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return `${days[date.getDay()]}, ${d}.${m}.${y}`;
}

type ViewMode = 'oddzial' | 'kurs';

export default function MapaSewera() {
  const [dzien, setDzien] = useState(tomorrow);
  const [viewMode, setViewMode] = useState<ViewMode>('oddzial');
  const { zlecenia, loading } = useMapaZlecen(dzien);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const pins = zlecenia.filter(z => z.lat != null && z.lng != null);
  const bezAdresu = zlecenia.filter(z => !z.adres || z.adres.trim().length < 5);
  const czekaNaGeo = zlecenia.filter(z => z.adres && z.adres.trim().length >= 5 && z.lat == null);

  // Statystyki
  const totalKg = zlecenia.reduce((s, z) => s + z.suma_kg, 0);
  const totalZlecen = zlecenia.length;
  const oddzialySet = new Set(zlecenia.map(z => z.oddzial_kod).filter(Boolean));
  const kursySet = new Set(zlecenia.filter(z => z.kurs_id).map(z => z.kurs_id));

  // Nawigacja dnia
  function shiftDay(delta: number) {
    const d = new Date(dzien);
    d.setDate(d.getDate() + delta);
    setDzien(d.toISOString().split('T')[0]);
  }

  // Renderuj mapę
  useEffect(() => {
    let cancelled = false;

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || !L) return;

      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const map = L.map(containerRef.current).setView([50.27, 19.02], 10);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const allPoints: [number, number][] = [];

      // Piny oddziałów Sewera
      const shownCoords = new Set<string>();
      const coordLabels = new Map<string, string[]>();
      for (const [kod, c] of Object.entries(ODDZIAL_COORDS)) {
        const key = c.lat.toFixed(4) + ',' + c.lng.toFixed(4);
        if (!coordLabels.has(key)) coordLabels.set(key, []);
        coordLabels.get(key)!.push(kod);
      }

      for (const [kod, c] of Object.entries(ODDZIAL_COORDS)) {
        const coordKey = c.lat.toFixed(4) + ',' + c.lng.toFixed(4);
        if (shownCoords.has(coordKey)) continue;
        shownCoords.add(coordKey);

        const codes = coordLabels.get(coordKey) || [kod];
        const color = ODDZIAL_COLORS[codes[0]] || DEFAULT_COLOR;
        const label = codes.join('/');

        const icon = L.divIcon({
          className: '',
          html: '<div style="background:' + color + ';width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:bold;letter-spacing:-0.5px">' + label + '</div>',
          iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
        });

        const branchCount = zlecenia.filter(z => codes.includes(z.oddzial_kod)).length;
        L.marker([c.lat, c.lng], { icon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup('<strong>' + label + '</strong><br/>' + c.adres + '<br/><em>' + branchCount + ' zleceń na ' + dzien + '</em>');
      }

      if (viewMode === 'oddzial') {
        renderByOddzial(L, map, pins, allPoints);
      } else {
        renderByKurs(L, map, pins, zlecenia, allPoints);
      }

      if (allPoints.length > 1) {
        map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 13 });
      } else if (allPoints.length === 0) {
        // Pokaż całe Śląskie
        map.setView([50.27, 19.02], 10);
      }
    }).catch(() => {
      if (!cancelled) setMapError('Nie udało się załadować mapy');
    });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [pins.length, viewMode, dzien]);

  return (
    <AppLayout>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">Mapa dostaw</h1>

          {/* Nawigacja dnia */}
          <div className="flex items-center gap-1 bg-muted rounded-lg px-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDay(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="date"
              value={dzien}
              onChange={e => setDzien(e.target.value)}
              className="bg-transparent text-sm font-medium px-2 py-1 border-0 focus:outline-none"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDay(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <span className="text-sm text-muted-foreground">{formatDatePL(dzien)}</span>

          {/* Toggle widoku */}
          <div className="flex items-center gap-1 ml-auto">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <Button
              variant={viewMode === 'oddzial' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('oddzial')}
            >
              Oddziały
            </Button>
            <Button
              variant={viewMode === 'kurs' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('kurs')}
            >
              Kursy
            </Button>
          </div>
        </div>

        {/* Statystyki */}
        <div className="flex flex-wrap gap-4 text-sm">
          <span><strong>{totalZlecen}</strong> zleceń</span>
          <span><strong>{Math.round(totalKg)}</strong> kg</span>
          <span><strong>{oddzialySet.size}</strong> oddziałów</span>
          <span><strong>{kursySet.size}</strong> kursów</span>
          {czekaNaGeo.length > 0 && (
            <span className="text-orange-600">Geokodowanie: {czekaNaGeo.length}...</span>
          )}
          {bezAdresu.length > 0 && (
            <span className="text-red-600">Brak adresu: {bezAdresu.length}</span>
          )}
        </div>

        {/* Mapa */}
        {mapError ? (
          <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">{mapError}</div>
        ) : loading && zlecenia.length === 0 ? (
          <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Ładowanie zleceń...</div>
        ) : (
          <div ref={containerRef} className="rounded-lg border overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 400 }} />
        )}

        {/* Legenda */}
        {viewMode === 'oddzial' ? (
          <div className="flex flex-wrap gap-3 px-1">
            {Array.from(oddzialySet).sort().map(kod => (
              <div key={kod} className="flex items-center gap-1.5 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ background: ODDZIAL_COLORS[kod] || DEFAULT_COLOR }} />
                <span className="font-medium">{kod}</span>
                <span className="text-muted-foreground">
                  ({zlecenia.filter(z => z.oddzial_kod === kod).length})
                </span>
              </div>
            ))}
          </div>
        ) : (
          <KursyLegenda zlecenia={zlecenia} />
        )}
      </div>
    </AppLayout>
  );
}

// --- Renderowanie pinów per oddział ---
function renderByOddzial(L: any, map: any, pins: MapaZlecenieDto[], allPoints: [number, number][]) {
  // Grupuj wg lokalizacji
  const groups = new Map<string, MapaZlecenieDto[]>();
  pins.forEach(z => {
    if (z.lat == null || z.lng == null) return;
    const key = z.lat.toFixed(4) + ',' + z.lng.toFixed(4);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(z);
  });

  groups.forEach((groupPins) => {
    const first = groupPins[0];
    if (first.lat == null || first.lng == null) return;
    allPoints.push([first.lat, first.lng]);

    const color = ODDZIAL_COLORS[first.oddzial_kod] || DEFAULT_COLOR;
    const count = groupPins.length;
    const badge = count > 1
      ? '<span style="position:absolute;top:-6px;right:-6px;background:white;color:' + color + ';border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid ' + color + '">' + count + '</span>'
      : '';

    const icon = L.divIcon({
      className: '',
      html: '<div style="position:relative;background:' + color + ';width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)">' + badge + '</div>',
      iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
    });

    const popupParts = groupPins.map(z => {
      const kg = Math.round(z.suma_kg);
      const m3 = z.suma_m3 > 0 ? ' · ' + (Math.round(z.suma_m3 * 10) / 10) + ' m\u00b3' : '';
      const pal = z.suma_palet > 0 ? ' · ' + z.suma_palet + ' pal' : '';
      const kurs = z.kurs_numer ? ' <span style="color:#059669">[' + z.kurs_nr_rej + ']</span>' : '';
      return '<div style="min-width:200px;padding:3px 0;border-bottom:1px solid #eee">'
        + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (ODDZIAL_COLORS[z.oddzial_kod] || DEFAULT_COLOR) + ';margin-right:4px"></span>'
        + '<strong>' + (z.odbiorca || 'Brak odbiorcy') + '</strong>' + kurs + '<br/>'
        + '<span style="font-size:12px;color:#666">' + (z.adres || '') + '</span><br/>'
        + '<span style="font-size:12px">' + kg + ' kg' + m3 + pal + '</span>'
        + ' <span style="font-size:11px;color:#999">' + z.numer + ' · ' + (z.oddzial_kod || '?') + '</span>'
        + '</div>';
    });

    L.marker([first.lat, first.lng], { icon }).addTo(map).bindPopup(popupParts.join(''), { maxWidth: 350 });
  });
}

// --- Renderowanie pinów per kurs ---
function renderByKurs(L: any, map: any, pins: MapaZlecenieDto[], allZlecenia: MapaZlecenieDto[], allPoints: [number, number][]) {
  // Zbierz unikalne kursy
  const kursIds = [...new Set(allZlecenia.filter(z => z.kurs_id).map(z => z.kurs_id!))];
  const kursColorMap = new Map<string, string>();
  kursIds.forEach((kid, i) => kursColorMap.set(kid, KURS_COLORS[i % KURS_COLORS.length]));

  // Piny z kursem — kolorowane per kurs
  const withKurs = pins.filter(z => z.kurs_id);
  const withoutKurs = pins.filter(z => !z.kurs_id);

  // Grupuj per kurs → rysuj polyline
  kursIds.forEach(kursId => {
    const kursZlecenia = withKurs.filter(z => z.kurs_id === kursId && z.lat != null);
    if (kursZlecenia.length === 0) return;

    const color = kursColorMap.get(kursId) || DEFAULT_COLOR;

    // Znajdź oddział startowy kursu
    const oddzialKod = kursZlecenia[0].oddzial_kod;
    const depot = ODDZIAL_COORDS[oddzialKod];
    const routePoints: [number, number][] = [];
    if (depot) routePoints.push([depot.lat, depot.lng]);

    // Piny przystanków
    const groups = new Map<string, MapaZlecenieDto[]>();
    kursZlecenia.forEach(z => {
      const key = z.lat!.toFixed(4) + ',' + z.lng!.toFixed(4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(z);
    });

    let stopNum = 0;
    groups.forEach((groupPins) => {
      stopNum++;
      const first = groupPins[0];
      allPoints.push([first.lat!, first.lng!]);
      routePoints.push([first.lat!, first.lng!]);

      const icon = L.divIcon({
        className: '',
        html: '<div style="background:' + color + ';width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold">' + stopNum + '</div>',
        iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14],
      });

      const header = '<div style="font-size:11px;color:' + color + ';font-weight:bold;margin-bottom:4px">'
        + '\ud83d\ude9b ' + (first.kurs_nr_rej || '?') + ' · ' + (first.kurs_pojazd_typ || '') + '</div>';

      const popupParts = groupPins.map(z => {
        const kg = Math.round(z.suma_kg);
        const m3 = z.suma_m3 > 0 ? ' · ' + (Math.round(z.suma_m3 * 10) / 10) + ' m\u00b3' : '';
        const pal = z.suma_palet > 0 ? ' · ' + z.suma_palet + ' pal' : '';
        return '<div style="min-width:180px;padding:2px 0;border-bottom:1px solid #eee">'
          + '<strong>' + (z.odbiorca || '?') + '</strong><br/>'
          + '<span style="font-size:12px;color:#666">' + (z.adres || '') + '</span><br/>'
          + '<span style="font-size:12px">' + kg + ' kg' + m3 + pal + '</span>'
          + ' <span style="font-size:11px;color:#999">' + z.numer + '</span>'
          + '</div>';
      });

      L.marker([first.lat!, first.lng!], { icon }).addTo(map).bindPopup(header + popupParts.join(''), { maxWidth: 350 });
    });

    // Polyline trasy
    if (routePoints.length >= 2) {
      L.polyline(routePoints, { color, weight: 3, opacity: 0.7, dashArray: '8, 6' }).addTo(map);
    }
  });

  // Zlecenia bez kursu — szary
  if (withoutKurs.length > 0) {
    const groups = new Map<string, MapaZlecenieDto[]>();
    withoutKurs.forEach(z => {
      const key = z.lat!.toFixed(4) + ',' + z.lng!.toFixed(4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(z);
    });

    groups.forEach((groupPins) => {
      const first = groupPins[0];
      allPoints.push([first.lat!, first.lng!]);

      const count = groupPins.length;
      const badge = count > 1
        ? '<span style="position:absolute;top:-6px;right:-6px;background:white;color:#6b7280;border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid #6b7280">' + count + '</span>'
        : '';

      const icon = L.divIcon({
        className: '',
        html: '<div style="position:relative;background:#6b7280;width:20px;height:20px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3)">' + badge + '</div>',
        iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -12],
      });

      const popupParts = groupPins.map(z => {
        const kg = Math.round(z.suma_kg);
        return '<div style="min-width:180px;padding:2px 0;border-bottom:1px solid #eee">'
          + '<strong>' + (z.odbiorca || '?') + '</strong> <span style="color:#999;font-size:11px">(bez kursu)</span><br/>'
          + '<span style="font-size:12px;color:#666">' + (z.adres || '') + '</span><br/>'
          + '<span style="font-size:12px">' + kg + ' kg · ' + z.numer + ' · ' + z.oddzial_kod + '</span>'
          + '</div>';
      });

      L.marker([first.lat!, first.lng!], { icon }).addTo(map).bindPopup(popupParts.join(''), { maxWidth: 350 });
    });
  }
}

// --- Legenda kursów ---
function KursyLegenda({ zlecenia }: { zlecenia: MapaZlecenieDto[] }) {
  const kursIds = [...new Set(zlecenia.filter(z => z.kurs_id).map(z => z.kurs_id!))];
  const bezKursu = zlecenia.filter(z => !z.kurs_id).length;

  return (
    <div className="flex flex-wrap gap-3 px-1">
      {kursIds.map((kid, i) => {
        const first = zlecenia.find(z => z.kurs_id === kid);
        return (
          <div key={kid} className="flex items-center gap-1.5 text-xs">
            <div className="w-3 h-3 rounded-full" style={{ background: KURS_COLORS[i % KURS_COLORS.length] }} />
            <span className="font-medium">{first?.kurs_nr_rej || '?'}</span>
            <span className="text-muted-foreground">
              {first?.kurs_pojazd_typ || ''} ({zlecenia.filter(z => z.kurs_id === kid).length})
            </span>
          </div>
        );
      })}
      {bezKursu > 0 && (
        <div className="flex items-center gap-1.5 text-xs">
          <div className="w-3 h-3 rounded-full" style={{ background: '#6b7280' }} />
          <span className="text-muted-foreground">Bez kursu ({bezKursu})</span>
        </div>
      )}
    </div>
  );
}
