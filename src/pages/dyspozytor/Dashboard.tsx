import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
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
import { useCreateZlecenie, type WzInput } from '@/hooks/useCreateZlecenie';
import { TypPojazduStep } from '@/components/sprzedawca/TypPojazduStep';
import { CzasDostawyStep } from '@/components/sprzedawca/CzasDostawyStep';
import { WzFormTabs } from '@/components/sprzedawca/WzFormTabs';
import { DostepnoscStep } from '@/components/sprzedawca/DostepnoscStep';
import { ModalImportWZ, type WZImportData } from '@/components/shared/ModalImportWZ';
import type { KursDto, PrzystanekDto } from '@/hooks/useKursyDnia';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';
import type { Kierowca } from '@/hooks/useKierowcyOddzialu';

const SIDEBAR_ITEMS = [
  { id: 'kursy', label: '🚛 Kursy' },
  { id: 'zlecenia', label: '📋 Zlecenia' },
  { id: 'nowe_zlecenie', label: '➕ Nowe zlecenie' },
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('zaplanowany');
  const [editZlId, setEditZlId] = useState<string | null>(null);
  const [editKurs, setEditKurs] = useState<KursDto | null>(null);
  const [przepnijPrz, setPrzepnijPrz] = useState<PrzystanekDto | null>(null);
  const [przepnijKurs, setPrzepnijKurs] = useState<KursDto | null>(null);

  const filteredBase = statusFilter === 'all' ? kursy : kursy.filter(k => k.status === statusFilter);
  // Sortuj kursy: nr_rej → typ → godzina_start
  const filtered = [...filteredBase].sort((a, b) => {
    const nrCmp = (a.nr_rej || '').localeCompare(b.nr_rej || '');
    if (nrCmp !== 0) return nrCmp;
    const typCmp = (a.pojazd_typ || '').localeCompare(b.pojazd_typ || '');
    if (typCmp !== 0) return typCmp;
    return (a.godzina_start || '').localeCompare(b.godzina_start || '');
  });
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
                    <Button size="sm" variant="ghost" onClick={() => setEditKurs(kurs)}>Edytuj</Button>
                    {kurs.status === 'zaplanowany' && kPrz.length === 0 && (
                      <Button size="sm" variant="destructive" onClick={async () => {
                        if (!confirm('Usunąć pusty kurs?')) return;
                        await supabase.from('kursy').update({ status: 'zakonczony' } as any).eq('id', kurs.id);
                        refetch();
                        toast.success('Kurs usunięty');
                      }}>Usuń</Button>
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
                          {isFirst ? (
                            <TableCell rowSpan={groupSize} className="align-top text-xs">{p.preferowana_godzina || '—'}</TableCell>
                          ) : null}
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
  const [showImport, setShowImport] = useState(false);

  const { oddzialy, loading: loadingOddzialy } = useOddzialy();
  const { flota: flotaList, loading: loadingFlota } = useFlotaOddzialu(oddzialId);
  const { create, submitting, error } = useCreateZlecenie(onSuccess);

  const handleImport = useCallback((data: WZImportData[]) => {
    const newWzList: WzInput[] = data.map(d => ({
      numer_wz: d.numer_wz || '', nr_zamowienia: d.nr_zamowienia || '', odbiorca: d.odbiorca || '',
      adres: d.adres || '', tel: d.tel || '', masa_kg: d.masa_kg || 0, objetosc_m3: d.objetosc_m3 || 0,
      ilosc_palet: d.ilosc_palet || 0, bez_palet: false, luzne_karton: false, uwagi: d.uwagi || '',
    }));
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList(newWzList);
    } else {
      setWzList([...wzList, ...newWzList]);
    }
  }, [wzList]);

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
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Pozycje WZ ({wzList.length})</h3>
              <Button size="sm" onClick={() => setShowImport(true)}>Importuj WZ</Button>
            </div>
            <WzFormTabs wzList={wzList} setWzList={setWzList} error={error} submitting={submitting} onBack={() => setStep(2)} onSubmit={handleGoToCheck} />
            <ModalImportWZ isOpen={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
          </div>
        )}
        {step === 4 && oddzialId && (
          <DostepnoscStep oddzialId={oddzialId} typPojazdu={typPojazdu} dzien={dzien} wzList={wzList}
            onBack={() => setStep(3)} onSubmit={handleSubmit} submitting={submitting} />
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
              {activeId === 'nowe_zlecenie' && (
                <NoweZlecenieFormDyspozytor onSuccess={() => setActiveId('zlecenia')} />
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
