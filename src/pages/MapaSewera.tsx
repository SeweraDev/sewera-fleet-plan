import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/shared/AppLayout';
import { useMapaZlecen } from '@/hooks/useMapaZlecen';
import type { MapaZlecenieDto } from '@/hooks/useMapaZlecen';
import { ODDZIAL_COORDS, ODDZIAL_COLORS, ODDZIAL_COLOR_DEFAULT as DEFAULT_COLOR, getOddzialTextColor } from '@/lib/oddzialy-geo';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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

  // FILTRY: ktore oddzialy pokazac + status (w kursach / bez kursu).
  // null = "wszystkie" (jeszcze nie zainicjalizowane lub user kliknal "Wszystkie")
  const [filterOddzialy, setFilterOddzialy] = useState<Set<string> | null>(null);
  const [showWKursach, setShowWKursach] = useState(true);
  const [showBezKursu, setShowBezKursu] = useState(true);

  // Lista wszystkich oddzialow (kodow) ktore wystepuja w danych — do chipow filtrowania
  const oddzialyDostepne = useMemo(() => {
    const s = new Set<string>();
    zlecenia.forEach(z => { if (z.oddzial_kod) s.add(z.oddzial_kod); });
    return [...s].sort();
  }, [zlecenia]);

  // Filtrowanie zlecen: po oddziale + statusie kursu
  const zleceniaFiltered = useMemo(() => {
    return zlecenia.filter(z => {
      const oddzialOK = filterOddzialy === null || filterOddzialy.has(z.oddzial_kod);
      if (!oddzialOK) return false;
      const wKursie = !!z.kurs_id;
      if (wKursie && !showWKursach) return false;
      if (!wKursie && !showBezKursu) return false;
      return true;
    });
  }, [zlecenia, filterOddzialy, showWKursach, showBezKursu]);

  function toggleOddzial(kod: string) {
    setFilterOddzialy(prev => {
      const current = prev ?? new Set(oddzialyDostepne);
      const next = new Set(current);
      if (next.has(kod)) next.delete(kod); else next.add(kod);
      // Jesli zaznaczone == wszystkie dostepne -> ustaw null (oznacza "wszystkie")
      if (next.size === oddzialyDostepne.length) return null;
      return next;
    });
  }
  function selectAllOddzialy() { setFilterOddzialy(null); }
  function clearAllOddzialy() { setFilterOddzialy(new Set()); }

  // Czy oddzial jest wybrany (do podswietlenia chipa)
  function isOddzialSelected(kod: string): boolean {
    if (filterOddzialy === null) return true;
    return filterOddzialy.has(kod);
  }

  // Podliczenie przystanków per kurs (do karty kursu pod mapą)
  const przystankiPoKursie = useMemo(() => {
    const m = new Map<string, MapaZlecenieDto[]>();
    zleceniaFiltered.forEach(z => {
      if (!z.kurs_id) return;
      if (!m.has(z.kurs_id)) m.set(z.kurs_id, []);
      m.get(z.kurs_id)!.push(z);
    });
    return m;
  }, [zleceniaFiltered]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const pins = zleceniaFiltered.filter(z => z.lat != null && z.lng != null);
  const bezAdresu = zleceniaFiltered.filter(z => !z.adres || z.adres.trim().length < 5);
  const czekaNaGeo = zleceniaFiltered.filter(z => z.adres && z.adres.trim().length >= 5 && z.lat == null);

  // Statystyki (po filtrze)
  const totalKg = zleceniaFiltered.reduce((s, z) => s + z.suma_kg, 0);
  const wKursach = zleceniaFiltered.filter(z => z.kurs_id);
  const bezKursu = zleceniaFiltered.filter(z => !z.kurs_id);
  // Liczniki PRZED filtrem — do wyswietlenia w chipach (np. "GL (3)") niezaleznie od filtru
  const liczbaPerOddzial = useMemo(() => {
    const m = new Map<string, number>();
    zlecenia.forEach(z => { if (z.oddzial_kod) m.set(z.oddzial_kod, (m.get(z.oddzial_kod) || 0) + 1); });
    return m;
  }, [zlecenia]);
  const liczbaWKursach = zlecenia.filter(z => z.kurs_id).length;
  const liczbaBezKursu = zlecenia.filter(z => !z.kurs_id).length;

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
        const label = codes.join('/');

        // Tlo pinu: dla par dzielacych adres (np. KAT/R) — gradient pol-na-pol z dwoch kolorow.
        // Tekst zawsze biały na ciemniejszej z dwoch (lub czarny gdy oba jasne) — dla czytelnosci.
        const c0 = ODDZIAL_COLORS[codes[0]] || DEFAULT_COLOR;
        const background = codes.length >= 2
          ? `linear-gradient(to right, ${c0} 50%, ${ODDZIAL_COLORS[codes[1]] || DEFAULT_COLOR} 50%)`
          : c0;
        const textColor = codes.length === 1 ? getOddzialTextColor(codes[0]) : '#ffffff';

        const icon = L.divIcon({
          className: '',
          html: '<div style="background:' + background + ';width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:' + textColor + ';font-size:9px;font-weight:bold;letter-spacing:-0.5px;text-shadow:0 1px 2px rgba(0,0,0,.4)">' + label + '</div>',
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

        // Kolor pinu = oddział (dominujący w grupie)
        const oddzialCounts = new Map<string, number>();
        groupPins.forEach(z => {
          oddzialCounts.set(z.oddzial_kod, (oddzialCounts.get(z.oddzial_kod) || 0) + 1);
        });
        let dominantKod = first.oddzial_kod;
        let maxCnt = 0;
        oddzialCounts.forEach((cnt, kod) => { if (cnt > maxCnt) { maxCnt = cnt; dominantKod = kod; } });
        const pinColor = ODDZIAL_COLORS[dominantKod] || DEFAULT_COLOR;

        // Badge z ilością
        const badge = count > 1
          ? '<span style="position:absolute;top:-6px;right:-6px;background:white;color:' + pinColor + ';border-radius:50%;width:18px;height:18px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid ' + pinColor + '">' + count + '</span>'
          : '';

        const icon = L.divIcon({
          className: '',
          html: '<div style="position:relative;background:' + pinColor + ';width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)">' + badge + '</div>',
          iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
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
  }, [pins.length, dzien, filterOddzialy, showWKursach, showBezKursu]);

  // Kursy dnia po filtrze oddzialow (przyciski/chipy filtrujace pokrywaja zarowno mape jak i liste kursow ponizej)
  const kursyDniaFiltered = useMemo(() => {
    return kursyDnia.filter(k => filterOddzialy === null || filterOddzialy.has(k.oddzial_kod));
  }, [kursyDnia, filterOddzialy]);

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

        {/* FILTRY: oddzialy (chipy) + status (W kursach / Bez kursu) */}
        {oddzialyDostepne.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Oddziały:</span>
              {oddzialyDostepne.map(kod => {
                const selected = isOddzialSelected(kod);
                const color = ODDZIAL_COLORS[kod] || DEFAULT_COLOR;
                const liczba = liczbaPerOddzial.get(kod) || 0;
                return (
                  <button
                    key={kod}
                    onClick={() => toggleOddzial(kod)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-white dark:bg-black/40 shadow-sm'
                        : 'bg-muted/40 opacity-50 hover:opacity-75'
                    }`}
                    style={{
                      borderColor: selected ? color : 'transparent',
                      color: selected ? color : undefined,
                    }}
                    title={selected ? `Kliknij aby ukryć ${kod}` : `Kliknij aby pokazać ${kod}`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: color }}
                    />
                    <span>{kod}</span>
                    <span className="text-muted-foreground">({liczba})</span>
                  </button>
                );
              })}
              <div className="flex gap-1 ml-1">
                <Button variant="outline" size="sm" className="h-7 text-[11px] px-2"
                  onClick={selectAllOddzialy}
                  disabled={filterOddzialy === null}>
                  Wszystkie
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-[11px] px-2"
                  onClick={clearAllOddzialy}>
                  Żaden
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Status:</span>
              <button
                onClick={() => setShowWKursach(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  showWKursach
                    ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 shadow-sm'
                    : 'bg-muted/40 border-transparent opacity-50 hover:opacity-75'
                }`}
                title="Zlecenia przypisane do kursu (zaplanowane)"
              >
                🚛 W kursach <span className="text-muted-foreground">({liczbaWKursach})</span>
              </button>
              <button
                onClick={() => setShowBezKursu(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  showBezKursu
                    ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 shadow-sm'
                    : 'bg-muted/40 border-transparent opacity-50 hover:opacity-75'
                }`}
                title="Zlecenia bez przypisanego kursu (do zaplanowania)"
              >
                ⚠️ Bez kursu <span className="text-muted-foreground">({liczbaBezKursu})</span>
              </button>
            </div>
          </div>
        )}

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


        {/* Kursy dnia — lista kursów (po filtrze oddzialow) na wybrany dzień */}
        {kursyDniaFiltered.length > 0 && (
          <div className="space-y-2 pt-2">
            <h2 className="text-sm font-semibold">
              🚛 Kursy dnia ({kursyDniaFiltered.length}{kursyDniaFiltered.length !== kursyDnia.length ? ` z ${kursyDnia.length}` : ''})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {kursyDniaFiltered.map(k => {
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
