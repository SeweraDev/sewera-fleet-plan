import { useEffect, useRef, useState } from 'react';
import { geocodeAddress } from '@/lib/oddzialy-geo';
import { ODDZIAL_COORDS, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';
import { toast } from 'sonner';
import type { KursDto, PrzystanekDto } from '@/hooks/useKursyDnia';

// Kolory oddziałów
const ODDZIAL_COLORS: Record<string, string> = {
  KAT: '#dc2626', R: '#7c3aed', SOS: '#1e40af', GL: '#059669',
  DG: '#ea580c', TG: '#0891b2', CH: '#be185d', OS: '#ca8a04',
};
const DEFAULT_COLOR = '#6b7280';

// Kolory tras kursów — cykliczne
const KURS_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#ca8a04'];

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
  kursy: KursDto[];
  przystanki: PrzystanekDto[];
  oddzialNazwa: string;
}

export default function KursyMapView({ kursy, przystanki, oddzialNazwa }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<Map<string, { lat: number; lng: number }>>(new Map());
  const [geocoding, setGeocoding] = useState(false);
  const [failedAddresses, setFailedAddresses] = useState<Set<string>>(new Set());

  // Geocoduj unikalne adresy
  const uniqueAddresses = [...new Set(
    przystanki.map(p => p.adres).filter(a => a && a.trim().length >= 5)
  )];

  useEffect(() => {
    if (uniqueAddresses.length === 0) return;
    let cancelled = false;
    setGeocoding(true);

    (async () => {
      const newCoords = new Map<string, { lat: number; lng: number }>();
      const newFailed = new Set<string>();
      // Kopiuj istniejące z cache
      coords.forEach((v, k) => newCoords.set(k, v));

      const toGeocode = uniqueAddresses.filter(a => !newCoords.has(a));
      for (const adres of toGeocode) {
        if (cancelled) break;
        const result = await geocodeAddress(adres);
        if (result) {
          newCoords.set(adres, result);
        } else {
          newFailed.add(adres);
        }
      }
      if (!cancelled) {
        setCoords(newCoords);
        setFailedAddresses(newFailed);
        setGeocoding(false);
        // Toast ostrzegawczy gdy niektóre adresy się nie zgeocodowały
        if (newFailed.size > 0) {
          toast.warning(
            `⚠️ Nie zlokalizowano ${newFailed.size} ${newFailed.size === 1 ? 'adresu' : 'adresów'} — lista pod mapą`,
            { duration: 5000 },
          );
        }
      }
    })();

    return () => { cancelled = true; };
  }, [uniqueAddresses.join('|')]);

  // Renderuj mapę gdy mamy koordynaty
  useEffect(() => {
    if (coords.size === 0) return;
    let cancelled = false;

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || !L) return;

      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const myKod = oddzialNazwa ? (NAZWA_TO_KOD[oddzialNazwa] || '') : '';
      const oddzialCoords = myKod ? ODDZIAL_COORDS[myKod] : null;
      const center = oddzialCoords ? [oddzialCoords.lat, oddzialCoords.lng] : [50.27, 19.02];
      const map = L.map(containerRef.current).setView(center, 11);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const allPoints: [number, number][] = [];

      // Piny oddziałów (identycznie jak ZleceniaMapView)
      const myColor = ODDZIAL_COLORS[myKod] || DEFAULT_COLOR;
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
          iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2 - 2],
        });

        L.marker([c.lat, c.lng], { icon, zIndexOffset: isMine ? 1000 : 0 })
          .addTo(map)
          .bindPopup('<strong>' + label + '</strong><br/>' + c.adres + (isMine ? '<br/><em>Twój oddział</em>' : ''));
      }

      // Piny i linie per kurs
      kursy.forEach((kurs, kIdx) => {
        const kursColor = KURS_COLORS[kIdx % KURS_COLORS.length];
        const kPrz = przystanki
          .filter(p => p.kurs_id === kurs.id)
          .sort((a, b) => a.kolejnosc - b.kolejnosc);

        // Deduplikuj przystanki wg kolejności (bo jeden przystanek może mieć wiele WZ)
        const uniqueStops: PrzystanekDto[] = [];
        const seenKolejnosc = new Set<number>();
        for (const p of kPrz) {
          if (!seenKolejnosc.has(p.kolejnosc)) {
            seenKolejnosc.add(p.kolejnosc);
            uniqueStops.push(p);
          }
        }

        const routePoints: [number, number][] = [];

        // Punkt startowy: oddział
        if (oddzialCoords) {
          routePoints.push([oddzialCoords.lat, oddzialCoords.lng]);
        }

        uniqueStops.forEach((stop) => {
          const c = coords.get(stop.adres);
          if (!c) return;

          allPoints.push([c.lat, c.lng]);
          routePoints.push([c.lat, c.lng]);

          // Zbierz wszystkie WZ dla tego przystanku
          const wzForStop = kPrz.filter(p => p.kolejnosc === stop.kolejnosc);
          const totalKg = wzForStop.reduce((s, p) => s + p.masa_kg, 0);
          const totalM3 = wzForStop.reduce((s, p) => s + p.objetosc_m3, 0);
          const totalPal = wzForStop.reduce((s, p) => s + p.ilosc_palet, 0);

          const icon = L.divIcon({
            className: '',
            html: '<div style="position:relative;background:' + kursColor + ';width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold">' + stop.kolejnosc + '</div>',
            iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14],
          });

          const popupLines = wzForStop.map(w => {
            const kg = Math.round(w.masa_kg);
            const m3 = w.objetosc_m3 > 0 ? ' · ' + (Math.round(w.objetosc_m3 * 10) / 10) + ' m³' : '';
            const pal = w.ilosc_palet > 0 ? ' · ' + w.ilosc_palet + ' pal' : '';
            return '<div style="padding:2px 0;' + (wzForStop.length > 1 ? 'border-bottom:1px solid #eee' : '') + '">'
              + '<strong>' + (w.odbiorca || '?') + '</strong><br/>'
              + '<span style="font-size:12px;color:#666">' + (w.adres || '') + '</span><br/>'
              + '<span style="font-size:12px">' + kg + ' kg' + m3 + pal + '</span><br/>'
              + '<span style="font-size:11px;color:#999">' + (w.numer_wz || w.zl_numer) + '</span>'
              + '</div>';
          });

          const header = '<div style="font-size:11px;color:' + kursColor + ';font-weight:bold;margin-bottom:4px">'
            + '🚛 ' + (kurs.nr_rej || 'Brak pojazdu') + ' · ' + (kurs.pojazd_typ || '') + '</div>';

          L.marker([c.lat, c.lng], { icon }).addTo(map).bindPopup(header + popupLines.join(''));
        });

        // Polyline trasy
        if (routePoints.length >= 2) {
          L.polyline(routePoints, {
            color: kursColor,
            weight: 3,
            opacity: 0.7,
            dashArray: '8, 6',
          }).addTo(map);
        }
      });

      // Fit bounds
      if (allPoints.length > 1) {
        map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 13 });
      } else if (allPoints.length === 1) {
        map.setView(allPoints[0], 12);
      }
    }).catch(() => {
      if (!cancelled) setError('Nie udało się załadować mapy');
    });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [coords.size, kursy.length, przystanki.length, oddzialNazwa]);

  if (error) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">{error}</div>;
  }

  if (przystanki.length === 0) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Brak przystanków do wyświetlenia na mapie.</div>;
  }

  if (geocoding && coords.size === 0) {
    return <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Ładowanie współrzędnych...</div>;
  }

  // Zbierz szczegóły przystanków z adresami których nie udało się zlokalizować —
  // żeby dyspozytor widział które to WZ i które zlecenie, a nie tylko sam adres.
  const unlocatedStops = failedAddresses.size > 0
    ? przystanki.filter(p => p.adres && failedAddresses.has(p.adres))
    : [];

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="rounded-lg border overflow-hidden" style={{ height: 600 }} />
      {/* Legenda kursów */}
      {kursy.length > 0 && (
        <div className="flex flex-wrap gap-3 px-1">
          {kursy.map((kurs, kIdx) => (
            <div key={kurs.id} className="flex items-center gap-1.5 text-xs">
              <div
                className="w-3 h-3 rounded-full border border-white"
                style={{ background: KURS_COLORS[kIdx % KURS_COLORS.length], boxShadow: '0 1px 3px rgba(0,0,0,.3)' }}
              />
              <span className="font-medium">{kurs.nr_rej || '?'}</span>
              <span className="text-muted-foreground">{kurs.pojazd_typ || ''}</span>
            </div>
          ))}
        </div>
      )}
      {/* Lista adresów które nie zostały zlokalizowane — dyspozytor widzi że są,
          zamiast niewidoczne znikać z mapy. */}
      {unlocatedStops.length > 0 && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700 p-3 text-xs">
          <div className="font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
            ⚠️ Niezidentyfikowane adresy — {failedAddresses.size}
          </div>
          <div className="text-yellow-800 dark:text-yellow-300 mb-2 text-[11px]">
            Te przystanki nie trafiły na mapę bo Photon (geokoder) nie rozpoznał adresu albo wynik był poza Śląskiem. Popraw adres w edycji zlecenia (dodaj ulicę, kod pocztowy, miasto).
          </div>
          <ul className="space-y-1">
            {unlocatedStops.map(p => (
              <li key={p.id} className="flex gap-2 items-start">
                <span className="font-mono text-muted-foreground text-[10px] shrink-0 pt-0.5">
                  {p.numer_wz || p.zl_numer}
                </span>
                <span className="flex-1">
                  <strong>{p.odbiorca || '—'}</strong>
                  <span className="text-muted-foreground"> · {p.adres}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
