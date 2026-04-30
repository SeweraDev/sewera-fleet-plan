import { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { calculateRouteTotal } from '@/lib/oddzialy-geo';
import { rozliczKurs, type WzDoRozliczenia, type RozliczenieKursu } from '@/lib/rozliczenie-kolka';
import { groupKey as groupKeyByAdresLatLng } from '@/lib/groupByAdres';
import { EdytujKmModal } from '@/components/dyspozytor/EdytujKmModal';
import { EdytujProstaModal } from '@/components/dyspozytor/EdytujProstaModal';
import { KLASYFIKACJE } from '@/lib/klasyfikacje';
import { ODDZIAL_COORDS, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useOddzialy } from '@/hooks/useOddzialy';
import { useFlotaOddzialu } from '@/hooks/useFlotaOddzialu';
import { useKursyDnia } from '@/hooks/useKursyDnia';
import { useKierowcyOddzialu } from '@/hooks/useKierowcyOddzialu';
import { useZleceniaBezKursu } from '@/hooks/useZleceniaBezKursu';
import { useKursActions } from '@/hooks/useKursActions';
import { useCreateKurs } from '@/hooks/useCreateKurs';
import { Badge } from '@/components/ui/badge';
import { FlotaSection } from '@/components/dyspozytor/FlotaSection';
import { ImportExcelModal } from '@/components/dyspozytor/ImportExcelModal';
import { ZleceniaTab } from '@/components/dyspozytor/ZleceniaTab';
import { KolejkaTab } from '@/components/dyspozytor/KolejkaTab';
import { EdytujZlecenieModal } from '@/components/dyspozytor/EdytujZlecenieModal';
import { EdytujKursModal } from '@/components/dyspozytor/EdytujKursModal';
import { AutoPlanModal } from '@/components/dyspozytor/AutoPlanModal';
import { ImportZleceniaCsvModal } from '@/components/dyspozytor/ImportZleceniaCsvModal';
import { PrzepnijModal } from '@/components/dyspozytor/PrzepnijModal';
import { PolaczKursyModal } from '@/components/dyspozytor/PolaczKursyModal';
import { DodajDoKursuModal } from '@/components/dyspozytor/DodajDoKursuModal';
import { useBlokady } from '@/hooks/useBlokady';
import { useCreateZlecenie, type WzInput } from '@/hooks/useCreateZlecenie';
import { TypPojazduStep } from '@/components/sprzedawca/TypPojazduStep';
import { CzasDostawyStep } from '@/components/sprzedawca/CzasDostawyStep';
import { WzFormTabs } from '@/components/sprzedawca/WzFormTabs';
import { DostepnoscStep } from '@/components/sprzedawca/DostepnoscStep';
import { WycenTransportTab } from '@/components/shared/WycenTransportTab';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import type { KursDto, PrzystanekDto } from '@/hooks/useKursyDnia';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';
import type { Kierowca } from '@/hooks/useKierowcyOddzialu';

const KursyMapView = lazy(() => import('@/components/dyspozytor/KursyMapView'));

const SIDEBAR_ITEMS = [
  { id: 'kursy', label: '🚛 Kursy' },
  { id: 'zlecenia', label: '📋 Zlecenia' },
  { id: 'kolejka', label: '🔍 Podgląd zleceń' },
  { id: 'nowe_zlecenie', label: '➕ Nowe zlecenie' },
  { id: 'wycen', label: '💰 Wyceń transport' },
  { id: 'flota', label: '🔧 Flota' },
  { id: 'mapa', label: '🗺️ Mapa dostaw', url: '/mapa' },
];

function capacityColor(pct: number) {
  if (pct <= 70) return 'bg-green-500';
  if (pct <= 90) return 'bg-orange-500';
  return 'bg-red-500';
}

function capacityTextColor(pct: number) {
  if (pct <= 70) return 'text-green-600 dark:text-green-400';
  if (pct <= 90) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function CapacityBar({ used, total, unit }: { used: number; total: number; unit: string }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const displayPct = Math.min(pct, 100);
  return (
    <div className="flex-1 min-w-0">
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${capacityColor(pct)}`} style={{ width: `${displayPct}%` }} />
      </div>
      <p className={`text-[10px] font-medium mt-0.5 ${capacityTextColor(pct)}`}>
        {Math.round(used)} / {Math.round(total)} {unit} ({Math.round(pct)}%)
      </p>
    </div>
  );
}

type StatusFilter = 'zaplanowany' | 'aktywny' | 'zakonczony' | 'usuniety';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'zaplanowany', label: 'Zaplanowane' },
  { key: 'aktywny', label: 'W trasie' },
  { key: 'zakonczony', label: 'Zakończone' },
  { key: 'usuniety', label: 'Usunięte' },
];

function KursyTab({ oddzialId, oddzialNazwa, dzien, dzienDo, zlBezKursuCount, doWeryfikacjiCount, onOpenModal, flota, kierowcy, isBlocked, onZlChange }: { oddzialId: number | null; oddzialNazwa?: string; dzien: string; dzienDo?: string; zlBezKursuCount: number; doWeryfikacjiCount: number; onOpenModal: () => void; flota: Pojazd[]; kierowcy: Kierowca[]; isBlocked?: (typ: string, zasobId: string, dzien: string) => boolean; onZlChange?: () => void }) {
  const { kursy, przystanki, loading, refetch } = useKursyDnia(oddzialId, dzien, dzienDo);
  const combinedRefetch = () => { refetch(); onZlChange?.(); };
  const { handleStart, handleStop, handlePrzystanek, acting } = useKursActions(combinedRefetch);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('zaplanowany');
  const [kursKm, setKursKm] = useState<Record<string, number | null>>({});

  // Reset km cache gdy zmienia się lista kursów
  useEffect(() => { setKursKm({}); }, [kursy.length]);

  // Oblicz łączne km trasy per kurs (w tle): oddział → przystanki → oddział
  useEffect(() => {
    if (!oddzialNazwa || !kursy.length) return;
    (async () => {
      for (const kurs of kursy) {
        if (kursKm[kurs.id] !== undefined) continue;
        const kPrz = przystanki.filter(p => p.kurs_id === kurs.id);
        const adresy = [...new Set(kPrz.map(p => p.adres).filter(Boolean))];
        if (!adresy.length) continue;
        const km = await calculateRouteTotal(oddzialNazwa, adresy);
        if (km != null) {
          setKursKm(prev => ({ ...prev, [kurs.id]: km }));
        }
      }
    })();
  }, [kursy, przystanki, oddzialNazwa]);

  const [editZlId, setEditZlId] = useState<string | null>(null);
  const [editKurs, setEditKurs] = useState<KursDto | null>(null);
  const [editKmKurs, setEditKmKurs] = useState<KursDto | null>(null);
  const [editProsta, setEditProsta] = useState<{ kursId: string; zlecenieIds: string[]; adres: string; kmProsta: number | null; override: number | null } | null>(null);
  // Drag & drop reorderingu przystanków: trzymamy klucz grupy (adres) — bo wiele
  // WZ pod jednym adresem to jeden przystanek dla kierowcy.
  const [dragKursId, setDragKursId] = useState<string | null>(null);
  const [dragGroupKey, setDragGroupKey] = useState<string | null>(null);
  const [dragOverGroupKey, setDragOverGroupKey] = useState<string | null>(null);

  /**
   * Zmień kolejność grupy adresów w kursie. fromKey i toKey to klucze grupy
   * (z groupKeyByAdresLatLng). Funkcja zbiera wszystkie WZ pod tymi adresami,
   * przelicza nowe `kolejnosc` w `kurs_przystanki` i zapisuje batch'em.
   */
  const handleReorderPrzystanki = async (kursId: string, fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const kPrz = przystanki.filter(p => p.kurs_id === kursId);
    if (kPrz.length === 0) return;

    // Zbuduj listę unikalnych grup w aktualnej kolejności
    const seen = new Set<string>();
    const groups: { key: string; items: typeof kPrz }[] = [];
    for (const p of kPrz) {
      const k = groupKeyByAdresLatLng(p);
      if (seen.has(k)) {
        groups.find(g => g.key === k)!.items.push(p);
      } else {
        seen.add(k);
        groups.push({ key: k, items: [p] });
      }
    }

    // Wyciągnij grupę 'from' i wstaw przed 'to'
    const fromIdx = groups.findIndex(g => g.key === fromKey);
    const toIdx = groups.findIndex(g => g.key === toKey);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = groups.splice(fromIdx, 1);
    // Po splice indeks toKey może się przesunąć
    const newToIdx = groups.findIndex(g => g.key === toKey);
    groups.splice(newToIdx, 0, moved);

    // Buduj listę zaktualizowanych WZ — kazdy WZ dostaje nowy `kolejnosc`
    // (per WZ, nie per grupa, bo DB ma kolejnosc na poziomie kurs_przystanki)
    const updates: { id: string; kolejnosc: number }[] = [];
    let kol = 1;
    for (const g of groups) {
      for (const item of g.items) {
        // p.id w PrzystanekDto może być sztuczne ('${prz_id}_wz${i}') —
        // wyciągamy oryginalne id przystanku przed '_wz'
        const realId = item.id.includes('_wz') ? item.id.split('_wz')[0] : item.id;
        // Każdy realId tylko raz (jedno zlecenie = jeden przystanek w DB)
        if (!updates.find(u => u.id === realId)) {
          updates.push({ id: realId, kolejnosc: kol });
        }
      }
      kol += g.items.length; // następna grupa zaczyna po wszystkich WZ tej grupy
    }

    // Update batch w Supabase (Promise.all, każdy update osobno bo różne wartości)
    try {
      const results = await Promise.all(
        updates.map(u =>
          supabase.from('kurs_przystanki').update({ kolejnosc: u.kolejnosc }).eq('id', u.id)
        )
      );
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;
      toast.success('Kolejność przystanków zmieniona');
      combinedRefetch();
    } catch (e: any) {
      toast.error('Błąd zmiany kolejności: ' + (e?.message || 'nieznany'));
    }
  };

  /** Zmień klasyfikację dla wszystkich WZ na danym adresie w obrębie kursa. */
  const handleChangeKlasyfikacjaAdres = async (kursId: string, adres: string, nowaKlasyf: string) => {
    // Znajdź wszystkie przystanki kursa z tym adresem
    const norm = (a: string) => (a || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const kPrzKursa = przystanki.filter(p => p.kurs_id === kursId && norm(p.adres) === norm(adres));
    const zlecenieIds = Array.from(new Set(kPrzKursa.map(p => p.zlecenie_id).filter(Boolean))) as string[];
    if (zlecenieIds.length === 0) return;
    // Zmień klasyfikację we wszystkich WZ tych zleceń, pod tym konkretnym adresem
    const { error } = await supabase
      .from('zlecenia_wz')
      .update({ klasyfikacja: nowaKlasyf })
      .in('zlecenie_id', zlecenieIds)
      .eq('adres', kPrzKursa[0].adres);
    if (error) {
      toast.error('Błąd zmiany klasyfikacji: ' + error.message);
      return;
    }
    toast.success('Zmieniono klasyfikację');
    refetch();
  };
  const [przepnijPrz, setPrzepnijPrz] = useState<PrzystanekDto | null>(null);
  const [przepnijKurs, setPrzepnijKurs] = useState<KursDto | null>(null);

  const filteredBase = kursy.filter(k => k.status === statusFilter);
  // Sortuj kursy: nr_rej → typ → godzina_start
  const filtered = [...filteredBase].sort((a, b) => {
    const nrCmp = (a.nr_rej || '').localeCompare(b.nr_rej || '');
    if (nrCmp !== 0) return nrCmp;
    const typCmp = (a.pojazd_typ || '').localeCompare(b.pojazd_typ || '');
    if (typCmp !== 0) return typCmp;
    return (a.godzina_start || '').localeCompare(b.godzina_start || '');
  });
  const counts = {
    all: kursy.filter(k => k.status !== 'usuniety').length,
    zaplanowany: kursy.filter(k => k.status === 'zaplanowany').length,
    aktywny: kursy.filter(k => k.status === 'aktywny').length,
    zakonczony: kursy.filter(k => k.status === 'zakonczony').length,
    usuniety: kursy.filter(k => k.status === 'usuniety').length,
  };

  // ConfirmDialog state for kurs deletion
  const [deleteKursId, setDeleteKursId] = useState<string | null>(null);
  const [mergeKurs, setMergeKurs] = useState<KursDto | null>(null);
  const [addToKurs, setAddToKurs] = useState<KursDto | null>(null);
  const [showMap, setShowMap] = useState(false);

  // Odpinanie zlecenia z kursu (podwójne potwierdzenie)
  const [odpinZl, setOdpinZl] = useState<{ zlId: string; przId: string; numer: string } | null>(null);
  const [odpinStep, setOdpinStep] = useState(0); // 0=brak, 1=pierwsze pytanie, 2=drugie pytanie

  if (loading) return <p className="text-muted-foreground text-center py-8">Ładowanie kursów...</p>;

  return (
    <div className="space-y-4">
      {/* Status filter pills + mapa toggle */}
      <div className="flex gap-2 flex-wrap items-center">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
        <button
          onClick={() => setShowMap(!showMap)}
          className={`ml-auto px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            showMap ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          🗺️ Mapa
        </button>
      </div>

      {/* Mapa kursów */}
      {showMap && przystanki.length > 0 && oddzialNazwa && (
        <Suspense fallback={<div className="rounded-lg border bg-muted/50 p-6 text-center text-sm text-muted-foreground">Ładowanie mapy...</div>}>
          <KursyMapView
            kursy={filtered}
            przystanki={przystanki.filter(p => filtered.some(k => k.id === p.kurs_id))}
            oddzialNazwa={oddzialNazwa}
          />
        </Suspense>
      )}

      {filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          {kursy.length === 0 ? 'Brak kursów na wybrany dzień' : 'Brak kursów o wybranym statusie'}
        </CardContent></Card>
      ) : (
        filtered.map(kurs => {
          const kPrz = przystanki.filter(p => p.kurs_id === kurs.id);
          const done = kPrz.filter(p => p.prz_status === 'dostarczone').length;
          const usedKg = kPrz.reduce((s, p) => s + p.masa_kg, 0);
          const usedM3 = kPrz.reduce((s, p) => s + p.objetosc_m3, 0);
          const usedPal = kPrz.reduce((s, p) => s + p.ilosc_palet, 0);
          // Rozliczenie kosztów — tylko dla kursów zakończonych
          // km_kolka_efektywne = km_rozliczeniowe (override drogomierza) ?? (km_osrm + Σ odcinki_techniczne)
          const isZakonczony = kurs.status === 'zakonczony';
          const odcinkiSuma = (kurs.odcinki_techniczne || []).reduce((s, o) => s + (o.km || 0), 0);
          const kmOsrm = kursKm[kurs.id] ?? null;
          const kmEfektywne = kurs.km_rozliczeniowe != null
            ? kurs.km_rozliczeniowe
            : ((kmOsrm ?? 0) + odcinkiSuma);
          let rozliczenie: RozliczenieKursu | null = null;
          if (isZakonczony) {
            const wzListRozl: WzDoRozliczenia[] = kPrz.map(p => ({
              id: p.id, numer_wz: p.numer_wz || '', odbiorca: p.odbiorca, adres: p.adres,
              klasyfikacja: p.klasyfikacja, masa_kg: p.masa_kg, wartosc_netto: p.wartosc_netto,
              kolejnosc: p.kolejnosc,
              // Override z ręcznej edycji ma priorytet nad Haversine z Photona
              km_prosta: p.km_prosta_override ?? p.km_prosta,
              // lat/lng do grupowania spójnego z UI (luźne — różne zapisy = ta sama lokalizacja)
              lat: p.lat, lng: p.lng,
            }));
            rozliczenie = rozliczKurs(kmEfektywne, wzListRozl);
          }
          // Mapy per groupKey (lat/lng po geocodingu, fallback adres) — spójne
          // z UI tabeli i algorytmem rozliczenia (groupByAdres.ts).
          const kosztByWzId = new Map<string, number>();
          const kmPunktuByGroup = new Map<string, number>();
          const udzialProcByGroup = new Map<string, number>();
          const kosztPunktuByGroup = new Map<string, number>();
          if (rozliczenie) {
            for (const pt of rozliczenie.punkty) {
              kmPunktuByGroup.set(pt.group_key, pt.km_punktu);
              udzialProcByGroup.set(pt.group_key, pt.udzial_proc);
              kosztPunktuByGroup.set(pt.group_key, pt.koszt_punktu);
              for (const w of pt.wz) {
                kosztByWzId.set(w.id, w.koszt_wz);
              }
            }
          }
          return (
            <Card key={kurs.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {kurs.numer && <span className="font-mono text-xs text-primary font-semibold">{kurs.numer}</span>}
                    <Badge variant="outline" className="font-mono">{kurs.nr_rej || 'Brak pojazdu'}</Badge>
                    {kurs.pojazd_typ && <span className="text-muted-foreground text-xs">· {kurs.pojazd_typ}</span>}
                    <StatusBadge status={kurs.status} />
                  </CardTitle>
                  <div className="flex gap-1">
                    {kurs.status !== 'usuniety' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`/karta-drogowa/${kurs.id}`, '_blank')}
                        title="Otwórz kartę drogową do wydruku"
                      >
                        🖨️ Karta
                      </Button>
                    )}
                    {kurs.status !== 'usuniety' && <Button size="sm" variant="ghost" onClick={() => setEditKurs(kurs)}>Edytuj</Button>}
                    {kurs.status === 'zaplanowany' && (
                      <Button size="sm" variant="outline" onClick={() => setAddToKurs(kurs)}>+ Dodaj</Button>
                    )}
                    {kurs.status === 'zaplanowany' && kPrz.length > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setMergeKurs(kurs)}>Połącz</Button>
                    )}
                    {kurs.status === 'zaplanowany' && (
                      <Button size="sm" variant="destructive" onClick={() => setDeleteKursId(kurs.id)}>Usuń</Button>
                    )}
                    {kurs.status === 'zaplanowany' && kPrz.length > 0 && (
                      <Button size="sm" onClick={() => handleStart(kurs.id)} disabled={acting}>Wyjazd</Button>
                    )}
                    {kurs.status === 'aktywny' && (
                      <Button size="sm" variant="secondary" onClick={() => handleStop(kurs.id)} disabled={acting}>Powrót</Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Kierowca: {kurs.kierowca_nazwa || '— (nieprzypisany)'}
                  {kurs.kierowca_tel && (
                    <> · 📞 <a href={`tel:${kurs.kierowca_tel}`} className="text-primary hover:underline">{kurs.kierowca_tel}</a></>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Rozładunki: {done}/{kPrz.length} · {Math.round(usedKg)}/{Math.round(kurs.ladownosc_kg)} kg
                  {isZakonczony ? (
                    <span>
                      {' · '}
                      {kmEfektywne.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                      {kurs.km_rozliczeniowe != null && <span className="text-[10px]"> (drogomierz)</span>}
                      {odcinkiSuma > 0 && kurs.km_rozliczeniowe == null && <span className="text-[10px]"> (OSRM + {odcinkiSuma.toFixed(1)} tech.)</span>}
                      {' '}
                      <button
                        onClick={() => setEditKmKurs(kurs)}
                        className="text-primary hover:underline text-[10px] ml-1"
                        title="Edytuj km / odcinki techniczne"
                      >✏️ edytuj km</button>
                    </span>
                  ) : (
                    <>
                      {kursKm[kurs.id] != null && <span> · {kursKm[kurs.id]} km trasa</span>}
                      {kursKm[kurs.id] === undefined && kPrz.length > 0 && <span> · ... km</span>}
                    </>
                  )}
                  {kurs.max_palet != null && <> · 📦 {usedPal}/{kurs.max_palet} pal</>}
                  {rozliczenie && <span className="font-semibold text-foreground"> · 💰 {rozliczenie.koszt_calkowity.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł</span>}
                </p>
                {isZakonczony && kurs.odcinki_techniczne && kurs.odcinki_techniczne.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Odcinki techniczne: {kurs.odcinki_techniczne.map(o => `${o.opis} (${o.km.toFixed(1)} km)`).join(' · ')}
                  </p>
                )}
                {rozliczenie && rozliczenie.ostrzezenia.length > 0 && (
                  <div className="mt-2 rounded border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-900 px-2 py-1">
                    <ul className="text-[11px] text-yellow-800 dark:text-yellow-200 list-disc pl-4">
                      {rozliczenie.ostrzezenia.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </div>
                )}
                {kurs.ladownosc_kg > 0 && (
                  <div className="flex gap-4 mt-2">
                    <CapacityBar used={usedKg} total={kurs.ladownosc_kg} unit="kg" />
                    {kurs.objetosc_m3 != null && kurs.objetosc_m3 > 0 && (
                      <CapacityBar used={usedM3} total={kurs.objetosc_m3} unit="m³" />
                    )}
                    {kurs.max_palet != null && kurs.max_palet > 0 && (
                      <CapacityBar used={usedPal} total={kurs.max_palet} unit="pal" />
                    )}
                  </div>
                )}
              </CardHeader>
              {kPrz.length > 0 && (
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Godzina</TableHead>
                        <TableHead>Odbiorca</TableHead>
                        <TableHead>Nr WZ</TableHead>
                        <TableHead>Adres</TableHead>
                        <TableHead>Klasyf.</TableHead>
                        <TableHead className="text-right">Kg</TableHead>
                        <TableHead className="text-right">m³</TableHead>
                        <TableHead className="text-right">Pal.</TableHead>
                        {isZakonczony ? (
                          <>
                            <TableHead className="text-right">Prosta</TableHead>
                            <TableHead className="text-right">Udział</TableHead>
                            <TableHead className="text-right">Km w kółku</TableHead>
                            <TableHead className="text-right">Koszt</TableHead>
                            <TableHead className="w-8"></TableHead>
                          </>
                        ) : (
                          <>
                            <TableHead>Tel / Kontakt</TableHead>
                            <TableHead>Uwagi</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead></TableHead>
                            <TableHead></TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        // Klucz grupowania: lat/lng z geocodingu (luźne porównanie ~11m)
                        // gdy są dostępne, fallback na znormalizowany adres.
                        // Łapie różne zapisy tego samego adresu (Marszałka Piłsudskiego
                        // vs Piłsudskiego) bo geocode daje te same współrzędne.
                        const groupKeyOf = (w: { kolejnosc: number; adres: string; lat?: number | null; lng?: number | null }) =>
                          groupKeyByAdresLatLng(w);

                        // Posortuj WZ tak, żeby ten sam adres był w ciągłym bloku
                        // (rowSpan musi być spójny). Zachowujemy kolejność pierwszego
                        // wystąpienia adresu — chronologia ogólna kursu pozostaje.
                        const firstIdxByKey = new Map<string, number>();
                        kPrz.forEach((x, i) => {
                          const k = groupKeyOf(x);
                          if (!firstIdxByKey.has(k)) firstIdxByKey.set(k, i);
                        });
                        const kPrzSorted = [...kPrz].sort((a, b) => {
                          const ka = groupKeyOf(a);
                          const kb = groupKeyOf(b);
                          if (ka === kb) return 0; // stabilny — zachowaj porządek w grupie
                          return (firstIdxByKey.get(ka)! - firstIdxByKey.get(kb)!);
                        });

                        // Renumeracja # po kolejności grup
                        const displayNumMap = new Map<string, number>();
                        kPrzSorted.forEach(x => {
                          const k = groupKeyOf(x);
                          if (!displayNumMap.has(k)) displayNumMap.set(k, displayNumMap.size + 1);
                        });
                        return kPrzSorted.map((p, pIdx) => {
                          const key = groupKeyOf(p);
                          const prevKey = pIdx > 0 ? groupKeyOf(kPrzSorted[pIdx - 1]) : null;
                          const isFirst = pIdx === 0 || prevKey !== key;
                          const groupSize = kPrzSorted.filter(x => groupKeyOf(x) === key).length;
                          const displayNum = displayNumMap.get(key)!;
                          // Drag&drop tylko dla statusu 'zaplanowany' (przed wyjazdem)
                          const isDraggable = isFirst && kurs.status === 'zaplanowany';
                          const isDragSrc = dragKursId === kurs.id && dragGroupKey === key;
                          const isDragOver = dragKursId === kurs.id && dragOverGroupKey === key && dragGroupKey !== key;
                          return (
                        <TableRow
                          key={p.id}
                          draggable={isDraggable}
                          onDragStart={(e) => {
                            if (!isDraggable) return;
                            setDragKursId(kurs.id);
                            setDragGroupKey(key);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            if (dragKursId !== kurs.id) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (dragOverGroupKey !== key) setDragOverGroupKey(key);
                          }}
                          onDragLeave={() => {
                            if (dragOverGroupKey === key) setDragOverGroupKey(null);
                          }}
                          onDrop={(e) => {
                            if (dragKursId !== kurs.id || !dragGroupKey || dragGroupKey === key) {
                              setDragKursId(null); setDragGroupKey(null); setDragOverGroupKey(null);
                              return;
                            }
                            e.preventDefault();
                            handleReorderPrzystanki(kurs.id, dragGroupKey, key);
                            setDragKursId(null); setDragGroupKey(null); setDragOverGroupKey(null);
                          }}
                          onDragEnd={() => {
                            setDragKursId(null); setDragGroupKey(null); setDragOverGroupKey(null);
                          }}
                          className={`${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragSrc ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-blue-500' : ''}`}
                        >
                          {isFirst ? (
                            <TableCell rowSpan={groupSize} className="align-top font-medium">
                              {isDraggable && <span className="mr-1 text-muted-foreground" title="Przeciągnij, aby zmienić kolejność">⋮⋮</span>}
                              {displayNum}
                            </TableCell>
                          ) : null}
                          <TableCell className="text-xs">{p.preferowana_godzina || '—'}</TableCell>
                          <TableCell className="text-xs max-w-[140px] truncate">{p.odbiorca}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[180px]">{p.numer_wz || p.zl_numer}</TableCell>
                          <TableCell className="text-xs max-w-[140px]">
                            <div className="truncate">{p.adres}</div>
                            {p.km_prosta != null && (
                              <div className="text-[10px] text-muted-foreground leading-tight">
                                prosta: {p.km_prosta.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                              </div>
                            )}
                          </TableCell>
                          {isZakonczony ? (
                            isFirst ? (
                              <TableCell rowSpan={groupSize} className="align-top">
                                <Select
                                  value={p.klasyfikacja || ''}
                                  onValueChange={(v) => handleChangeKlasyfikacjaAdres(kurs.id, p.adres, v)}
                                >
                                  <SelectTrigger className="h-7 w-16 text-[10px] px-2 font-mono">
                                    <SelectValue placeholder="—" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {KLASYFIKACJE.map(k => (
                                      <SelectItem key={k.kod} value={k.kod} className="text-xs">
                                        <span className="font-mono">{k.kod}</span> — {k.opis}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            ) : null
                          ) : (
                            <TableCell>
                              {p.klasyfikacja ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{p.klasyfikacja}</Badge>
                              ) : <span className="text-muted-foreground text-xs">—</span>}
                            </TableCell>
                          )}
                          <TableCell className="text-right">{Math.round(p.masa_kg)}</TableCell>
                          <TableCell className="text-right">{p.objetosc_m3 ? Math.round(p.objetosc_m3 * 10) / 10 : '—'}</TableCell>
                          <TableCell className="text-right">{p.ilosc_palet || '—'}</TableCell>
                          {isZakonczony ? (
                            <>
                              {isFirst ? (
                                <TableCell rowSpan={groupSize} className="align-top text-right text-xs">
                                  {(() => {
                                    const eff = p.km_prosta_override ?? p.km_prosta;
                                    const zlecenieIds = Array.from(new Set(
                                      kPrzSorted
                                        .filter(x => groupKeyOf(x) === key && x.zlecenie_id)
                                        .map(x => x.zlecenie_id!)
                                    ));
                                    return (
                                      <button
                                        onClick={() => setEditProsta({
                                          kursId: kurs.id,
                                          zlecenieIds,
                                          adres: p.adres,
                                          kmProsta: p.km_prosta,
                                          override: p.km_prosta_override,
                                        })}
                                        className="hover:underline"
                                        title="Kliknij, aby edytować linię prostą"
                                      >
                                        {eff != null ? eff.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km' : '—'}
                                        {p.km_prosta_override != null && <span className="text-[9px] text-primary ml-0.5">✎</span>}
                                      </button>
                                    );
                                  })()}
                                </TableCell>
                              ) : null}
                              {isFirst ? (
                                <TableCell rowSpan={groupSize} className="align-top text-right text-xs">
                                  {(() => { const u = udzialProcByGroup.get(key); return u != null ? (u * 100).toFixed(1) + ' %' : '—'; })()}
                                </TableCell>
                              ) : null}
                              {isFirst ? (
                                <TableCell rowSpan={groupSize} className="align-top text-right text-xs">
                                  {(() => { const km = kmPunktuByGroup.get(key); return km != null ? km.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km' : '—'; })()}
                                </TableCell>
                              ) : null}
                              <TableCell className="text-right text-xs font-semibold">
                                {(() => { const k = kosztByWzId.get(p.id); return k != null ? k.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł' : '—'; })()}
                              </TableCell>
                              <TableCell className="w-8 p-1">
                                {p.zlecenie_id && (
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditZlId(p.zlecenie_id)} title="Edytuj zlecenie / WZ">
                                    ✏️
                                  </Button>
                                )}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell className="text-xs max-w-[120px] truncate">{p.tel || '—'}</TableCell>
                              <TableCell className="text-xs max-w-[120px] truncate">{p.uwagi || '—'}</TableCell>
                              {isFirst ? (
                                <TableCell rowSpan={groupSize} className="align-top"><StatusBadge status={p.prz_status} /></TableCell>
                              ) : null}
                              <TableCell>
                                <div className="flex gap-1">
                                {p.zlecenie_id && (
                                  <Button size="sm" variant="ghost" onClick={() => setEditZlId(p.zlecenie_id)}>
                                    ✏️
                                  </Button>
                                )}
                                </div>
                              </TableCell>
                              {isFirst ? (
                                <TableCell rowSpan={groupSize} className="align-top">
                                  <div className="flex gap-1">
                                {p.prz_status === 'oczekuje' && kurs.status === 'aktywny' && (
                                  <Button size="sm" variant="outline" onClick={() => handlePrzystanek(p.id.split('_')[0])} disabled={acting}>
                                    ✓
                                  </Button>
                                )}
                                {p.zlecenie_id && (
                                  <Button size="sm" variant="ghost" onClick={() => { setPrzepnijPrz({...p, id: p.id.split('_')[0]}); setPrzepnijKurs(kurs); }}>
                                    🔀
                                  </Button>
                                )}
                                {p.zlecenie_id && kurs.status !== 'usuniety' && (
                                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                                    setOdpinZl({ zlId: p.zlecenie_id!, przId: p.id.split('_')[0], numer: p.zl_numer || p.numer_wz || '?' });
                                    setOdpinStep(1);
                                  }}>
                                    ↩️
                                  </Button>
                                )}
                                  </div>
                                </TableCell>
                              ) : null}
                            </>
                          )}
                        </TableRow>
                        );
                        });
                      })()}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          );
        })
      )}

      <EdytujZlecenieModal
        zlecenieId={editZlId}
        open={!!editZlId}
        onClose={() => setEditZlId(null)}
        onSaved={refetch}
      />

      <EdytujKmModal
        kursId={editKmKurs?.id || null}
        open={!!editKmKurs}
        onClose={() => setEditKmKurs(null)}
        kmOsrm={editKmKurs ? (kursKm[editKmKurs.id] ?? null) : null}
        kmRozliczeniowe={editKmKurs?.km_rozliczeniowe ?? null}
        odcinkiTech={editKmKurs?.odcinki_techniczne || []}
        onSaved={refetch}
      />

      <EdytujProstaModal
        open={!!editProsta}
        onClose={() => setEditProsta(null)}
        zlecenieIds={editProsta?.zlecenieIds || []}
        adres={editProsta?.adres || ''}
        oddzialAdres={(() => {
          const kod = NAZWA_TO_KOD[oddzialNazwa || ''];
          return kod ? (ODDZIAL_COORDS[kod]?.adres || oddzialNazwa || '') : (oddzialNazwa || '');
        })()}
        aktualneKmProsta={editProsta?.kmProsta ?? null}
        aktualnyOverride={editProsta?.override ?? null}
        onSaved={refetch}
      />

      <EdytujKursModal
        open={!!editKurs}
        onClose={() => setEditKurs(null)}
        kurs={editKurs}
        dzien={dzien}
        oddzialId={oddzialId}
        flota={flota}
        kierowcy={kierowcy}
        przystankiCount={editKurs ? przystanki.filter(p => p.kurs_id === editKurs.id).length : 0}
        onSaved={refetch}
        isBlocked={isBlocked}
      />

      <PrzepnijModal
        open={!!przepnijPrz}
        onClose={() => { setPrzepnijPrz(null); setPrzepnijKurs(null); }}
        przystanek={przepnijPrz}
        currentKurs={przepnijKurs}
        allKursy={kursy.filter(k => k.status !== 'usuniety')}
        allPrzystanki={przystanki}
        oddzialId={oddzialId}
        dzien={dzien}
        flota={flota}
        kierowcy={kierowcy}
        onDone={() => { refetch(); onZlChange?.(); }}
      />

      <PolaczKursyModal
        open={!!mergeKurs}
        onClose={() => setMergeKurs(null)}
        sourceKurs={mergeKurs}
        allKursy={kursy.filter(k => k.status !== 'usuniety')}
        allPrzystanki={przystanki}
        onDone={() => { refetch(); onZlChange?.(); }}
      />

      <DodajDoKursuModal
        open={!!addToKurs}
        onClose={() => setAddToKurs(null)}
        kurs={addToKurs}
        przystanki={przystanki}
        oddzialId={oddzialId}
        dzien={dzien}
        onDone={() => { refetch(); onZlChange?.(); }}
      />

      {/* Dialog odpinania zlecenia z kursu — krok 1 */}
      <ConfirmDialog
        open={odpinStep === 1}
        onOpenChange={(open) => { if (!open && odpinStep === 1) { setOdpinStep(0); setOdpinZl(null); } }}
        title="Odpiąć zlecenie z kursu?"
        description={`Czy chcesz przenieść zlecenie ${odpinZl?.numer || ''} z powrotem do puli zleceń bez kursu?`}
        confirmLabel="Tak, odepnij"
        destructive
        onConfirm={() => { setOdpinStep(2); }}
      />
      {/* Dialog odpinania zlecenia z kursu — krok 2 (potwierdzenie) */}
      <ConfirmDialog
        open={odpinStep === 2}
        onOpenChange={(open) => { if (!open) { setOdpinStep(0); setOdpinZl(null); } }}
        title="Na pewno?"
        description={`Potwierdzasz odpięcie zlecenia ${odpinZl?.numer || ''} z kursu. Zlecenie wróci do puli "bez kursu".`}
        confirmLabel="Potwierdzam"
        destructive
        onConfirm={async () => {
          if (!odpinZl) return;
          // Usuń przystanek z kursu (po zlecenie_id żeby złapać wszystkie WZ)
          await supabase.from('kurs_przystanki').delete().eq('zlecenie_id', odpinZl.zlId);
          // Sprawdź obecny status — terminalnym (anulowana/dostarczona) zostaw status,
          // pozostałym przywróć 'robocza'.
          const { data: zlSt } = await supabase.from('zlecenia').select('status').eq('id', odpinZl.zlId).single();
          const terminal = zlSt && ['anulowana', 'dostarczona'].includes(zlSt.status);
          if (terminal) {
            await supabase.from('zlecenia').update({ kurs_id: null } as any).eq('id', odpinZl.zlId);
          } else {
            await supabase.from('zlecenia').update({ status: 'robocza', kurs_id: null } as any).eq('id', odpinZl.zlId);
          }
          setOdpinStep(0);
          setOdpinZl(null);
          refetch();
          onZlChange?.();
          toast.success(`Zlecenie ${odpinZl.numer} odpięte z kursu`);
        }}
      />

      {/* Dialog potwierdzenia usunięcia kursu */}
      <ConfirmDialog
        open={!!deleteKursId}
        onOpenChange={(open) => { if (!open) setDeleteKursId(null); }}
        title="Usunąć kurs?"
        description="Czy na pewno chcesz usunąć ten kurs? Kurs zostanie przeniesiony do zakładki Usunięte. Zlecenia z tego kursu wrócą do puli bez kursu."
        confirmLabel="Usuń kurs"
        destructive
        onConfirm={async () => {
          if (!deleteKursId) return;
          // Odepnij przystanki (zlecenia wrócą do "bez kursu")
          const kPrz = przystanki.filter(p => p.kurs_id === deleteKursId);
          if (kPrz.length > 0) {
            const zlIds = kPrz.map(p => p.zlecenie_id).filter(Boolean) as string[];
            await supabase.from('kurs_przystanki').delete().eq('kurs_id', deleteKursId);
            if (zlIds.length > 0) {
              // Pobierz statusy żeby terminalnych (anulowana/dostarczona) nie wrzucać z powrotem do 'robocza'
              const { data: zlStatuses } = await supabase.from('zlecenia').select('id, status').in('id', zlIds);
              const terminalIds = (zlStatuses || []).filter(z => ['anulowana', 'dostarczona'].includes(z.status)).map(z => z.id);
              const niefinalIds = zlIds.filter(id => !terminalIds.includes(id));
              if (terminalIds.length > 0) {
                await supabase.from('zlecenia').update({ kurs_id: null } as any).in('id', terminalIds);
              }
              if (niefinalIds.length > 0) {
                await supabase.from('zlecenia').update({ status: 'robocza', kurs_id: null } as any).in('id', niefinalIds);
              }
            }
          }
          await supabase.from('kursy').update({ status: 'usuniety' } as any).eq('id', deleteKursId);
          setDeleteKursId(null);
          refetch();
          onZlChange?.();
          toast.success('Kurs usunięty — zlecenia wróciły do puli');
        }}
      />
    </div>
  );
}

function NowyKursModal({
  open, onClose, oddzialId, dzien, onCreated, preSelectedZlecenieIds, isBlocked
}: {
  open: boolean; onClose: () => void; oddzialId: number | null; dzien: string; onCreated: () => void; preSelectedZlecenieIds?: string[]; isBlocked?: (typ: string, zasobId: string, dzien: string) => boolean;
}) {
  const { kierowcy: allKierowcy } = useKierowcyOddzialu(oddzialId);
  const { flota: allFlota } = useFlotaOddzialu(oddzialId);
  const kierowcy = isBlocked ? allKierowcy.filter(k => !isBlocked('kierowca', k.id, dzien)) : allKierowcy;
  const flota = isBlocked ? allFlota.filter(f => !isBlocked('pojazd', f.id, dzien)) : allFlota;
  const { zlecenia, refetch: refetchZl } = useZleceniaBezKursu(oddzialId);
  const { create, submitting, error } = useCreateKurs(() => { onCreated(); onClose(); });

  const [kierowcaId, setKierowcaId] = useState<string>('');
  const [flotaId, setFlotaId] = useState<string>('');
  const [selectedZl, setSelectedZl] = useState<Set<string>>(new Set());

  // Pre-select zlecenia when modal opens + refetch
  useEffect(() => {
    if (open) {
      refetchZl();
      if (preSelectedZlecenieIds && preSelectedZlecenieIds.length > 0) {
        setSelectedZl(new Set(preSelectedZlecenieIds));
      }
    } else {
      setSelectedZl(new Set());
      setKierowcaId('');
      setFlotaId('');
    }
  }, [open, preSelectedZlecenieIds]);

  const toggleZl = (id: string) => {
    const s = new Set(selectedZl);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedZl(s);
  };

  // Walidacja pojemności
  const selectedVehicle = flota.find(f => f.id === flotaId);
  const totalKg = zlecenia.filter(z => selectedZl.has(z.id)).reduce((s, z) => s + z.suma_kg, 0);
  const totalM3 = zlecenia.filter(z => selectedZl.has(z.id)).reduce((s, z) => s + z.suma_m3, 0);
  const totalPalet = zlecenia.filter(z => selectedZl.has(z.id)).reduce((s, z) => s + z.suma_palet, 0);

  const capKg = selectedVehicle ? Number(selectedVehicle.ladownosc_kg) || 0 : 0;
  const capM3 = selectedVehicle ? Number(selectedVehicle.objetosc_m3) || 0 : 0;
  const capPalet = selectedVehicle ? Number(selectedVehicle.max_palet) || 0 : 0;

  const overKg = capKg > 0 && totalKg > capKg;
  const overM3 = capM3 > 0 && totalM3 > capM3;
  const overPalet = capPalet > 0 && totalPalet > capPalet;
  const isOverloaded = overKg || overM3 || overPalet;

  const [confirmedOverload, setConfirmedOverload] = useState(false);

  // Reset potwierdzenia gdy zmienia się selekcja lub pojazd
  useEffect(() => { setConfirmedOverload(false); }, [flotaId, selectedZl.size]);

  const handleCreate = () => {
    if (!oddzialId) return;
    if (isOverloaded && !confirmedOverload) {
      setConfirmedOverload(true);
      return;
    }
    const vehicle = flota.find(f => f.id === flotaId);
    const isZew = vehicle?.jest_zewnetrzny;
    create({
      oddzial_id: oddzialId,
      dzien,
      kierowca_id: kierowcaId || null,
      flota_id: isZew ? null : (flotaId || null),
      nr_rej_zewn: isZew ? (vehicle?.nr_rej_raw || null) : null,
      zlecenie_ids: Array.from(selectedZl),
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Nowy kurs — {dzien}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Kierowca</Label>
              <Select value={kierowcaId} onValueChange={setKierowcaId}>
                <SelectTrigger><SelectValue placeholder="Wybierz kierowcę" /></SelectTrigger>
                <SelectContent>
                  {kierowcy.map(k => <SelectItem key={k.id} value={k.id}>{k.imie_nazwisko}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pojazd</Label>
              <Select value={flotaId} onValueChange={setFlotaId}>
                <SelectTrigger><SelectValue placeholder="Wybierz pojazd" /></SelectTrigger>
                <SelectContent>
                  {flota.map(f => <SelectItem key={f.id} value={f.id}>{f.nr_rej} ({f.typ})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Zlecenia bez kursu ({zlecenia.length})</Label>
            {zlecenia.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak zleceń do przypisania</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-auto">
                {zlecenia.map(z => (
                  <div key={z.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => toggleZl(z.id)}>
                    <Checkbox checked={selectedZl.has(z.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{z.numer}</span>
                        <span className="text-xs text-muted-foreground">{z.dzien}</span>
                        {z.dzien < dzien && <Badge variant="destructive" className="text-[10px]">Zaległe</Badge>}
                        <span className="text-xs ml-auto">{Math.round(z.suma_kg)} kg{z.suma_m3 > 0 ? ` · ${z.suma_m3} m³` : ''}{z.suma_palet > 0 ? ` · ${z.suma_palet} pal` : ''}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {z.odbiorca || '—'} · {z.adres || '—'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Podsumowanie ładunku + walidacja pojemności */}
          {selectedZl.size > 0 && selectedVehicle && (
            <div className={`p-3 rounded-md text-sm space-y-1 ${isOverloaded ? 'bg-red-100 dark:bg-red-950/50 border border-red-400' : 'bg-muted'}`}>
              <div className="font-semibold mb-1">
                {isOverloaded ? '❌ Przekroczona pojemność!' : '📦 Podsumowanie ładunku:'}
              </div>
              <div className={`flex gap-4 ${overKg ? 'text-red-600 font-bold' : ''}`}>
                <span>Waga: {Math.round(totalKg)} / {capKg} kg</span>
                {overKg && <span>⚠️ +{Math.round(totalKg - capKg)} kg</span>}
              </div>
              {capM3 > 0 && (
                <div className={`flex gap-4 ${overM3 ? 'text-red-600 font-bold' : ''}`}>
                  <span>Objętość: {totalM3} / {capM3} m³</span>
                  {overM3 && <span>⚠️ +{(totalM3 - capM3).toFixed(1)} m³</span>}
                </div>
              )}
              {capPalet > 0 && (
                <div className={`flex gap-4 ${overPalet ? 'text-red-600 font-bold' : ''}`}>
                  <span>Palety: {totalPalet} / {capPalet} pal</span>
                  {overPalet && <span>⚠️ +{totalPalet - capPalet} pal</span>}
                </div>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button
            onClick={handleCreate}
            disabled={submitting || selectedZl.size === 0}
            variant={isOverloaded && confirmedOverload ? 'destructive' : 'default'}
          >
            {submitting ? 'Tworzenie...'
              : isOverloaded && !confirmedOverload ? `Utwórz mimo przekroczenia (${selectedZl.size} zleceń)`
              : isOverloaded && confirmedOverload ? `Potwierdz — utwórz kurs`
              : `Utwórz kurs (${selectedZl.size} zleceń)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Nowe Zlecenie (formularz identyczny jak u sprzedawcy) ─── */
function NoweZlecenieFormDyspozytor({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [typPojazdu, setTypPojazdu] = useState('');
  const [dzien, setDzien] = useState('');
  const [godzina, setGodzina] = useState('');
  const [wzList, setWzList] = useState<WzInput[]>([{
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0, bez_palet: false, luzne_karton: false, uwagi: '', klasyfikacja: '', wartosc_netto: null,
  }]);
  const { oddzialy, loading: loadingOddzialy } = useOddzialy();
  const { flota: flotaList, loading: loadingFlota } = useFlotaOddzialu(oddzialId);
  const { create, submitting, error } = useCreateZlecenie(onSuccess);

  const handleGoToCheck = () => {
    // Klasyfikacja transportu jest OPCJONALNA — mozna uzupelnic pozniej
    const invalid = wzList.find(w => {
      if (!w.odbiorca || !w.masa_kg) return true;
      if (!w.adres || w.adres.trim().length < 5) return true;
      if (!w.tel || w.tel.trim().length < 5) return true;
      if (!w.luzne_karton && (!w.objetosc_m3 || w.objetosc_m3 <= 0)) return true;
      if (!w.bez_palet && (!w.ilosc_palet || w.ilosc_palet <= 0)) return true;
      return false;
    });
    if (invalid) {
      const missing: string[] = [];
      if (!invalid.odbiorca) missing.push('odbiorca');
      if (!invalid.adres || invalid.adres.trim().length < 5) missing.push('adres dostawy');
      if (!invalid.tel || invalid.tel.trim().length < 5) missing.push('telefon kontaktowy');
      if (!invalid.masa_kg) missing.push('masa kg');
      if (!invalid.luzne_karton && (!invalid.objetosc_m3 || invalid.objetosc_m3 <= 0)) missing.push('objętość m³');
      if (!invalid.bez_palet && (!invalid.ilosc_palet || invalid.ilosc_palet <= 0)) missing.push('ilość palet');
      toast.error(`Uzupełnij: ${missing.join(', ')}`);
      return;
    }
    setStep(4);
  };

  const handleSubmit = (forceVerify: boolean) => {
    if (!oddzialId || !dzien || !godzina) { toast.error('Uzupełnij wszystkie pola'); return; }
    create({ oddzial_id: oddzialId, typ_pojazdu: typPojazdu === 'bez_preferencji' ? '' : typPojazdu, dzien, preferowana_godzina: godzina, wz_list: wzList }, forceVerify);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Nowe zlecenie — Krok {step}/4</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <TypPojazduStep oddzialId={oddzialId} setOddzialId={setOddzialId} typPojazdu={typPojazdu} setTypPojazdu={setTypPojazdu}
            oddzialy={oddzialy} loadingOddzialy={loadingOddzialy} flota={flotaList} loadingFlota={loadingFlota} onNext={() => setStep(2)} />
        )}
        {step === 2 && <CzasDostawyStep dzien={dzien} setDzien={setDzien} godzina={godzina} setGodzina={setGodzina} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && (
          <WzFormTabs wzList={wzList} setWzList={setWzList} error={error} submitting={submitting} onBack={() => setStep(2)} onSubmit={handleGoToCheck} typPojazdu={typPojazdu} />
        )}
        {step === 4 && oddzialId && (
          <DostepnoscStep oddzialId={oddzialId} typPojazdu={typPojazdu} dzien={dzien} godzina={godzina} wzList={wzList}
            onBack={() => setStep(3)} onSubmit={handleSubmit} submitting={submitting}
            onChangeDzien={(newDzien) => { setDzien(newDzien); setStep(2); }}
            onChangeGodzina={(newGodzina) => { setGodzina(newGodzina); setStep(2); }} />
        )}
      </CardContent>
    </Card>
  );
}

export default function DyspozytorDashboard() {
  const { profile } = useAuth();
  const [activeId, setActiveId] = useState('kursy');
  const { oddzialy } = useOddzialy();
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [dzien, setDzien] = useState(() => new Date().toISOString().split('T')[0]);
  const [rangeMode, setRangeMode] = useState(false);
  const [dzienDo, setDzienDo] = useState(() => new Date().toISOString().split('T')[0]);

  // Auto-set branch from profile once oddzialy load
  useEffect(() => {
    if (oddzialId !== null || !profile?.branch || oddzialy.length === 0) return;
    const match = oddzialy.find(o => o.nazwa === profile.branch);
    if (match) setOddzialId(match.id);
  }, [profile, oddzialy, oddzialId]);

  // Sprzatanie archiwum WZ — raz dziennie (sessionStorage flag).
  // Usuwa pliki z folderow starszych niz biezacy_miesiac - 1, czyli np. w kwietniu trzymamy
  // kwiecien + marzec, a marzec znika dopiero gdy zmieni sie miesiac.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (sessionStorage.getItem('wz-archiwum-cleanup') === today) return;
    sessionStorage.setItem('wz-archiwum-cleanup', today);
    import('@/lib/archiwumWZ').then(({ sprzatnijArchiwumWZ }) => {
      sprzatnijArchiwumWZ().then(n => {
        if (n && n > 0) console.log(`[archiwumWZ] sprzatniete ${n} starych dokumentow`);
      });
    });
  }, []);
  const [showModal, setShowModal] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [showAutoPlan, setShowAutoPlan] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [preSelectedZlIds, setPreSelectedZlIds] = useState<string[]>([]);
  const { flota, refetch: refetchFlota } = useFlotaOddzialu(oddzialId);
  const { kursy, refetch } = useKursyDnia(oddzialId, dzien, rangeMode ? dzienDo : undefined);
  const { zlecenia: zlBezKursu, refetch: refetchZlBezKursu } = useZleceniaBezKursu(oddzialId);
  const { isBlocked } = useBlokady(oddzialId, [dzien]);
  const { kierowcy } = useKierowcyOddzialu(oddzialId);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <div className="flex flex-1">
        <PageSidebar
          items={SIDEBAR_ITEMS.map(s => {
            if (s.id === 'kursy') return { ...s, badge: kursy.filter(k => k.status === 'zaplanowany').length || undefined };
            if (s.id === 'zlecenia') return { ...s, badge: zlBezKursu.length || undefined };
            return s;
          })}
          activeId={activeId}
          onSelect={setActiveId}
        />
        <main className="flex-1 p-6 overflow-auto">
          {/* Filters */}
          <div className="flex items-center gap-4 mb-6">
            <div>
              <Label className="text-xs text-muted-foreground">Oddział</Label>
              <Select value={oddzialId?.toString() || ''} onValueChange={v => setOddzialId(Number(v))}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
                <SelectContent>
                  {oddzialy.map(o => <SelectItem key={o.id} value={o.id.toString()}>{o.nazwa}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{rangeMode ? 'Od' : 'Dzień'}</Label>
              <Input type="date" value={dzien} onChange={e => setDzien(e.target.value)} className="w-40" />
            </div>
            {rangeMode && (
              <div>
                <Label className="text-xs text-muted-foreground">Do</Label>
                <Input type="date" value={dzienDo} onChange={e => setDzienDo(e.target.value)} className="w-40" />
              </div>
            )}
            <div className="flex items-end">
              <Button
                size="sm"
                variant={rangeMode ? 'default' : 'outline'}
                onClick={() => setRangeMode(!rangeMode)}
                className="whitespace-nowrap"
              >
                📅 Zakres
              </Button>
            </div>
            {activeId === 'kursy' && (
              <div className="ml-auto mt-4 flex gap-2">
                <Button variant="outline" onClick={() => setShowExcelImport(true)} disabled={!oddzialId}>
                  📊 Importuj plan
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAutoPlan(true)}
                  disabled={!oddzialId}
                  title="Automatyczne planowanie tras dla wszystkich niezaplanowanych zlecen z dnia"
                >
                  🤖 Auto-plan
                </Button>
                <Button onClick={() => setShowModal(true)} disabled={!oddzialId}>
                  + Nowy kurs
                </Button>
              </div>
            )}
            {activeId === 'zlecenia' && (
              <div className="ml-auto mt-4 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowImportCsv(true)}
                  disabled={!oddzialId}
                  title="Import zleceń z pliku CSV (Zestawienie z systemu magazynowego)"
                >
                  📥 Importuj z CSV
                </Button>
              </div>
            )}
          </div>

          {!oddzialId ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Wybierz oddział aby wyświetlić dane</CardContent></Card>
          ) : (
            <>
              {activeId === 'kursy' && (
                <KursyTab
                  oddzialId={oddzialId}
                  oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || ''}
                  dzien={dzien}
                  dzienDo={rangeMode ? dzienDo : undefined}
                  zlBezKursuCount={zlBezKursu.length}
                  doWeryfikacjiCount={zlBezKursu.filter(z => z.status === 'do_weryfikacji').length}
                  onOpenModal={() => setShowModal(true)}
                  flota={flota}
                  kierowcy={kierowcy}
                  isBlocked={isBlocked}
                  onZlChange={() => { refetchZlBezKursu(); refetch(); }}
                />
              )}
              {activeId === 'zlecenia' && (
                <ZleceniaTab
                  oddzialId={oddzialId}
                  oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || ''}
                  dzien={dzien}
                  onOpenKursModal={(zlIds) => { setPreSelectedZlIds(zlIds); setShowModal(true); }}
                  onZlChange={() => { refetchZlBezKursu(); refetch(); }}
                />
              )}
              {activeId === 'kolejka' && (
                <KolejkaTab
                  oddzialId={oddzialId}
                  oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || ''}
                  dzien={dzien}
                  dzienDo={rangeMode ? dzienDo : undefined}
                />
              )}
              {activeId === 'nowe_zlecenie' && (
                <NoweZlecenieFormDyspozytor onSuccess={() => setActiveId('zlecenia')} />
              )}
              {activeId === 'wycen' && (
                <WycenTransportTab oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || profile?.branch || 'Katowice'} />
              )}
              {activeId === 'flota' && (
                <FlotaSection oddzialId={oddzialId} flota={flota} oddzialy={oddzialy} onFlotaRefresh={refetchFlota} />
              )}
            </>
          )}

          <NowyKursModal
            open={showModal}
            onClose={() => { setShowModal(false); setPreSelectedZlIds([]); }}
            oddzialId={oddzialId}
            dzien={dzien}
            onCreated={() => { refetch(); refetchZlBezKursu(); }}
            preSelectedZlecenieIds={preSelectedZlIds}
            isBlocked={isBlocked}
          />

          <ImportExcelModal
            open={showExcelImport}
            onClose={() => setShowExcelImport(false)}
            oddzialId={oddzialId}
            dzien={dzien}
            flota={flota}
            kierowcy={kierowcy}
            oddzialy={oddzialy}
            onImported={() => { refetch(); refetchZlBezKursu(); }}
          />

          {oddzialId != null && (
            <AutoPlanModal
              open={showAutoPlan}
              onClose={() => setShowAutoPlan(false)}
              oddzialId={oddzialId}
              oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || ''}
              dzien={dzien}
              onPlanZapisany={() => { refetch(); refetchZlBezKursu(); }}
            />
          )}

          {oddzialId != null && (
            <ImportZleceniaCsvModal
              open={showImportCsv}
              onClose={() => setShowImportCsv(false)}
              oddzialId={oddzialId}
              oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || ''}
              onImported={() => { refetchZlBezKursu(); }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
