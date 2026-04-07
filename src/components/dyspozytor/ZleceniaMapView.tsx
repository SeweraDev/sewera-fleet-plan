import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ZlecenieOddzialuDto } from '@/hooks/useZleceniaOddzialu';

// Fix domyślnych ikon Leaflet (webpack/vite nie kopiuje ikon)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Kolory pinów wg godziny dostawy
const GODZ_COLORS: Record<string, string> = {
  'do 8:00': '#ef4444',   // czerwony — pilne
  'do 10:00': '#f97316',  // pomarańczowy
  'do 12:00': '#eab308',  // żółty
  'do 14:00': '#22c55e',  // zielony
  'do 16:00': '#3b82f6',  // niebieski
  'Dowolna': '#6b7280',   // szary
};

function createColorIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color}; width:24px; height:24px; border-radius:50%;
      border:3px solid white; box-shadow:0 2px 6px rgba(0,0,0,.4);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

const baseIcon = L.divIcon({
  className: '',
  html: `<div style="
    background:#1e40af; width:30px; height:30px; border-radius:50%;
    border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,.5);
    display:flex; align-items:center; justify-content:center;
    color:white; font-size:16px; font-weight:bold;
  ">🏭</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -17],
});

// Auto-fit bounds
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [points, map]);
  return null;
}

interface Props {
  zlecenia: ZlecenieOddzialuDto[];
  oddzialCoords: { lat: number; lng: number } | null;
  oddzialNazwa: string;
}

export function ZleceniaMapView({ zlecenia, oddzialCoords, oddzialNazwa }: Props) {
  const pins = zlecenia.filter(z => z.lat != null && z.lng != null);

  const center: [number, number] = oddzialCoords
    ? [oddzialCoords.lat, oddzialCoords.lng]
    : [50.27, 19.02]; // Śląsk fallback

  const allPoints: [number, number][] = [
    ...(oddzialCoords ? [[oddzialCoords.lat, oddzialCoords.lng] as [number, number]] : []),
    ...pins.map(p => [p.lat!, p.lng!] as [number, number]),
  ];

  if (pins.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/50 p-8 text-center text-sm text-muted-foreground">
        Brak zgeokodowanych adresów — poczekaj na załadowanie współrzędnych...
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden" style={{ height: 400 }}>
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={allPoints} />

        {/* Pin oddziału */}
        {oddzialCoords && (
          <Marker position={[oddzialCoords.lat, oddzialCoords.lng]} icon={baseIcon}>
            <Popup>
              <strong>🏭 {oddzialNazwa}</strong><br />
              Oddział bazowy
            </Popup>
          </Marker>
        )}

        {/* Piny dostaw */}
        {pins.map(z => {
          const color = GODZ_COLORS[z.preferowana_godzina || ''] || GODZ_COLORS['Dowolna'];
          return (
            <Marker key={z.id} position={[z.lat!, z.lng!]} icon={createColorIcon(color)}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <strong>{z.odbiorca || 'Brak odbiorcy'}</strong><br />
                  <span style={{ fontSize: 12, color: '#666' }}>{z.adres || '—'}</span><br />
                  <span style={{ fontSize: 12 }}>
                    ⚖️ {Math.round(z.suma_kg)} kg
                    {z.suma_m3 > 0 && <> · 📐 {Math.round(z.suma_m3 * 10) / 10} m³</>}
                    {z.suma_palet > 0 && <> · 🧱 {z.suma_palet} pal</>}
                  </span><br />
                  <span style={{ fontSize: 12 }}>
                    🕐 {z.preferowana_godzina || 'Dowolna'}
                    {z.dystans_km != null && <> · 🛣️ {z.dystans_km} km</>}
                  </span><br />
                  <span style={{ fontSize: 11, color: '#999' }}>{z.numer}</span>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
