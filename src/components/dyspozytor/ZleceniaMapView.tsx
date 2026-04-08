import { useEffect, useRef, useState } from 'react';
import type { ZlecenieOddzialuDto } from '@/hooks/useZleceniaOddzialu';

const GODZ_COLORS: Record<string, string> = {
  'do 8:00': '#ef4444',
  'do 10:00': '#f97316',
  'do 12:00': '#eab308',
  'do 14:00': '#22c55e',
  'do 16:00': '#3b82f6',
  'Dowolna': '#6b7280',
};

const TYP_COLORS: Record<string, string> = {
  'Dostawczy 1,2t': '#8b5cf6',
  'Winda 1,8t': '#06b6d4',
  'Winda 6,3t': '#3b82f6',
  'Winda MAX 15,8t': '#1d4ed8',
  'HDS 9,0t': '#f97316',
  'HDS 12,0t': '#ef4444',
};
const TYP_DEFAULT_COLOR = '#6b7280';

type ColorMode = 'godzina' | 'typ';

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

function getColor(z: ZlecenieOddzialuDto, mode: ColorMode): string {
  if (mode === 'typ') {
    return TYP_COLORS[z.typ_pojazdu || ''] || TYP_DEFAULT_COLOR;
  }
  return GODZ_COLORS[z.preferowana_godzina || ''] || GODZ_COLORS['Dowolna'];
}

interface Props {
  zlecenia: ZlecenieOddzialuDto[];
  oddzialCoords: { lat: number; lng: number } | null;
  oddzialNazwa: string;
}

export default function ZleceniaMapView({ zlecenia, oddzialCoords, oddzialNazwa }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('typ');

  const pins = zlecenia.filter(z => z.lat != null && z.lng != null);
  const bezAdresu = zlecenia.filter(z => !z.adres || z.adres.trim().length < 5);
  const czekaNaGeocoding = zlecenia.filter(z => z.adres && z.adres.trim().length >= 5 && z.lat == null);

  // Unikalne typy na mapie (do legendy)
  const usedTypes = [...new Set(pins.map(z => z.typ_pojazdu || 'Bez typu'))];

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

      if (oddzialCoords) {
        allPoints.push([oddzialCoords.lat, oddzialCoords.lng]);
        const baseIcon = L.divIcon({
          className: '',
          html: '<div style="background:#1e40af;width:30px;height:30px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:white;font-size:16px">&#127981;</div>',
          iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -17],
        });
        L.marker([oddzialCoords.lat, oddzialCoords.lng], { icon: baseIcon })
          .addTo(map).bindPopup('<strong>' + oddzialNazwa + '</strong><br/>Oddzial bazowy');
      }

      // Grupuj wg lokalizacji
      const groups = new Map<string, typeof pins>();
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

        const color = getColor(first, colorMode);
        const count = groupPins.length;

        // Jeśli grupa ma mieszane typy/godziny — pokaż podzielony pin
        const uniqueColors = [...new Set(groupPins.map(z => getColor(z, colorMode)))];
        let pinHtml: string;

        if (uniqueColors.length > 1) {
          // Podzielony pin — kolory per zlecenie
          const segments = uniqueColors.map((c, i) => {
            const angle = (360 / uniqueColors.length);
            const start = angle * i;
            const end = angle * (i + 1);
            return c;
          });
          const gradient = 'conic-gradient(' + segments.map((c, i) =>
            c + ' ' + Math.round(i * 360 / segments.length) + 'deg ' + Math.round((i + 1) * 360 / segments.length) + 'deg'
          ).join(', ') + ')';
          pinHtml = '<div style="position:relative;background:' + gradient + ';width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)">';
        } else {
          pinHtml = '<div style="position:relative;background:' + color + ';width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)">';
        }

        if (count > 1) {
          pinHtml += '<span style="position:absolute;top:-6px;right:-6px;background:#1e40af;color:white;border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:1px solid white">' + count + '</span>';
        }
        pinHtml += '</div>';

        const icon = L.divIcon({
          className: '',
          html: pinHtml,
          iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14],
        });

        const popupParts = groupPins.map(z => {
          const kg = Math.round(z.suma_kg);
          const m3 = z.suma_m3 > 0 ? ' · ' + (Math.round(z.suma_m3 * 10) / 10) + ' m3' : '';
          const pal = z.suma_palet > 0 ? ' · ' + z.suma_palet + ' pal' : '';
          const km = z.dystans_km != null ? ' · ' + z.dystans_km + ' km' : '';
          const typLabel = z.typ_pojazdu ? ' [' + z.typ_pojazdu + ']' : '';
          return '<div style="min-width:180px' + (groupPins.length > 1 ? ';padding:4px 0;border-bottom:1px solid #eee' : '') + '">'
            + '<strong>' + (z.odbiorca || 'Brak odbiorcy') + '</strong>' + typLabel + '<br/>'
            + '<span style="font-size:12px;color:#666">' + (z.adres || '') + '</span><br/>'
            + '<span style="font-size:12px">' + kg + ' kg' + m3 + pal + '</span><br/>'
            + '<span style="font-size:12px">' + (z.preferowana_godzina || 'Dowolna') + km + '</span><br/>'
            + '<span style="font-size:11px;color:#999">' + z.numer + '</span>'
            + '</div>';
        });

        L.marker([first.lat, first.lng], { icon: icon }).addTo(map).bindPopup(popupParts.join(''));
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
  }, [pins.length, oddzialCoords?.lat, oddzialNazwa, colorMode]);

  if (error) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">{error}</div>;
  }

  if (pins.length === 0) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Ladowanie wspolrzednych... Poczekaj chwile.</div>;
  }

  return (
    <div className="space-y-1">
      {/* Przełącznik trybu kolorów */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Kolor wg:</span>
        <button
          type="button"
          onClick={() => setColorMode('typ')}
          className={'px-2 py-1 rounded-full font-medium transition-colors '
            + (colorMode === 'typ' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80')}
        >
          Typ pojazdu
        </button>
        <button
          type="button"
          onClick={() => setColorMode('godzina')}
          className={'px-2 py-1 rounded-full font-medium transition-colors '
            + (colorMode === 'godzina' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80')}
        >
          Godzina
        </button>
      </div>

      <div ref={containerRef} className="rounded-lg border overflow-hidden" style={{ height: 400 }} />

      {/* Legenda */}
      <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
        {colorMode === 'godzina'
          ? Object.entries(GODZ_COLORS).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1">
                <span style={{ background: color, width: 10, height: 10, borderRadius: '50%', display: 'inline-block' }} />
                {label}
              </span>
            ))
          : usedTypes.map(typ => (
              <span key={typ} className="flex items-center gap-1">
                <span style={{ background: TYP_COLORS[typ] || TYP_DEFAULT_COLOR, width: 10, height: 10, borderRadius: '50%', display: 'inline-block' }} />
                {typ}
              </span>
            ))
        }
      </div>

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
            Szukam lokalizacji ({czekaNaGeocoding.length}):
          </span>
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
