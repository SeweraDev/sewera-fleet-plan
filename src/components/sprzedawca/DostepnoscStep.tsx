import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSprawdzDostepnosc, pctColor, pctBg, type VehicleOccupancy } from '@/hooks/useSprawdzDostepnosc';
import { useCostComparison } from '@/hooks/useCostComparison';
import { ODDZIAL_COORDS, ODDZIAL_COLORS, getOddzialTextColor } from '@/lib/oddzialy-geo';
import type { WzInput } from '@/hooks/useCreateZlecenie';

/** Próg w zł netto — banner pojawia się gdy alternatywa jest tańsza o przynajmniej tyle.
 *  Aktualnie 0 → banner zawsze gdy istnieje tańszy oddział (próg do ustalenia po obserwacji
 *  produkcyjnej i raporcie zarządu — patrz `zlecenia.pominieta_oszczednosc_pln`). */
const COST_THRESHOLD_PLN = 0;

// Leaflet lazy load (z CDN, jak w innych mapach w projekcie)
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

interface DostepnoscStepProps {
  oddzialId: number;
  /** Nazwa obecnego oddziału (np. "Gliwice") — do porównania kosztów alternatywnych. */
  oddzialNazwa: string;
  typPojazdu: string;
  dzien: string;
  godzina?: string;
  wzList: WzInput[];
  /** Lista wszystkich oddziałów (do mapowania nazwy → id przy zmianie). */
  oddzialy: { id: number; nazwa: string }[];
  onBack: () => void;
  /** Drugi argument = pominięta oszczędność w zł netto (gdy user świadomie wybrał
   *  "Zleć mimo wszystko" pomimo widocznego bannera). Null gdy brak bannera. */
  onSubmit: (forceVerify: boolean, pominietaOszczednosc?: number | null) => void;
  submitting: boolean;
  onChangeDzien?: (newDzien: string) => void;
  onChangeGodzina?: (newGodzina: string) => void;
  /** Wraca do Kroku 1 z preselected nowym oddziałem (dane WZ pozostają). */
  onChangeOddzial?: (newOddzialId: number) => void;
}

function fmtPLN(v: number): string {
  return v.toFixed(2).replace('.', ',') + ' zł';
}

function OccupancyBar({ label, pct, value, max }: { label: string; pct: number; value: number; max: number | null }) {
  if (!max) return null;
  const clampedPct = Math.min(pct, 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={pctColor(pct)}>
          {Math.round(value)} / {max} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pctBg(pct)}`}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
    </div>
  );
}

function VehicleCard({ v }: { v: VehicleOccupancy }) {
  const warn = v.pct_kg >= 90 || v.pct_m3 >= 90 || v.pct_palet >= 90;

  return (
    <Card className={`p-3 space-y-2 ${v.fits ? 'border-border' : 'border-destructive/50 bg-destructive/5'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{v.nr_rej}</span>
          <span className="text-xs text-muted-foreground">{v.typ}</span>
        </div>
        {v.fits ? (
          warn ? (
            <Badge variant="outline" className="bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-[10px]">
              ⚠️ ≥90%
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px]">
              ✅ Mieści się
            </Badge>
          )
        ) : (
          <Badge variant="destructive" className="text-[10px]">❌ Przekroczone</Badge>
        )}
      </div>
      <OccupancyBar label="Waga" pct={v.pct_kg} value={v.used_kg} max={v.ladownosc_kg} />
      <OccupancyBar label="Objętość" pct={v.pct_m3} value={v.used_m3} max={v.objetosc_m3} />
      <OccupancyBar label="Palety" pct={v.pct_palet} value={v.used_palet} max={v.max_palet} />
    </Card>
  );
}

