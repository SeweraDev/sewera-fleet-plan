import { useEffect, useRef, useState } from 'react';
import type { KursPropozycja, CrossBranchSugestia } from '@/lib/planTras';
import type { SugestiaDorzucenia } from '@/lib/proponujDorzucenie';

const KURS_KOLORY = [
  '#dc2626', // czerwony
  '#2563eb', // niebieski
  '#16a34a', // zielony
  '#ea580c', // pomarańczowy
  '#7c3aed', // fioletowy
  '#0891b2', // turkus
  '#ca8a04', // złoty
  '#be185d', // różowy
];

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
    script.onerror = () => reject(new Error('Leaflet CDN error'));
    document.head.appendChild(script);
  });
}

interface Props {
  kursy: KursPropozycja[];
  oddzialBaza: { lat: number; lng: number };
  oddzialNazwa: string;
  crossBranch: CrossBranchSugestia[];
  dorzucenia: SugestiaDorzucenia[];
}

/**
 * Mapa Leaflet wizualizujaca proponowany auto-plan tras.
 *
 * Per kurs: polyline w innym kolorze, markery przystankow z numerem kolejnosci.
 * Marker bazy oddzialu (czarna gwiazdka).
 * Markery cross-branch (zolte) — paczki sugerowane do przekazania.
 * Markery dorzucenia (niebieskie obwod) — paczki sugerowane do dolozenia z
 * innych oddzialow.
 */
export function AutoPlanMapa({
  kursy,
  oddzialBaza,
  oddzialNazwa,
  crossBranch,
  dorzucenia,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || !L) return;
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }

        const map = L.map(containerRef.current).setView(
          [oddzialBaza.lat, oddzialBaza.lng],
          10
        );
        mapRef.current = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
        }).addTo(map);

        const allPoints: [number, number][] = [[oddzialBaza.lat, oddzialBaza.lng]];

        // Marker bazy oddzialu (czarna gwiazdka)
        const bazaIcon = L.divIcon({
          className: '',
          html: `<div style="background:#000;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3)">★</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        L.marker([oddzialBaza.lat, oddzialBaza.lng], { icon: bazaIcon, zIndexOffset: 2000 })
          .addTo(map)
          .bindPopup(`<b>Baza ${oddzialNazwa}</b>`);

        // Per kurs: polyline + markery przystanków
        kursy.forEach((kurs, kursIdx) => {
          const kolor = KURS_KOLORY[kursIdx % KURS_KOLORY.length];
          const punktyTrasy: [number, number][] = [
            [oddzialBaza.lat, oddzialBaza.lng],
            ...kurs.przystanki.map((p) => [p.lat, p.lng] as [number, number]),
            [oddzialBaza.lat, oddzialBaza.lng],
          ];

          // Polyline trasy
          L.polyline(punktyTrasy, {
            color: kolor,
            weight: 4,
            opacity: 0.7,
          }).addTo(map);

          // Markery przystanków
          kurs.przystanki.forEach((p, i) => {
            allPoints.push([p.lat, p.lng]);
            const icon = L.divIcon({
              className: '',
              html: `<div style="background:${kolor};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)">${i + 1}</div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            });
            const popup = `
              <b>#${kursIdx + 1}.${i + 1} ${p.odbiorca}</b><br/>
              ${p.adres}<br/>
              <small>${Math.round(p.suma_kg)} kg${p.wymagany_typ ? ` • ${p.wymagany_typ}` : ''}</small><br/>
              <small style="color:${kolor}">Kurs: ${kurs.pojazd.nr_rej} (${kurs.pojazd.typ})${kurs.kierowca ? ` • ${kurs.kierowca.imie_nazwisko}` : ''}</small>
            `;
            L.marker([p.lat, p.lng], { icon, zIndexOffset: 1000 })
              .addTo(map)
              .bindPopup(popup);
          });
        });

        // Markery cross-branch (przekazania) — żółte
        crossBranch.forEach((cb) => {
          const p = cb.paczka;
          allPoints.push([p.lat, p.lng]);
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:#facc15;color:#000;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)">↗</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          L.marker([p.lat, p.lng], { icon })
            .addTo(map)
            .bindPopup(`<b>↗ Przekaż do ${cb.oddzial_nazwa}</b><br/>${p.odbiorca}<br/>${p.adres}<br/><small>${cb.powod}</small>`);
        });

        // Markery dorzucenia (sugestie z innych oddziałów) — niebieskie z + symbolem
        dorzucenia.forEach((s) => {
          const p = s.paczka_obca;
          allPoints.push([p.lat, p.lng]);
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:#3b82f6;color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;border:2px dashed white;box-shadow:0 1px 3px rgba(0,0,0,.3)">+</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          L.marker([p.lat, p.lng], { icon })
            .addTo(map)
            .bindPopup(
              `<b>+ Można dorzucić</b><br/>${p.odbiorca}<br/>${p.adres}<br/><small>${p.oddzial_zrodlowy_nazwa}${p.kurs_zrodlowy_numer ? ` • obecnie w ${p.kurs_zrodlowy_numer}` : ''}</small><br/><small>+${s.przyrost_km} km</small>`
            );
        });

        // Auto-fit do wszystkich punktów
        if (allPoints.length > 1) {
          map.fitBounds(allPoints, { padding: [40, 40], maxZoom: 12 });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError('Błąd ładowania mapy: ' + (e?.message || 'nieznany'));
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          /* noop */
        }
        mapRef.current = null;
      }
    };
  }, [kursy, oddzialBaza, oddzialNazwa, crossBranch, dorzucenia]);

  if (error) {
    return <div className="text-sm text-red-600 p-3 bg-red-50 rounded">{error}</div>;
  }

  return (
    <div>
      {/* Legenda */}
      <div className="text-xs text-muted-foreground mb-2 flex flex-wrap gap-3 items-center">
        <span className="flex items-center gap-1">
          <span style={{ background: '#000', color: '#fff', width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>★</span>
          Baza
        </span>
        {kursy.map((k, i) => (
          <span key={k.kurs_id_tmp} className="flex items-center gap-1">
            <span
              style={{
                background: KURS_KOLORY[i % KURS_KOLORY.length],
                color: '#fff',
                width: 18,
                height: 18,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
              }}
            >
              #{i + 1}
            </span>
            {k.pojazd.nr_rej}
          </span>
        ))}
        {crossBranch.length > 0 && (
          <span className="flex items-center gap-1">
            <span style={{ background: '#facc15', color: '#000', width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>↗</span>
            Przekazanie
          </span>
        )}
        {dorzucenia.length > 0 && (
          <span className="flex items-center gap-1">
            <span style={{ background: '#3b82f6', color: '#fff', width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>+</span>
            Dorzucenie
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        className="border rounded-lg"
        style={{ height: 400, width: '100%', zIndex: 0 }}
      />
    </div>
  );
}
