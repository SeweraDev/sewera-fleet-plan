import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EdytujZlecenieModal } from '@/components/dyspozytor/EdytujZlecenieModal';
import { useZleceniaOddzialu, useZlecenieWz } from '@/hooks/useZleceniaOddzialu';
import { useFlotaOddzialu } from '@/hooks/useFlotaOddzialu';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CalendarIcon } from 'lucide-react';
import type { ZlecenieOddzialuDto } from '@/hooks/useZleceniaOddzialu';
import { NAZWA_TO_KOD, ODDZIAL_COORDS } from '@/lib/oddzialy-geo';
import { TYP_CAPACITY } from '@/lib/suggestRoutes';
import { SuggestionPanel } from '@/components/dyspozytor/SuggestionPanel';

import { lazy, Suspense } from 'react';
const ZleceniaMapView = lazy(() => import('@/components/dyspozytor/ZleceniaMapView'));

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

function CapacityBar({ used, total, unit, label }: { used: number; total: number; unit: string; label?: string }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const displayPct = Math.min(pct, 100);
  return (
    <div className="flex-1 min-w-0">
      {label && <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>}
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${capacityColor(pct)}`} style={{ width: `${displayPct}%` }} />
      </div>
      <p className={`text-[10px] font-medium mt-0.5 ${capacityTextColor(pct)}`}>
        {Math.round(used)} / {Math.round(total)} {unit} ({Math.round(pct)}%)
      </p>
    </div>
  );
}

type ZlStatusFilter = 'bez_kursu' | 'all' | 'anulowana';

const ZL_STATUS_FILTERS: { key: ZlStatusFilter; label: string }[] = [
  { key: 'bez_kursu', label: 'Bez kursu' },
  { key: 'all', label: 'Wszystkie' },
  { key: 'anulowana', label: 'Anulowane' },
];

function ZlSzczegolyDialog({
  zlecenie,
  open,
  onClose,
  onEdit,
  onAssignToKurs,
  onDelete,
}: {
  zlecenie: ZlecenieOddzialuDto | null;
  open: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  onAssignToKurs: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { wz, loading } = useZlecenieWz(open && zlecenie ? zlecenie.id : null);

  if (!zlecenie) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Zlecenie {zlecenie.numer}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={zlecenie.status} />
            <span>Dzień: {zlecenie.dzien}</span>
            {zlecenie.preferowana_godzina && <span>Godzina: {zlecenie.preferowana_godzina}</span>}
            {zlecenie.typ_pojazdu && <span>Typ: {zlecenie.typ_pojazdu}</span>}
          </div>
          <p className="text-muted-foreground">
            Kurs: {zlecenie.kurs_numer || zlecenie.kurs_nrrej
              ? <Badge variant="outline" className="font-mono">{zlecenie.kurs_numer || ''}{zlecenie.kurs_nrrej ? (zlecenie.kurs_numer ? ' · ' : '') + zlecenie.kurs_nrrej : ''}</Badge>
              : <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">bez kursu ⚠️</Badge>
            }
          </p>
        </div>

        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground mb-2">Dokumenty WZ ({wz.length})</p>
          {loading ? (
            <p className="text-muted-foreground text-center py-4">Ładowanie...</p>
          ) : wz.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 text-sm">Brak dokumentów WZ</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nr dokumentu</TableHead>
                  <TableHead>Odbiorca</TableHead>
                  <TableHead>Adres</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">m³</TableHead>
                  <TableHead className="text-right">Palety</TableHead>
                  <TableHead>Uwagi</TableHead>
                  <TableHead>Nr zamówienia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wz.map(w => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{w.numer_wz || '—'}</TableCell>
                    <TableCell className="max-w-[200px]">{w.odbiorca || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[200px]">{w.adres || '—'}</TableCell>
                    <TableCell className="text-right">{Math.round(w.masa_kg)}</TableCell>
                    <TableCell className="text-right">{w.objetosc_m3 > 0 ? w.objetosc_m3.toFixed(1) : '—'}</TableCell>
                    <TableCell className="text-right">{w.ilosc_palet || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[180px] truncate">{w.uwagi || '—'}</TableCell>
                    <TableCell className="text-xs font-mono">{w.nr_zamowienia || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Paski zajętości pojazdu */}
          {zlecenie.typ_pojazdu && TYP_CAPACITY[zlecenie.typ_pojazdu] && wz.length > 0 && (() => {
            const cap = TYP_CAPACITY[zlecenie.typ_pojazdu!];
            const totalKg = wz.reduce((s, w) => s + w.masa_kg, 0);
            const totalM3 = wz.reduce((s, w) => s + w.objetosc_m3, 0);
            const totalPal = wz.reduce((s, w) => s + (w.ilosc_palet || 0), 0);
            return (
              <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                <p className="text-xs font-medium text-muted-foreground mb-2">Zajętość pojazdu ({zlecenie.typ_pojazdu})</p>
                <div className="flex gap-4">
                  <CapacityBar used={totalKg} total={cap.kg} unit="kg" label="Waga" />
                  {cap.m3 > 0 && <CapacityBar used={totalM3} total={cap.m3} unit="m³" label="Objętość" />}
                  {cap.pal > 0 && <CapacityBar used={totalPal} total={cap.pal} unit="pal" label="Palety" />}
                </div>
              </div>
            );
          })()}
        </div>

        <DialogFooter className="gap-2">
          {zlecenie.status === 'robocza' && !zlecenie.kurs_numer && !zlecenie.kurs_nrrej && (
            <Button variant="outline" onClick={() => { onClose(); onAssignToKurs(zlecenie.id); }}>
              Przypisz do kursu
            </Button>
          )}
          {['robocza', 'do_weryfikacji', 'potwierdzona'].includes(zlecenie.status) && (
            <Button variant="outline" onClick={() => { onClose(); onEdit(zlecenie.id); }}>
              Edytuj zlecenie
            </Button>
          )}
          {(zlecenie.status === 'robocza' || zlecenie.status === 'do_weryfikacji' || zlecenie.status === 'potwierdzona') && (
            <Button variant="destructive" onClick={() => onDelete(zlecenie.id)}>
              Usuń zlecenie
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Zamknij</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeadlineExtendPicker({ zlecenie, onDone }: { zlecenie: ZlecenieOddzialuDto; onDone: () => void }) {
  const [date, setDate] = useState<Date>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleExtend = async () => {
    if (!date) return;
    setSaving(true);
    const newDeadline = new Date(date);
    newDeadline.setHours(16, 0, 0, 0);
    await supabase
      .from('zlecenia')
      .update({ deadline_wz: newDeadline.toISOString(), flaga_brak_wz: false } as any)
      .eq('id', zlecenie.id);
    toast.success('✅ Termin przedłużony');
    setSaving(false);
    setOpen(false);
    onDone();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="text-xs">
          ✅ Przedłuż termin
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          className={cn("p-3 pointer-events-auto")}
        />
        {date && (
          <div className="p-2 border-t flex justify-end">
            <Button size="sm" onClick={handleExtend} disabled={saving}>
              {saving ? 'Zapisywanie...' : `Przedłuż do ${format(date, 'dd.MM')}`}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ZleceniaTab({
  oddzialId,
  oddzialNazwa,
  dzien,
  pastOnly = false,
  onOpenKursModal,
}: {
  oddzialId: number;
  oddzialNazwa?: string;
  dzien?: string;
  pastOnly?: boolean;
  onOpenKursModal?: (zlecenieIds: string[]) => void;
}) {
  const { zlecenia, loading, refetch } = useZleceniaOddzialu(oddzialId, pastOnly, dzien);
  const { flota } = useFlotaOddzialu(oddzialId);
  const availableTypes = useMemo(() => [...new Set(flota.map(f => f.typ))], [flota]);
  const [statusFilter, setStatusFilter] = useState<ZlStatusFilter>('bez_kursu');
  const [selectedZl, setSelectedZl] = useState<ZlecenieOddzialuDto | null>(null);
  const [editZlId, setEditZlId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'dzien' | 'status' | 'godzina' | 'kg' | 'numer' | 'km'>('dzien');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showMap, setShowMap] = useState(false);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortBy(col); setSortDir('asc'); }
  };

  const STATUS_ORDER: Record<string, number> = { robocza: 0, do_weryfikacji: 1, potwierdzona: 2, w_trasie: 3, dostarczona: 4, anulowana: 5 };

  const filteredBase = statusFilter === 'bez_kursu' ? zlecenia.filter(z => !z.kurs_numer && !z.kurs_nrrej && z.status !== 'anulowana')
    : statusFilter === 'all' ? zlecenia.filter(z => z.status !== 'anulowana')
    : zlecenia.filter(z => z.status === statusFilter);
  const filtered = [...filteredBase].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'dzien') cmp = a.dzien.localeCompare(b.dzien);
    else if (sortBy === 'status') cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    else if (sortBy === 'godzina') cmp = (a.preferowana_godzina || '').localeCompare(b.preferowana_godzina || '');
    else if (sortBy === 'kg') cmp = a.suma_kg - b.suma_kg;
    else if (sortBy === 'km') cmp = (a.dystans_km ?? 9999) - (b.dystans_km ?? 9999);
    else if (sortBy === 'numer') cmp = a.numer.localeCompare(b.numer);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const counts: Record<ZlStatusFilter, number> = {
    bez_kursu: zlecenia.filter(z => !z.kurs_numer && !z.kurs_nrrej && z.status !== 'anulowana').length,
    all: zlecenia.filter(z => z.status !== 'anulowana').length,
    anulowana: zlecenia.filter(z => z.status === 'anulowana').length,
  };

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const toggleChecked = (id: string) => {
    const s = new Set(checkedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setCheckedIds(s);
  };

  const toggleAll = () => {
    if (checkedIds.size === filtered.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(filtered.map(z => z.id)));
    }
  };

  const checkedZlecenia = filtered.filter(z => checkedIds.has(z.id));
  const checkedKg = checkedZlecenia.reduce((s, z) => s + z.suma_kg, 0);
  const checkedM3 = checkedZlecenia.reduce((s, z) => s + z.suma_m3, 0);
  const checkedPal = checkedZlecenia.reduce((s, z) => s + z.suma_palet, 0);

  const [deleteZlId, setDeleteZlId] = useState<string | null>(null);
  const deleteZlNumer = zlecenia.find(z => z.id === deleteZlId)?.numer || '';

  const handleDelete = (id: string) => {
    setDeleteZlId(id);
  };

  const confirmDelete = async () => {
    if (!deleteZlId) return;
    await supabase.from('zlecenia').update({ status: 'anulowana' } as any).eq('id', deleteZlId);
    toast.success('Zlecenie usunięte');
    setDeleteZlId(null);
    refetch();
  };

  const handleAnuluj = async (zl: ZlecenieOddzialuDto) => {
    await supabase
      .from('zlecenia')
      .update({ status: 'anulowana' } as any)
      .eq('id', zl.id);

    // Notify sender
    if (zl.deadline_wz) {
      const deadlineStr = new Date(zl.deadline_wz).toLocaleDateString('pl-PL');
      await supabase.from('powiadomienia').insert({
        user_id: (zl as any).nadawca_id || '',
        typ: 'zlecenie_anulowane',
        tresc: `Zlecenie ${zl.numer} zostało anulowane — brak dokumentów WZ przed terminem ${deadlineStr}`,
        zlecenie_id: zl.id,
        przeczytane: false,
      } as any);
    }

    toast.success('❌ Zlecenie anulowane');
    refetch();
  };

  // Podsumowanie ładunku (tylko zlecenia bez kursu, aktywne)
  const bezKursu = zlecenia.filter(z => !z.kurs_numer && !z.kurs_nrrej && z.status !== 'anulowana');
  const sumaKg = bezKursu.reduce((s, z) => s + z.suma_kg, 0);
  const sumaM3 = bezKursu.reduce((s, z) => s + z.suma_m3, 0);
  const sumaPal = bezKursu.reduce((s, z) => s + z.suma_palet, 0);

  if (loading) return <p className="text-muted-foreground text-center py-8">Ładowanie zleceń...</p>;

  return (
    <div className="space-y-4">
      {/* Baner podsumowania */}
      {bezKursu.length > 0 && (
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-4 py-3">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="font-semibold text-blue-700 dark:text-blue-300">
              📦 Do zaplanowania: {bezKursu.length} zleceń
            </span>
            <span className="text-blue-600 dark:text-blue-400">
              ⚖️ {Math.round(sumaKg).toLocaleString('pl-PL')} kg
            </span>
            {sumaM3 > 0 && (
              <span className="text-blue-600 dark:text-blue-400">
                📐 {Math.round(sumaM3 * 10) / 10} m³
              </span>
            )}
            <span className="text-blue-600 dark:text-blue-400">
              🧱 {Math.round(sumaPal)} pal
            </span>
          </div>
        </div>
      )}

      {/* Podpowiedzi dyspozytora */}
      {statusFilter === 'bez_kursu' && (
        <SuggestionPanel orders={bezKursu} availableTypes={availableTypes} />
      )}

      {/* Mapa dostaw */}
      {showMap && (
        <Suspense fallback={<div className="rounded-lg border bg-muted/50 p-6 text-center text-sm">Ładowanie mapy...</div>}>
          <ZleceniaMapView
            zlecenia={bezKursu}
            oddzialCoords={oddzialNazwa ? (ODDZIAL_COORDS[NAZWA_TO_KOD[oddzialNazwa] || ''] || null) : null}
            oddzialNazwa={oddzialNazwa || ''}
          />
        </Suspense>
      )}

      <div className="flex gap-2 flex-wrap">
        {ZL_STATUS_FILTERS.map(f => (
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
          onClick={() => setShowMap(v => !v)}
          className={`ml-auto px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            showMap
              ? 'bg-blue-600 text-white'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          🗺️ Mapa
        </button>
      </div>

      {/* Action bar dla zaznaczonych */}
      {checkedIds.size > 0 && statusFilter === 'bez_kursu' && (
        <div className="flex items-center gap-4 rounded-lg bg-primary/10 border border-primary/30 px-4 py-3">
          <span className="text-sm font-semibold">
            Zaznaczono {checkedIds.size} {checkedIds.size === 1 ? 'zlecenie' : checkedIds.size < 5 ? 'zlecenia' : 'zleceń'}
          </span>
          <span className="text-sm text-muted-foreground">
            ⚖️ {Math.round(checkedKg).toLocaleString('pl-PL')} kg
            {checkedM3 > 0 && ` · ${Math.round(checkedM3 * 10) / 10} m³`}
            {checkedPal > 0 && ` · ${checkedPal} pal`}
          </span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              onOpenKursModal?.(Array.from(checkedIds));
              setCheckedIds(new Set());
            }}
          >
            Przypisz do kursu →
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCheckedIds(new Set())}>
            Odznacz
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Brak zleceń</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {statusFilter === 'bez_kursu' && (
                    <TableHead className="w-10" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={checkedIds.size === filtered.length && filtered.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                  )}
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('dzien')}>
                    Dzień {sortBy === 'dzien' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('godzina')}>
                    Godzina {sortBy === 'godzina' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('status')}>
                    Status {sortBy === 'status' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('numer')}>
                    Numer {sortBy === 'numer' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </TableHead>
                  <TableHead>Odbiorca</TableHead>
                  <TableHead>Adres</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort('kg')}>
                    Kg {sortBy === 'kg' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </TableHead>
                  <TableHead className="text-right">m³</TableHead>
                  <TableHead className="text-right">Pal.</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort('km')}>
                    km {sortBy === 'km' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Kurs</TableHead>
                  <TableHead>WZ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(z => (
                  <TableRow
                    key={z.id}
                    className={`cursor-pointer hover:bg-muted/50 ${z.flaga_brak_wz ? 'bg-red-50 dark:bg-red-950/20' : ''}`}
                    onClick={() => setSelectedZl(z)}
                  >
                    {statusFilter === 'bez_kursu' && (
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={checkedIds.has(z.id)}
                          onCheckedChange={() => toggleChecked(z.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell>{z.dzien}</TableCell>
                    <TableCell>{z.preferowana_godzina || '—'}</TableCell>
                    <TableCell><StatusBadge status={z.status} /></TableCell>
                    <TableCell className="font-mono text-xs">{z.numer}</TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate">{z.odbiorca || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate">{z.adres || '—'}</TableCell>
                    <TableCell className="text-right">{Math.round(z.suma_kg)}</TableCell>
                    <TableCell className="text-right">{z.suma_m3 ? Math.round(z.suma_m3 * 10) / 10 : '—'}</TableCell>
                    <TableCell className="text-right">{z.suma_palet || '—'}</TableCell>
                    <TableCell className="text-right text-xs">{z.dystans_km != null ? z.dystans_km : '...'}</TableCell>
                    <TableCell className="text-xs">{z.typ_pojazdu || '—'}</TableCell>
                    <TableCell>
                      {z.kurs_numer || z.kurs_nrrej
                        ? <Badge variant="outline" className="font-mono text-xs">{z.kurs_numer || ''}{z.kurs_nrrej ? (z.kurs_numer ? ' · ' : '') + z.kurs_nrrej : ''}</Badge>
                        : <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs">bez kursu ⚠️</Badge>
                      }
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      {z.flaga_brak_wz ? (
                        <div className="flex items-center gap-1">
                          <Badge variant="destructive" className="text-[10px] whitespace-nowrap">⏰ Deadline WZ</Badge>
                          <Button size="sm" variant="ghost" className="text-xs h-6 px-1" onClick={() => handleAnuluj(z)}>❌</Button>
                          <DeadlineExtendPicker zlecenie={z} onDone={refetch} />
                        </div>
                      ) : z.ma_wz ? (
                        <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">✓ WZ</Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ZlSzczegolyDialog
        zlecenie={selectedZl}
        open={!!selectedZl}
        onClose={() => setSelectedZl(null)}
        onEdit={(id) => setEditZlId(id)}
        onAssignToKurs={(id) => onOpenKursModal?.([id])}
        onDelete={handleDelete}
      />

      <EdytujZlecenieModal
        zlecenieId={editZlId}
        open={!!editZlId}
        onClose={() => setEditZlId(null)}
        onSaved={refetch}
      />

      <ConfirmDialog
        open={!!deleteZlId}
        onOpenChange={(open) => { if (!open) setDeleteZlId(null); }}
        title="Usunąć zlecenie?"
        description={`Czy na pewno chcesz usunąć zlecenie ${deleteZlNumer}? Zlecenie zostanie przeniesione do zakładki Anulowane.`}
        confirmLabel="Usuń zlecenie"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
