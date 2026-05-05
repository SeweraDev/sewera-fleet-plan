import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/shared/AppLayout';
import { useMapaZlecen } from '@/hooks/useMapaZlecen';
import type { MapaZlecenieDto } from '@/hooks/useMapaZlecen';
import { ODDZIAL_COORDS } from '@/lib/oddzialy-geo';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Kolory oddziałów — stałe
const ODDZIAL_COLORS: Record<string, string> = {
  KAT: '#dc2626', R: '#7c3aed', SOS: '#1e40af', GL: '#059669',
  DG: '#ea580c', TG: '#0891b2', CH: '#be185d', OS: '#ca8a04',
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

/** Wybiera typ do wyświetlenia: rzeczywisty z kursu (jeśli jest), inaczej wymagany ze zlecenia. */
function pickTypForIcon(z: MapaZlecenieDto): string | null {
  return z.kurs_pojazd_typ || z.typ_pojazdu || null;
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

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function formatDatePL(iso: string): string {
  const [y, m, d] = iso.split('-');
  const days = ['niedziela', 'poniedzia\u0142ek', 'wtorek', '\u015broda', 'czwartek', 'pi\u0105tek', 'sobota'];
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return `${days[date.getDay()]}, ${d}.${m}.${y}`;
}

export default function MapaSewera() {
  const [dzien, setDzien] = useState(today);
  const { zlecenia, kursyDnia, loading } = useMapaZlecen(dzien);

  // Podliczenie przystanków per kurs (do karty kursu pod mapą)
  const przystankiPoKursie = useMemo(() => {
    const m = new Map<string, MapaZlecenieDto[]>();
    zlecenia.forEach(z => {
      if (!z.kurs_id) return;
      if (!m.has(z.kurs_id)) m.set(z.kurs_id, []);
      m.get(z.kurs_id)!.push(z);
    });
    return m;
  }, [zlecenia]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const pins = zlecenia.filter(z => z.lat != null && z.lng != null);
  const bezAdresu = zlecenia.filter(z => !z.adres || z.adres.trim().length < 5);
  const czekaNaGeo = zlecenia.filter(z => z.adres && z.adres.trim().length >= 5 && z.lat == null);

  // Statystyki
  const totalKg = zlecenia.reduce((s, z) => s + z.suma_kg, 0);
  const wKursach = zlecenia.filter(z => z.kurs_id);
  const bezKursu = zlecenia.filter(z => !z.kurs_id);
  const oddzialySet = new Set(zlecenia.map(z => z.oddzial_kod).filter(Boolean));

  function shiftDay(delta: number) {
    const d = new Date(dzien);
    d.setDate(d.getDate() + delta);
    setDzien(d.toISOString().split('T')[0]);
  }

  // Renderuj mapę — piny per adres, kolorowane per ODDZIAŁ
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
          .bindPopup('<strong>' + label + '</strong><br/>' + c.adres + '<br/><em>' + branchCount + ' zlece\u0144 na ' + dzien + '</em>');
      }

      // --- WSZYSTKIE ZLECENIA: grupowane per adres, kolor per ODDZIAŁ ---
      const groups = new Map<string, MapaZlecenieDto[]>();
      pins.forEach(z => {
        const key = z.lat!.toFixed(4) + ',' + z.lng!.toFixed(4);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(z);
      });

      groups.forEach((groupPins) => {
        const first = groupPins[0];
        if (first.lat == null || first.lng == null) return;
        allPoints.push([first.lat, first.lng]);

        const count = groupPins.length;

        // Kolor obwódki = oddział (dominujący w grupie)
        const oddzialCounts = new Map<string, number>();
        groupPins.forEach(z => {
          oddzialCounts.set(z.oddzial_kod, (oddzialCounts.get(z.oddzial_kod) || 0) + 1);
        });
        let dominantKod = first.oddzial_kod;
        let maxCnt = 0;
        oddzialCounts.forEach((cnt, kod) => { if (cnt > maxCnt) { maxCnt = cnt; dominantKod = kod; } });
        const pinColor = ODDZIAL_COLORS[dominantKod] || DEFAULT_COLOR;

        // Ikona pojazdu (dominująca w grupie)
        const typCounts = new Map<string, number>();
        groupPins.forEach(z => {
          const t = pickTypForIcon(z);
          const iconUrl = getVehicleIcon(t);
          if (iconUrl) typCounts.set(iconUrl, (typCounts.get(iconUrl) || 0) + 1);
        });
        let dominantIcon: string | null = null;
        let maxIconCnt = 0;
        typCounts.forEach((cnt, url) => { if (cnt > maxIconCnt) { maxIconCnt = cnt; dominantIcon = url; } });

        // Badge z ilością
        const badge = count > 1
          ? '<span style="position:absolute;top:-8px;right:-8px;background:' + pinColor + ';color:white;border-radius:50%;min-width:18px;height:18px;padding:0 4px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);z-index:2">' + count + '</span>'
          : '';

        // Pin: białe koło z obwódką oddziału + ikona pojazdu w środku
        const inner = dominantIcon
          ? '<img src="' + dominantIcon + '" style="width:26px;height:26px;object-fit:contain;display:block" alt=""/>'
          : '<div style="width:14px;height:14px;border-radius:50%;background:' + pinColor + '"></div>';

        const icon = L.divIcon({
          className: '',
          html: '<div style="position:relative;background:white;width:36px;height:36px;border-radius:50%;border:3px solid ' + pinColor + ';box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">' + inner + badge + '</div>',
          iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
        });

        // Popup — header z adresem i podsumowaniem
        const totalKgGrp = groupPins.reduce((s, z) => s + z.suma_kg, 0);
        const totalM3 = groupPins.reduce((s, z) => s + z.suma_m3, 0);
        const totalPal = groupPins.reduce((s, z) => s + z.suma_palet, 0);
        const grpOddzialy = [...new Set(groupPins.map(z => z.oddzial_kod))];
        const grpBezKursu = groupPins.filter(z => !z.kurs_id).length;

        const header = '<div style="font-weight:bold;margin-bottom:4px">' + (first.adres || 'Brak adresu') + '</div>'
          + '<div style="font-size:12px;margin-bottom:6px">'
          + count + ' zlec. \u00b7 ' + Math.round(totalKgGrp) + ' kg'
          + (totalM3 > 0 ? ' \u00b7 ' + (Math.round(totalM3 * 10) / 10) + ' m\u00b3' : '')
          + (totalPal > 0 ? ' \u00b7 ' + totalPal + ' pal' : '')
          + ' \u00b7 ' + grpOddzialy.map(k => '<span style="color:' + (ODDZIAL_COLORS[k] || DEFAULT_COLOR) + ';font-weight:bold">' + k + '</span>').join(', ')
          + (grpBezKursu > 0 ? ' \u00b7 <span style="color:#ea580c">' + grpBezKursu + ' bez kursu</span>' : '')
          + '</div>';

        const MAX = 5;
        const shown = groupPins.slice(0, MAX);
        const rows = shown.map(z => {
          const kg = Math.round(z.suma_kg);
          const oddzColor = ODDZIAL_COLORS[z.oddzial_kod] || DEFAULT_COLOR;
          const kursInfo = z.kurs_nr_rej
            ? ' <span style="color:#059669">[' + z.kurs_nr_rej + ']</span>'
            : ' <span style="color:#ea580c;font-size:10px">bez kursu</span>';
          return '<div style="padding:2px 0;border-bottom:1px solid #eee;font-size:12px">'
            + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + oddzColor + ';margin-right:4px"></span>'
            + '<strong>' + (z.odbiorca || '?') + '</strong>' + kursInfo
            + ' \u00b7 ' + kg + ' kg'
            + ' <span style="color:#999">' + z.numer + '</span>'
            + '</div>';
        });

        const more = count > MAX ? '<div style="font-size:11px;color:#999;padding-top:4px">+ ' + (count - MAX) + ' wi\u0119cej...</div>' : '';

        L.marker([first.lat, first.lng], { icon }).addTo(map).bindPopup(
          '<div style="max-height:250px;overflow-y:auto">' + header + rows.join('') + more + '</div>',
          { maxWidth: 350 }
        );
      });

      // Fit bounds
      if (allPoints.length > 1) {
        map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 13 });
      } else if (allPoints.length === 0) {
        map.setView([50.27, 19.02], 10);
      }
    }).catch(() => {
      if (!cancelled) setMapError('Nie uda\u0142o si\u0119 za\u0142adowa\u0107 mapy');
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
          <span className="text-green-700"><strong>{wKursach.length}</strong> w kursach</span>
          {bezKursu.length > 0 && (
            <span className="text-orange-600"><strong>{bezKursu.length}</strong> bez kursu</span>
          )}
          {czekaNaGeo.length > 0 && (
            <span className="text-orange-600">⚠️ Niezlokalizowane: {czekaNaGeo.length}</span>
          )}
          {bezAdresu.length > 0 && (
            <span className="text-red-600">Brak adresu: {bezAdresu.length}</span>
          )}
        </div>

        {/* Lista niezlokalizowanych zleceń (lat/lng pozostaje null po geocodingu) */}
        {czekaNaGeo.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 px-3 py-2 text-xs">
            <div className="font-medium text-orange-700 dark:text-orange-400">
              ⚠️ Niezlokalizowane lub w trakcie geokodowania ({czekaNaGeo.length}):
            </div>
            <div className="text-[11px] text-orange-600 dark:text-orange-300 mt-0.5">
              Jeśli zlecenie pozostaje tu dłużej — popraw adres w edycji (dodaj ulicę, kod, miasto).
            </div>
            <ul className="mt-1 space-y-0.5 text-orange-600 dark:text-orange-300">
              {czekaNaGeo.map(z => (
                <li key={z.id}>{z.numer} — {z.adres}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Mapa */}
        {mapError ? (
          <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">{mapError}</div>
        ) : loading && zlecenia.length === 0 ? (
          <div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Ładowanie zleceń...</div>
        ) : (
          <div ref={containerRef} className="rounded-lg border overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 400 }} />
        )}

        {/* Legenda oddziałów */}
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

        {/* Legenda typów pojazdów */}
        <div className="flex flex-wrap items-center gap-4 px-1 pt-1 border-t pt-2">
          <span className="text-xs text-muted-foreground font-medium">Typy pojazdów:</span>
          <div className="flex items-center gap-1.5 text-xs">
            <img src={ICON_VAN} alt="Dostawczy 1,2t" className="w-6 h-6 object-contain" />
            <span>Dostawczy 1,2t</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <img src={ICON_WINDA} alt="Winda" className="w-6 h-6 object-contain" />
            <span>Winda</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <img src={ICON_HDS} alt="HDS" className="w-6 h-6 object-contain" />
            <span>HDS</span>
          </div>
        </div>

        {/* Kursy dnia — lista kursów wszystkich oddziałów na wybrany dzień */}
        {kursyDnia.length > 0 && (
          <div className="space-y-2 pt-2">
            <h2 className="text-sm font-semibold">
              🚛 Kursy dnia ({kursyDnia.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {kursyDnia.map(k => {
                const oddzialColor = ODDZIAL_COLORS[k.oddzial_kod] || DEFAULT_COLOR;
                const przystanki = przystankiPoKursie.get(k.id) || [];
                const sumaKg = przystanki.reduce((s, p) => s + p.suma_kg, 0);
                const sumaPal = przystanki.reduce((s, p) => s + p.suma_palet, 0);
                return (
                  <div key={k.id} className="rounded-lg border bg-card p-3 text-xs space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: oddzialColor }} />
                        <span className="font-semibold truncate">{k.numer}</span>
                        <span className="text-muted-foreground">({k.oddzial_kod})</span>
                      </div>
                      <Link
                        to={`/karta-drogowa/${k.id}`}
                        className="text-[10px] text-primary hover:underline shrink-0"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        🖨️ Karta
                      </Link>
                    </div>
                    <div><StatusBadge status={k.status} /></div>
                    <div className="text-muted-foreground space-y-0.5">
                      {k.nr_rej && (
                        <div>
                          <span className="font-mono">{k.nr_rej}</span>
                          {k.pojazd_typ && <span className="ml-1">· {k.pojazd_typ}</span>}
                        </div>
                      )}
                      {k.kierowca_nazwa && <div>👤 {k.kierowca_nazwa}</div>}
                      {k.godzina_start && <div>🕐 start: {k.godzina_start.slice(0, 5)}</div>}
                      <div>
                        📦 {przystanki.length} przyst. · {Math.round(sumaKg)} kg
                        {sumaPal > 0 && ` · ${sumaPal} pal`}
                      </div>
                    </div>
                    {przystanki.length > 0 && (
                      <div className="pt-1 border-t space-y-0.5 text-[11px]">
                        {przystanki.slice(0, 4).map((p, i) => (
                          <div key={p.id} className="truncate text-muted-foreground">
                            <span className="font-medium text-foreground">{i + 1}.</span>{' '}
                            {p.odbiorca || '?'}
                            {p.adres && <span className="text-muted-foreground/70"> — {p.adres}</span>}
                          </div>
                        ))}
                        {przystanki.length > 4 && (
                          <div className="text-muted-foreground/70">
                            + {przystanki.length - 4} więcej…
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