export function DostepnoscStep({
  oddzialId,
  oddzialNazwa,
  typPojazdu,
  dzien,
  godzina,
  wzList,
  onBack,
  onSubmit,
  submitting,
  onChangeDzien,
  onChangeGodzina,
}: DostepnoscStepProps) {
  const { vehicles, anyFits, loading, check, nextAvailable, searchingNext, freeSlots } = useSprawdzDostepnosc();

  const totalKg = wzList.reduce((s, w) => s + (w.masa_kg || 0), 0);
  const totalM3 = wzList.reduce((s, w) => s + (Number(w.objetosc_m3) || 0), 0);
  const totalPalet = wzList.reduce((s, w) => s + (w.ilosc_palet || 0), 0);

  // Porównanie kosztów: bierzemy adres z PIERWSZEJ WZ-tki (zwykle wszystkie WZ jednego zlecenia
  // mają ten sam adres dostawy)
  const adresDostawy = wzList[0]?.adres || '';
  const cmp = useCostComparison(oddzialNazwa, typPojazdu, adresDostawy);

  // Mini-mapa: container ref + instance ref
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (oddzialId && dzien) {
      check(oddzialId, typPojazdu, dzien, totalKg, totalM3, totalPalet, godzina);
    }
  }, [oddzialId, typPojazdu, dzien, godzina, totalKg, totalM3, totalPalet, check]);

  // Render mini-mapy gdy mamy wyniki porównania
  useEffect(() => {
    if (!cmp.coords || cmp.rows.length === 0 || !mapContainerRef.current) return;

    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !mapContainerRef.current) return;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      const map = L.map(mapContainerRef.current, { zoomControl: true, attributionControl: false });
      mapInstanceRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

      const bounds: [number, number][] = [];

      // Pin dostawy (czerwony)
      const deliveryIcon = L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;background:#dc2626;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:bold;">📍</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([cmp.coords!.lat, cmp.coords!.lng], { icon: deliveryIcon })
        .addTo(map)
        .bindPopup(`<b>Dostawa</b><br/>${adresDostawy}`);
      bounds.push([cmp.coords!.lat, cmp.coords!.lng]);

      // Piny oddziałów (top 5 najtańszych — żeby nie zaśmiecać mapy gdy oddział daleko)
      // ...plus zawsze obecny (Twój)
      const top = cmp.rows.slice(0, 5);
      const visibleSet = new Set(top.map(r => r.oddzialKod));
      if (cmp.current) visibleSet.add(cmp.current.oddzialKod);

      for (const r of cmp.rows) {
        if (!visibleSet.has(r.oddzialKod)) continue;
        const coord = ODDZIAL_COORDS[r.oddzialKod];
        if (!coord) continue;
        const color = ODDZIAL_COLORS[r.oddzialKod] || '#6b7280';
        const textColor = getOddzialTextColor(r.oddzialKod);
        const isCurrent = r.isCurrent;
        const size = isCurrent ? 28 : 22;
        const ring = isCurrent ? '3px solid #fb923c' : '2px solid white';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${size}px;height:${size}px;background:${color};border:${ring};border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:${textColor};font-size:10px;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,.3)">${r.oddzialKod}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const tag = isCurrent ? ' (Twój)' : '';
        L.marker([coord.lat, coord.lng], { icon })
          .addTo(map)
          .bindPopup(`<b>${r.oddzialNazwa}${tag}</b><br/>${r.km} km`);
        bounds.push([coord.lat, coord.lng]);
      }

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [25, 25] });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 12);
      }
    }).catch(console.error);

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [cmp.coords, cmp.rows, adresDostawy]);

  if (loading) {
    return <p className="text-center text-muted-foreground py-8">Sprawdzanie dostępności floty...</p>;
  }

  const isExternalOrNoPref = !typPojazdu || typPojazdu === 'bez_preferencji' || typPojazdu === 'zewnetrzny';

  // Banner porównania kosztów: pokazuj tylko gdy istnieje tańsza alternatywa o > próg.
  // UWAGA biznesowa: zlecenie zawsze startuje z oddziału który wystawia WZ — bo każdy
  // oddział ma swoje stany magazynowe i WZ (towar fizycznie wychodzi z tego oddziału).
  // Banner jest INFORMACYJNY — uświadamia że bliższy oddział byłby tańszy. User wybiera
  // świadomie "Zleć mimo wszystko" i wartość oszczędności zapisuje się do
  // `zlecenia.pominieta_oszczednosc_pln` → raport dla zarządu (kosztów które poniesiono
  // mimo tańszej alternatywy).
  const showCostBanner = !!cmp.savings && cmp.savings >= COST_THRESHOLD_PLN && !!cmp.cheapest && !!cmp.current;

  // Helper — przekazuje pominiętą oszczędność gdy banner widoczny (świadoma decyzja usera)
  const handleConfirmedSubmit = (forceVerify: boolean) => {
    onSubmit(forceVerify, showCostBanner ? Math.round(cmp.savings!) : null);
  };

  // Etykieta przycisku submit: gdy banner widoczny — "Zleć mimo wszystko" (świadoma akcja),
  // inaczej oryginalna etykieta z kontekstu (Złóż / Załóż).
  const submitLabel = (base: string) => showCostBanner ? '✅ Zleć mimo wszystko' : `✅ ${base}`;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 bg-muted/30">
        <p className="text-xs font-medium text-muted-foreground mb-1">Podsumowanie ładunku</p>
        <div className="flex gap-4 text-sm">
          <span>⚖️ {totalKg} kg</span>
          {totalM3 > 0 && <span>📐 {totalM3.toFixed(2)} m³</span>}
          {totalPalet > 0 && <span>📦 {totalPalet} palet</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Dzień: {dzien} · Typ: {typPojazdu || 'bez preferencji'}
        </p>
      </div>

      {/* Banner porównania kosztów — pokazujemy tylko gdy istnieje tańsza alternatywa */}
      {showCostBanner && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-lg">💡</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Inny oddział byłby tańszy o {fmtPLN(Math.round(cmp.savings!))}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                Adres dostawy jest bliżej oddziału {cmp.cheapest!.oddzialNazwa} (informacyjnie).
                Zlecenie i tak zostanie utworzone w Twoim oddziale, żeby marża i koszt transportu
                pozostały razem.
              </p>
            </div>
          </div>

          {/* Tabelka: obecny + top najbliższych (zgodnie z logiką z Wycen Transport) */}
          <div className="rounded border bg-white/70 dark:bg-black/20 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-2 py-1 font-medium">Oddział / pojazd</th>
                  <th className="text-right px-2 py-1 font-medium">km</th>
                  <th className="text-right px-2 py-1 font-medium">Sewera (netto)</th>
                  <th className="text-right px-2 py-1 font-medium">Zewn. (netto)</th>
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map(r => {
                  const isCheapest = !!cmp.cheapest && r.oddzialKod === cmp.cheapest.oddzialKod && !r.isCurrent;
                  return (
                    <tr
                      key={r.oddzialKod}
                      className={
                        r.isCurrent
                          ? 'bg-orange-100 dark:bg-orange-900/30 font-medium'
                          : isCheapest
                          ? 'bg-green-100 dark:bg-green-900/30'
                          : ''
                      }
                    >
                      <td className="px-2 py-1.5 align-top">
                        <div>
                          {isCheapest && '🟢 '}
                          {r.isCurrent && '📍 '}
                          {r.oddzialNazwa}
                          {r.isCurrent && <span className="text-muted-foreground"> (Twój)</span>}
                          {r.isFallback && r.uzytTyp && (
                            <span
                              className="ml-1 text-[10px] text-amber-700 dark:text-amber-400"
                              title={`Brak żądanego typu — używamy ${r.uzytTyp} (fallback ${r.fallbackDirection === 'down' ? 'mniejszy' : 'większy'})`}
                            >
                              {r.fallbackDirection === 'down' ? '↓' : '↑'} {r.uzytTyp}
                            </span>
                          )}
                        </div>
                        {r.wewTypy.length > 0 && (
                          <div className="text-[10px] text-muted-foreground">🟢 Sewera: {r.wewTypy.join(', ')}</div>
                        )}
                        {r.zewTypy.length > 0 && (
                          <div className="text-[10px] text-muted-foreground">🟡 zew: {r.zewTypy.join(', ')}</div>
                        )}
                        {r.wewTypy.length === 0 && r.zewTypy.length === 0 && (
                          <div className="text-[10px] text-destructive">brak pojazdu typu</div>
                        )}
                      </td>
                      <td className="text-right px-2 py-1.5 text-muted-foreground align-top">{r.km} km</td>
                      <td className="text-right px-2 py-1.5 align-top">
                        {r.kosztWew ? fmtPLN(r.kosztWew.netto) : '—'}
                      </td>
                      <td className="text-right px-2 py-1.5 align-top">
                        {r.kosztyZew.length === 0 ? '—' : (
                          <div className="space-y-1">
                            {r.kosztyZew.map((k, i) => (
                              <div key={i} className={i > 0 ? 'pt-1 border-t border-dashed border-muted-foreground/30' : ''}>
                                <span>{fmtPLN(k.netto)}</span>
                                {k.ladownoscLabel && (
                                  <span className="ml-1 text-[9px] font-medium text-muted-foreground">({k.ladownoscLabel})</span>
                                )}
                                {(k.paletyExtra ?? 0) > 0 && (
                                  <div className="text-[9px] text-amber-700 dark:text-amber-400 font-normal" title="Dodatkowa oplata za rozladunek (zl/paleta)">
                                    + {k.paletyExtra} zł/pal rozład.
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mini-mapa: pokazuje gdzie jest dostawa i gdzie są oddziały */}
          <div className="rounded border bg-white/70 dark:bg-black/20 overflow-hidden">
            <div ref={mapContainerRef} className="w-full h-[220px]" />
          </div>
        </div>
      )}

      {isExternalOrNoPref ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">
            Typ „{typPojazdu || 'bez preferencji'}" — dyspozytor dobierze pojazd.
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={onBack}>← Wstecz</Button>
            <Button onClick={() => handleConfirmedSubmit(false)} disabled={submitting}>
              {submitting ? 'Wysyłanie...' : submitLabel('Złóż zlecenie')}
            </Button>
          </div>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">Brak pojazdów typu „{typPojazdu}" w tym oddziale.</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={onBack}>← Zmień typ / termin</Button>
            <Button variant="secondary" onClick={() => handleConfirmedSubmit(true)} disabled={submitting}>
              {submitting ? 'Wysyłanie...' : submitLabel('Załóż zlecenie')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-muted-foreground">
            Dostępność pojazdów ({vehicles.filter(v => v.fits).length}/{vehicles.length} wolnych)
          </p>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {vehicles.map(v => <VehicleCard key={v.flota_id} v={v} />)}
          </div>

          {anyFits ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={onBack}>← Wstecz</Button>
              <Button onClick={() => handleConfirmedSubmit(false)} disabled={submitting}>
                {submitting ? 'Wysyłanie...' : submitLabel('Złóż zlecenie')}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 space-y-3">
              <p className="text-sm font-medium text-destructive">
                Żaden pojazd typu „{typPojazdu}" nie ma wystarczającej pojemności na {dzien}.
              </p>

              {/* Wolne przedziały na ten dzień */}
              {freeSlots.length > 0 && onChangeGodzina && (
                <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 p-3 space-y-2">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                    Wolne przedziały na {dzien}:
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {freeSlots.map(slot => (
                      <Button key={slot} size="sm" variant="outline"
                        className="border-yellow-400 text-yellow-700 hover:bg-yellow-100"
                        onClick={() => onChangeGodzina(slot)}>
                        {slot}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sugestia następnego wolnego terminu */}
              {searchingNext && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-3">
                  <p className="text-sm text-blue-700 dark:text-blue-300">Szukam najbliższego wolnego terminu...</p>
                </div>
              )}
              {nextAvailable && (
                <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-3 space-y-2">
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">
                    Najbliższy wolny termin: <strong>{nextAvailable.dzien}</strong>
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {nextAvailable.nr_rej} · {nextAvailable.typ} — {nextAvailable.pct_kg}% zajęte
                  </p>
                  {onChangeDzien && (
                    <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-100"
                      onClick={() => onChangeDzien(nextAvailable.dzien)}>
                      Użyj tego terminu ({nextAvailable.dzien})
                    </Button>
                  )}
                </div>
              )}
              {!searchingNext && !nextAvailable && (
                <p className="text-xs text-muted-foreground">Brak wolnych terminów w najbliższych 14 dniach roboczych.</p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={onBack}>
                  Zmień termin / pojazd
                </Button>
                <Button variant="secondary" onClick={() => handleConfirmedSubmit(true)} disabled={submitting}>
                  {submitting ? 'Wysyłanie...' : submitLabel('Załóż zlecenie')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
