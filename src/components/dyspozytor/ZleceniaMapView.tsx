import { useEffect, useRef, useState } from 'react';
import type { ZlecenieOddzialuDto } from '@/hooks/useZleceniaOddzialu';
import { ODDZIAL_COORDS, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';

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
}

export default function ZleceniaMapView({ zlecenia, oddzialCoords, oddzialNazwa }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  const pins = zlecenia.filter(z => z.lat != null && z.lng != null);
  const bezAdresu = zlecenia.filter(z => !z.adres || z.adres.trim().length < 5);
  const czekaNaGeocoding = zlecenia.filter(z => z.adres && z.adres.trim().length >= 5 && z.lat == null);

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

      groups.forEach((groupPins) => {
        const first = groupPins[0];
        if (first.lat == null || first.lng == null) return;
        allPoints.push([first.lat, first.lng]);

        const count = groupPins.length;
        const badge = count > 1
          ? '<span style="position:absolute;top:-6px;right:-6px;background:white;color:' + myColor + ';border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid ' + myColor + '">' + count + '</span>'
          : '';

        const icon = L.divIcon({
          className: '',
          html: '<div style="position:relative;background:' + myColor + ';width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)">' + badge + '</div>',
          iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
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
  }, [pins.length, oddzialCoords?.lat, oddzialNazwa]);

  if (error) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">{error}</div>;
  }

  if (pins.length === 0) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Ladowanie wspolrzednych... Poczekaj chwile.</div>;
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
