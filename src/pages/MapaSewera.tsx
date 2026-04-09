import { useState, useEffect, useRef } from 'react';
import { AppLayout } from '@/components/shared/AppLayout';
import { useMapaZlecen } from '@/hooks/useMapaZlecen';
import type { MapaZlecenieDto } from '@/hooks/useMapaZlecen';
import { ODDZIAL_COORDS } from '@/lib/oddzialy-geo';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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

export default function MapaSewera() {
  const [dzien, setDzien] = useState(tomorrow);
  const { zlecenia, loading } = useMapaZlecen(dzien);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const pins = zlecenia.filter(z => z.lat != null && z.lng != null);
  const bezAdresu = zlecenia.filter(z => !z.adres || z.adres.trim().length < 5);
  const czekaNaGeo = zlecenia.filter(z => z.adres && z.adres.trim().length >= 5 && z.lat == null);

  // Statystyki
  const wKursach = zlecenia.filter(z => z.kurs_id);
  const bezKursu = zlecenia.filter(z => !z.kurs_id);
  const totalKg = zlecenia.reduce((s, z) => s + z.suma_kg, 0);
  const kursySet = new Set(wKursach.map(z => z.kurs_id));

  function shiftDay(delta: number) {
    const d = new Date(dzien);
    d.setDate(d.getDate() + delta);
    setDzien(d.toISOString().split('T')[0]);
  }

  // Renderuj mapę — jeden widok: kursy (polyline) + zlecenia bez kursu (szare)
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

      // --- Piny oddziałów Sewera ---
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

      // --- KURSY: kolorowe piny + polyline ---
      const kursIds = [...new Set(wKursach.map(z => z.kurs_id!))];
      const kursColorMap = new Map<string, string>();
      kursIds.forEach((kid, i) => kursColorMap.set(kid, KURS_COLORS[i % KURS_COLORS.length]));

      const pinsWKursach = pins.filter(z => z.kurs_id);

      kursIds.forEach(kursId => {
        const kursZl = pinsWKursach.filter(z => z.kurs_id === kursId);
        if (kursZl.length === 0) return;

        const color = kursColorMap.get(kursId) || DEFAULT_COLOR;
        const oddzialKod = kursZl[0].oddzial_kod;
        const depot = ODDZIAL_COORDS[oddzialKod];
        const routePoints: [number, number][] = [];
        if (depot) routePoints.push([depot.lat, depot.lng]);

        // Grupuj per adres w kursie
        const groups = new Map<string, MapaZlecenieDto[]>();
        kursZl.forEach(z => {
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

          const totalKgStop = groupPins.reduce((s, z) => s + z.suma_kg, 0);

          const icon = L.divIcon({
            className: '',
            html: '<div style="background:' + color + ';width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold">' + stopNum + '</div>',
            iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14],
          });

          const header = '<div style="font-size:11px;color:' + color + ';font-weight:bold;margin-bottom:2px">'
            + '\ud83d\ude9b ' + (first.kurs_nr_rej || '?') + ' · ' + (first.kurs_pojazd_typ || '') + '</div>'
            + '<div style="font-size:12px;margin-bottom:4px"><strong>' + (first.adres || '') + '</strong></div>'
            + '<div style="font-size:12px;margin-bottom:4px">' + groupPins.length + ' zlec. · ' + Math.round(totalKgStop) + ' kg</div>';

          const MAX = 5;
          const shown = groupPins.slice(0, MAX);
          const rows = shown.map(z => {
            const kg = Math.round(z.suma_kg);
            return '<div style="padding:2px 0;border-bottom:1px solid #eee;font-size:12px">'
              + '<strong>' + (z.odbiorca || '?') + '</strong> · ' + kg + ' kg'
              + ' <span style="color:#999">' + z.numer + '</span></div>';
          });
          const more = groupPins.length > MAX ? '<div style="font-size:11px;color:#999;padding-top:2px">+ ' + (groupPins.length - MAX) + ' więcej...</div>' : '';

          L.marker([first.lat!, first.lng!], { icon }).addTo(map).bindPopup(
            '<div style="max-height:200px;overflow-y:auto">' + header + rows.join('') + more + '</div>',
            { maxWidth: 320 }
          );
        });

        // Polyline
        if (routePoints.length >= 2) {
          L.polyline(routePoints, { color, weight: 3, opacity: 0.7, dashArray: '8, 6' }).addTo(map);
        }
      });

      // --- ZLECENIA BEZ KURSU: szare piny per oddział ---
      const pinsBezKursu = pins.filter(z => !z.kurs_id);
      if (pinsBezKursu.length > 0) {
        const groups = new Map<string, MapaZlecenieDto[]>();
        pinsBezKursu.forEach(z => {
          const key = z.lat!.toFixed(4) + ',' + z.lng!.toFixed(4);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(z);
        });

        groups.forEach((groupPins) => {
          const first = groupPins[0];
          allPoints.push([first.lat!, first.lng!]);

          const count = groupPins.length;
          // Kolor per oddział (nie szary) — żeby wiedzieć skąd zlecenie
          const pinColor = ODDZIAL_COLORS[first.oddzial_kod] || DEFAULT_COLOR;
          const badge = count > 1
            ? '<span style="position:absolute;top:-6px;right:-6px;background:white;color:' + pinColor + ';border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid ' + pinColor + '">' + count + '</span>'
            : '';

          // Kwadratowy pin żeby odróżnić od kursów (okrągłe)
          const icon = L.divIcon({
            className: '',
            html: '<div style="position:relative;background:' + pinColor + ';width:18px;height:18px;border-radius:3px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3);opacity:0.7">' + badge + '</div>',
            iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -11],
          });

          const totalKgNk = groupPins.reduce((s, z) => s + z.suma_kg, 0);
          const oddzialy = [...new Set(groupPins.map(z => z.oddzial_kod))].join(', ');
          const nkHeader = '<div style="font-weight:bold;margin-bottom:2px">' + (first.adres || '?') + '</div>'
            + '<div style="font-size:12px;color:#ea580c;margin-bottom:4px">\u26a0 ' + count + ' zlec. BEZ KURSU · ' + Math.round(totalKgNk) + ' kg · ' + oddzialy + '</div>';

          const MAX_NK = 5;
          const shownNk = groupPins.slice(0, MAX_NK);
          const rows = shownNk.map(z => {
            const kg = Math.round(z.suma_kg);
            return '<div style="padding:2px 0;border-bottom:1px solid #eee;font-size:12px">'
              + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (ODDZIAL_COLORS[z.oddzial_kod] || DEFAULT_COLOR) + ';margin-right:4px"></span>'
              + '<strong>' + (z.odbiorca || '?') + '</strong> · ' + kg + ' kg'
              + ' <span style="color:#999">' + z.numer + '</span></div>';
          });
          const moreNk = count > MAX_NK ? '<div style="font-size:11px;color:#999;padding-top:2px">+ ' + (count - MAX_NK) + ' więcej...</div>' : '';

          L.marker([first.lat!, first.lng!], { icon }).addTo(map).bindPopup(
            '<div style="max-height:200px;overflow-y:auto">' + nkHeader + rows.join('') + moreNk + '</div>',
            { maxWidth: 320 }
          );
        });
      }

      // Fit bounds
      if (allPoints.length > 1) {
        map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 13 });
      } else if (allPoints.length === 0) {
        map.setView([50.27, 19.02], 10);
      }
    }).catch(() => {
      if (!cancelled) setMapError('Nie udało się załadować mapy');
    });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [pins.length, dzien]);

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
        </div>

        {/* Statystyki */}
        <div className="flex flex-wrap gap-4 text-sm">
          <span><strong>{zlecenia.length}</strong> zleceń</span>
          <span><strong>{Math.round(totalKg)}</strong> kg</span>
          <span><strong>{kursySet.size}</strong> kursów ({wKursach.length} zlec.)</span>
          {bezKursu.length > 0 && (
            <span className="text-orange-600"><strong>{bezKursu.length}</strong> bez kursu</span>
          )}
          {czekaNaGeo.length > 0 && (
            <span className="text-muted-foreground">Geokodowanie: {czekaNaGeo.length}...</span>
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
        <div className="flex flex-wrap gap-3 px-1">
          {[...kursySet].map((kid, i) => {
            const first = wKursach.find(z => z.kurs_id === kid);
            return (
              <div key={kid!} className="flex items-center gap-1.5 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ background: KURS_COLORS[i % KURS_COLORS.length] }} />
                <span className="font-medium">{first?.kurs_nr_rej || '?'}</span>
                <span className="text-muted-foreground">
                  {first?.kurs_pojazd_typ || ''} ({wKursach.filter(z => z.kurs_id === kid).length})
                </span>
              </div>
            );
          })}
          {bezKursu.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <div className="w-3 h-3 rounded-sm opacity-70" style={{ background: '#6b7280' }} />
              <span className="text-orange-600 font-medium">Bez kursu ({bezKursu.length})</span>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
