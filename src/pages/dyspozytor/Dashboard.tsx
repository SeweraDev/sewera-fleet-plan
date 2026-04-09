import { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { calculateRouteTotal } from '@/lib/oddzialy-geo';
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
import { EdytujZlecenieModal } from '@/components/dyspozytor/EdytujZlecenieModal';
import { EdytujKursModal } from '@/components/dyspozytor/EdytujKursModal';
import { PrzepnijModal } from '@/components/dyspozytor/PrzepnijModal';
import { PolaczKursyModal } from '@/components/dyspozytor/PolaczKursyModal';
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
  { id: 'nowe_zlecenie', label: '➕ Nowe zlecenie' },
  { id: 'wycen', label: '💰 Wyceń transport' },
  { id: 'flota', label: '🔧 Flota' },
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

function KursyTab({ oddzialId, oddzialNazwa, dzien, dzienDo, zlBezKursuCount, doWeryfikacjiCount, onOpenModal, flota, kierowcy, isBlocked }: { oddzialId: number | null; oddzialNazwa?: string; dzien: string; dzienDo?: string; zlBezKursuCount: number; doWeryfikacjiCount: number; onOpenModal: () => void; flota: Pojazd[]; kierowcy: Kierowca[]; isBlocked?: (typ: string, zasobId: string, dzien: string) => boolean }) {
  const { kursy, przystanki, loading, refetch } = useKursyDnia(oddzialId, dzien, dzienDo);
  const { handleStart, handleStop, handlePrzystanek, acting } = useKursActions(refetch);
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
  const [showMap, setShowMap] = useState(false);

  // Odpinanie zlecenia z kursu (podwójne potwierdzenie)
  const [odpinZl, setOdpinZl] = useState<{ zlId: string; przId: string; numer: string } | null>(null);
  const [odpinStep, setOdpinStep] = useState(0); // 0=brak, 1=pierwsze pytanie, 2=drugie pytanie

  if (loading) return <p className="text-muted-foreground text-center py-8">Ładowanie kursów...</p>;

  return (
    <div className="space-y-4">
      {/* Orange banner for unassigned orders */}
      {zlBezKursuCount > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-accent/15 border border-accent/30 px-4 py-3">
          <span className="text-sm font-medium text-accent-foreground">
            ⚠️ {zlBezKursuCount} zleceń bez przypisanego kursu
            {doWeryfikacjiCount > 0 && (
              <span className="ml-2 text-orange-600 dark:text-orange-400">
                (w tym 🚛 {doWeryfikacjiCount} domówień z trasy)
              </span>
            )}
          </span>
          <button
            onClick={onOpenModal}
            className="text-sm font-semibold text-accent hover:underline"
          >
            Przypisz →
          </button>
        </div>
      )}

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
                    {kurs.status !== 'usuniety' && <Button size="sm" variant="ghost" onClick={() => setEditKurs(kurs)}>Edytuj</Button>}
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
                  {kursKm[kurs.id] != null && <span> · {kursKm[kurs.id]} km trasa</span>}
                  {kursKm[kurs.id] === undefined && kPrz.length > 0 && <span> · ... km</span>}
                  {kurs.max_palet != null && <> · 📦 {usedPal}/{kurs.max_palet} pal</>}
                </p>
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
                        <TableHead className="text-right">Kg</TableHead>
                        <TableHead className="text-right">m³</TableHead>
                        <TableHead className="text-right">Pal.</TableHead>
                        <TableHead>Tel / Kontakt</TableHead>
                        <TableHead>Uwagi</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kPrz.map((p, pIdx) => {
                        // Pokaż # i akcje tylko dla pierwszego WZ w grupie (ten sam kolejnosc)
                        const isFirst = pIdx === 0 || kPrz[pIdx - 1].kolejnosc !== p.kolejnosc;
                        const groupSize = kPrz.filter(x => x.kolejnosc === p.kolejnosc).length;
                        return (
                        <TableRow key={p.id}>
                          {isFirst ? (
                            <TableCell rowSpan={groupSize} className="align-top font-medium">{p.kolejnosc}</TableCell>
                          ) : null}
                          <TableCell className="text-xs">{p.preferowana_godzina || '—'}</TableCell>
                          <TableCell className="text-xs max-w-[140px] truncate">{p.odbiorca}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[180px]">{p.numer_wz || p.zl_numer}</TableCell>
                          <TableCell className="text-xs max-w-[140px] truncate">{p.adres}</TableCell>
                          <TableCell className="text-right">{Math.round(p.masa_kg)}</TableCell>
                          <TableCell className="text-right">{p.objetosc_m3 ? Math.round(p.objetosc_m3 * 10) / 10 : '—'}</TableCell>
                          <TableCell className="text-right">{p.ilosc_palet || '—'}</TableCell>
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
                        </TableRow>
                        );
                      })}
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
        onDone={refetch}
      />

      <PolaczKursyModal
        open={!!mergeKurs}
        onClose={() => setMergeKurs(null)}
        sourceKurs={mergeKurs}
        allKursy={kursy.filter(k => k.status !== 'usuniety')}
        allPrzystanki={przystanki}
        onDone={refetch}
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
          await supabase.from('zlecenia').update({ status: 'robocza', kurs_id: null } as any).eq('id', odpinZl.zlId);
          setOdpinStep(0);
          setOdpinZl(null);
          refetch();
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
              await supabase.from('zlecenia').update({ status: 'robocza', kurs_id: null } as any).in('id', zlIds);
            }
          }
          await supabase.from('kursy').update({ status: 'usuniety' } as any).eq('id', deleteKursId);
          setDeleteKursId(null);
          refetch();
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

  // Pre-select zlecenia when modal opens
  useEffect(() => {
    if (open && preSelectedZlecenieIds && preSelectedZlecenieIds.length > 0) {
      setSelectedZl(new Set(preSelectedZlecenieIds));
    } else if (!open) {
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
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
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
                    <span className="font-mono text-xs">{z.numer}</span>
                    <span className="text-xs text-muted-foreground">{z.dzien}</span>
                    <span className="text-xs ml-auto">{Math.round(z.suma_kg)} kg · {z.suma_m3} m³ · {z.suma_palet} pal</span>
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
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0, bez_palet: false, luzne_karton: false, uwagi: '',
  }]);
  const { oddzialy, loading: loadingOddzialy } = useOddzialy();
  const { flota: flotaList, loading: loadingFlota } = useFlotaOddzialu(oddzialId);
  const { create, submitting, error } = useCreateZlecenie(onSuccess);

  const handleGoToCheck = () => {
    const invalid = wzList.find(w => {
      if (!w.odbiorca || !w.masa_kg) return true;
      if (!w.luzne_karton && (!w.objetosc_m3 || w.objetosc_m3 <= 0)) return true;
      if (!w.bez_palet && (!w.ilosc_palet || w.ilosc_palet <= 0)) return true;
      return false;
    });
    if (invalid) {
      const missing: string[] = [];
      if (!invalid.odbiorca) missing.push('odbiorca');
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
          <WzFormTabs wzList={wzList} setWzList={setWzList} error={error} submitting={submitting} onBack={() => setStep(2)} onSubmit={handleGoToCheck} />
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
  const [showModal, setShowModal] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [preSelectedZlIds, setPreSelectedZlIds] = useState<string[]>([]);
  const { flota, refetch: refetchFlota } = useFlotaOddzialu(oddzialId);
  const { kursy, refetch } = useKursyDnia(oddzialId, dzien, rangeMode ? dzienDo : undefined);
  const { zlecenia: zlBezKursu } = useZleceniaBezKursu(oddzialId);
  const { isBlocked } = useBlokady(oddzialId, [dzien]);
  const { kierowcy } = useKierowcyOddzialu(oddzialId);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <div className="flex flex-1">
        <PageSidebar
          items={SIDEBAR_ITEMS.map(s => s.id === 'kursy' ? { ...s, badge: kursy.filter(k => k.status !== 'usuniety').length } : s)}
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
                <Button onClick={() => setShowModal(true)} disabled={!oddzialId}>
                  + Nowy kurs
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
                />
              )}
              {activeId === 'zlecenia' && (
                <ZleceniaTab
                  oddzialId={oddzialId}
                  oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || ''}
                  dzien={dzien}
                  onOpenKursModal={(zlIds) => { setPreSelectedZlIds(zlIds); setShowModal(true); }}
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
            onCreated={refetch}
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
            onImported={refetch}
          />
        </main>
      </div>
    </div>
  );
}
