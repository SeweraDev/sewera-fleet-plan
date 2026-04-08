import { useEffect, useRef, Component, type ReactNode } from 'react';
import type { ZlecenieOddzialuDto } from '@/hooks/useZleceniaOddzialu';

// Kolory pinów wg godziny dostawy
const GODZ_COLORS: Record<string, string> = {
  'do 8:00': '#ef4444',
  'do 10:00': '#f97316',
  'do 12:00': '#eab308',
  'do 14:00': '#22c55e',
  'do 16:00': '#3b82f6',
  'Dowolna': '#6b7280',
};

// Ładuj Leaflet z CDN dynamicznie
let leafletLoaded = false;
function loadLeaflet(): Promise<any> {
  if (leafletLoaded && (window as any).L) return Promise.resolve((window as any).L);

  return new Promise((resolve, reject) => {
    // CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    // JS
    if ((window as any).L) {
      leafletLoaded = true;
      resolve((window as any).L);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      leafletLoaded = true;
      resolve((window as any).L);
    };
    script.onerror = () => reject(new Error('Nie udało się załadować Leaflet'));
    document.head.appendChild(script);
  });
}

interface Props {
  zlecenia: ZlecenieOddzialuDto[];
  oddzialCoords: { lat: number; lng: number } | null;
  oddzialNazwa: string;
}

export function ZleceniaMapView({ zlecenia, oddzialCoords, oddzialNazwa }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  const pins = zlecenia.filter(z => z.lat != null && z.lng != null);

  useEffect(() => {
    let cancelled = false;

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || !L) return;

      // Zniszcz starą mapę
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const center = oddzialCoords
        ? [oddzialCoords.lat, oddzialCoords.lng]
        : [50.27, 19.02];

      const map = L.map(containerRef.current).setView(center, 11);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const allPoints: [number, number][] = [];

      // Pin oddziału
      if (oddzialCoords) {
        allPoints.push([oddzialCoords.lat, oddzialCoords.lng]);
        const baseIcon = L.divIcon({
          className: '',
          html: `<div style="
            background:#1e40af; width:30px; height:30px; border-radius:50%;
            border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,.5);
            display:flex; align-items:center; justify-content:center;
            color:white; font-size:16px;
          ">🏭</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -17],
        });
        L.marker([oddzialCoords.lat, oddzialCoords.lng], { icon: baseIcon })
          .addTo(map)
          .bindPopup(`<strong>🏭 ${oddzialNazwa}</strong><br/>Oddział bazowy`);
      }

      // Piny dostaw
      pins.forEach(z => {
        const color = GODZ_COLORS[z.preferowana_godzina || ''] || GODZ_COLORS['Dowolna'];
        allPoints.push([z.lat!, z.lng!]);

        const icon = L.divIcon({
          className: '',
          html: `<div style="
            background:${color}; width:22px; height:22px; border-radius:50%;
            border:3px solid white; box-shadow:0 2px 6px rgba(0,0,0,.4);
          "></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          popupAnchor: [0, -13],
        });

        const popup = `
          <div style="min-width:180px">
            <strong>${z.odbiorca || 'Brak odbiorcy'}</strong><br/>
            <span style="font-size:12px;color:#666">${z.adres || '—'}</span><br/>
            <span style="font-size:12px">
              ⚖️ ${Math.round(z.suma_kg)} kg
              ${z.suma_m3 > 0 ? ` · 📐 ${Math.round(z.suma_m3 * 10) / 10} m³` : ''}
              ${z.suma_palet > 0 ? ` · 🧱 ${z.suma_palet} pal` : ''}
            </span><br/>
            <span style="font-size:12px">
              🕐 ${z.preferowana_godzina || 'Dowolna'}
              ${z.dystans_km != null ? ` · 🛣️ ${z.dystans_km} km` : ''}
            </span><br/>
            <span style="font-size:11px;color:#999">${z.numer}</span>
          </div>
        `;

        L.marker([z.lat!, z.lng!], { icon }).addTo(map).bindPopup(popup);
      });

      // Auto-fit bounds
      if (allPoints.length > 1) {
        map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 13 });
      }
    }).catch((err) => {
      console.warn('[ZleceniaMapView] Leaflet load error:', err);
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [pins.length, oddzialCoords?.lat, oddzialNazwa]);

  if (pins.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">
        Ładowanie współrzędnych... Poczekaj chwilę.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div ref={containerRef} className="rounded-lg border overflow-hidden" style={{ height: 400 }} />
      <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
        {Object.entries(GODZ_COLORS).map(([godz, color]) => (
          <span key={godz} className="flex items-center gap-1">
            <span style={{ background: color, width: 10, height: 10, borderRadius: '50%', display: 'inline-block' }} />
            {godz}
          </span>
        ))}
      </div>
    </div>
  );
}

// Error boundary — chroni stronę przed crashem mapy
class MapErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          Nie udało się załadować mapy. Odśwież stronę, aby spróbować ponownie.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ZleceniaMapViewSafe(props: Props) {
  return (
    <MapErrorBoundary>
      <ZleceniaMapView {...props} />
    </MapErrorBoundary>
  );
}
