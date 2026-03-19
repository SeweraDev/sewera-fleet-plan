import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
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
import { useBlokady } from '@/hooks/useBlokady';
import type { KursDto, PrzystanekDto } from '@/hooks/useKursyDnia';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';
import type { Kierowca } from '@/hooks/useKierowcyOddzialu';

const SIDEBAR_ITEMS = [
  { id: 'kursy', label: '🚛 Kursy' },
  { id: 'zlecenia', label: '📋 Zlecenia' },
  { id: 'flota', label: '🔧 Flota' },
];

function capacityColor(pct: number) {
  if (pct <= 40) return 'bg-green-500';
  if (pct <= 70) return 'bg-yellow-500';
  if (pct <= 95) return 'bg-orange-500';
  return 'bg-red-500';
}

function CapacityBar({ used, total, unit }: { used: number; total: number; unit: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${capacityColor(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">{Math.round(used)} / {Math.round(total)} {unit}</p>
    </div>
  );
}

type StatusFilter = 'all' | 'zaplanowany' | 'aktywny' | 'zakonczony';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'zaplanowany', label: 'Zaplanowane' },
  { key: 'aktywny', label: 'W trasie' },
  { key: 'zakonczony', label: 'Zakończone' },
];

function KursyTab({ oddzialId, dzien, dzienDo, zlBezKursuCount, doWeryfikacjiCount, onOpenModal, flota, kierowcy, isBlocked }: { oddzialId: number | null; dzien: string; dzienDo?: string; zlBezKursuCount: number; doWeryfikacjiCount: number; onOpenModal: () => void; flota: Pojazd[]; kierowcy: Kierowca[]; isBlocked?: (typ: string, zasobId: string, dzien: string) => boolean }) {
  const { kursy, przystanki, loading, refetch } = useKursyDnia(oddzialId, dzien, dzienDo);
  const { handleStart, handleStop, handlePrzystanek, acting } = useKursActions(refetch);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editZlId, setEditZlId] = useState<string | null>(null);
  const [editKurs, setEditKurs] = useState<KursDto | null>(null);
  const [przepnijPrz, setPrzepnijPrz] = useState<PrzystanekDto | null>(null);
  const [przepnijKurs, setPrzepnijKurs] = useState<KursDto | null>(null);

  const filtered = statusFilter === 'all' ? kursy : kursy.filter(k => k.status === statusFilter);
  const counts = {
    all: kursy.length,
    zaplanowany: kursy.filter(k => k.status === 'zaplanowany').length,
    aktywny: kursy.filter(k => k.status === 'aktywny').length,
    zakonczony: kursy.filter(k => k.status === 'zakonczony').length,
  };

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

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
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
      </div>

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
                    <Badge variant="outline" className="font-mono">{kurs.nr_rej || 'Brak pojazdu'}</Badge>
                    {kurs.pojazd_typ && <span className="text-muted-foreground text-xs">· {kurs.pojazd_typ}</span>}
                    <StatusBadge status={kurs.status} />
                  </CardTitle>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditKurs(kurs)}>⚙️ Edytuj</Button>
                    {kurs.status === 'zaplanowany' && (
                      <Button size="sm" onClick={() => handleStart(kurs.id)} disabled={acting}>▶ Wyjazd</Button>
                    )}
                    {kurs.status === 'aktywny' && (
                      <Button size="sm" variant="secondary" onClick={() => handleStop(kurs.id)} disabled={acting}>⏹ Powrót</Button>
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
                  Rozładunki: {done}/{kPrz.length} · ⚖️ {Math.round(usedKg)}/{Math.round(kurs.ladownosc_kg)} kg
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
                        <TableHead>Zlecenie</TableHead>
                        <TableHead>Odbiorca</TableHead>
                        <TableHead>Adres</TableHead>
                        <TableHead className="text-right">Kg</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kPrz.map(p => (
                        <TableRow key={p.id}>
                          <TableCell>{p.kolejnosc}</TableCell>
                          <TableCell className="font-mono text-xs">{p.zl_numer}</TableCell>
                          <TableCell>{p.odbiorca}</TableCell>
                          <TableCell className="text-xs">{p.adres}</TableCell>
                          <TableCell className="text-right">{Math.round(p.masa_kg)}</TableCell>
                          <TableCell><StatusBadge status={p.prz_status} /></TableCell>
                          <TableCell className="flex gap-1">
                            {p.prz_status === 'oczekuje' && kurs.status === 'aktywny' && (
                              <Button size="sm" variant="outline" onClick={() => handlePrzystanek(p.id)} disabled={acting}>
                                ✓ Dostarcz
                              </Button>
                            )}
                            {p.zlecenie_id && (
                              <Button size="sm" variant="ghost" onClick={() => setEditZlId(p.zlecenie_id)}>
                                ✏️
                              </Button>
                            )}
                            {p.zlecenie_id && (
                              <Button size="sm" variant="ghost" onClick={() => { setPrzepnijPrz(p); setPrzepnijKurs(kurs); }}>
                                🔀
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
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
        allKursy={kursy}
        allPrzystanki={przystanki}
        oddzialId={oddzialId}
        dzien={dzien}
        flota={flota}
        kierowcy={kierowcy}
        onDone={refetch}
      />
    </div>
  );
}

function NowyKursModal({ 
  open, onClose, oddzialId, dzien, onCreated, preSelectedZlecenieId, isBlocked 
}: { 
  open: boolean; onClose: () => void; oddzialId: number | null; dzien: string; onCreated: () => void; preSelectedZlecenieId?: string | null; isBlocked?: (typ: string, zasobId: string, dzien: string) => boolean;
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

  // Pre-select zlecenie when modal opens with a specific one
  useEffect(() => {
    if (open && preSelectedZlecenieId) {
      setSelectedZl(new Set([preSelectedZlecenieId]));
    } else if (!open) {
      setSelectedZl(new Set());
      setKierowcaId('');
      setFlotaId('');
    }
  }, [open, preSelectedZlecenieId]);

  const toggleZl = (id: string) => {
    const s = new Set(selectedZl);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedZl(s);
  };

  const handleCreate = () => {
    if (!oddzialId) return;
    create({
      oddzial_id: oddzialId,
      dzien,
      kierowca_id: kierowcaId || null,
      flota_id: flotaId || null,
      nr_rej_zewn: null,
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
                    <span className="text-xs ml-auto">{Math.round(z.suma_kg)} kg</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button onClick={handleCreate} disabled={submitting || selectedZl.size === 0}>
            {submitting ? 'Tworzenie...' : `Utwórz kurs (${selectedZl.size} zleceń)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [preSelectedZlId, setPreSelectedZlId] = useState<string | null>(null);
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
          items={SIDEBAR_ITEMS.map(s => s.id === 'kursy' ? { ...s, badge: kursy.length } : s)}
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
              <Button className="ml-auto mt-4" onClick={() => setShowModal(true)} disabled={!oddzialId}>
                + Nowy kurs
              </Button>
            )}
          </div>

          {!oddzialId ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Wybierz oddział aby wyświetlić dane</CardContent></Card>
          ) : (
            <>
              {activeId === 'kursy' && (
                <KursyTab
                  oddzialId={oddzialId}
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
                  onOpenKursModal={(zlId) => { setPreSelectedZlId(zlId); setShowModal(true); }}
                />
              )}
              {activeId === 'flota' && (
                <FlotaSection oddzialId={oddzialId} flota={flota} oddzialy={oddzialy} onFlotaRefresh={refetchFlota} />
              )}
            </>
          )}

          <NowyKursModal
            open={showModal}
            onClose={() => { setShowModal(false); setPreSelectedZlId(null); }}
            oddzialId={oddzialId}
            dzien={dzien}
            onCreated={refetch}
            preSelectedZlecenieId={preSelectedZlId}
            isBlocked={isBlocked}
          />
        </main>
      </div>
    </div>
  );
}
