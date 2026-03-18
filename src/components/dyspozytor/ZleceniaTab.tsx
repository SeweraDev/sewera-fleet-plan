import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EdytujZlecenieModal } from '@/components/dyspozytor/EdytujZlecenieModal';
import { useZleceniaOddzialu, useZlecenieWz } from '@/hooks/useZleceniaOddzialu';
import type { ZlecenieOddzialuDto } from '@/hooks/useZleceniaOddzialu';

type ZlStatusFilter = 'all' | 'robocza' | 'potwierdzona' | 'w_trasie' | 'dostarczona' | 'anulowana';

const ZL_STATUS_FILTERS: { key: ZlStatusFilter; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'robocza', label: 'Robocze' },
  { key: 'potwierdzona', label: 'Potwierdzone' },
  { key: 'w_trasie', label: 'W trasie' },
  { key: 'dostarczona', label: 'Dostarczone' },
  { key: 'anulowana', label: 'Anulowane' },
];

function ZlSzczegolyDialog({
  zlecenie,
  open,
  onClose,
  onEdit,
  onAssignToKurs,
}: {
  zlecenie: ZlecenieOddzialuDto | null;
  open: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  onAssignToKurs: (id: string) => void;
}) {
  const { wz, loading } = useZlecenieWz(open && zlecenie ? zlecenie.id : null);

  if (!zlecenie) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
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
            Kurs: {zlecenie.kurs_numer
              ? <Badge variant="outline" className="font-mono">{zlecenie.kurs_numer}{zlecenie.kurs_nrrej ? ` · ${zlecenie.kurs_nrrej}` : ''}</Badge>
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
                  <TableHead>Nr WZ</TableHead>
                  <TableHead>Odbiorca</TableHead>
                  <TableHead>Adres</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">m³</TableHead>
                  <TableHead className="text-right">Palety</TableHead>
                  <TableHead>Nr zamówienia</TableHead>
                  <TableHead>Uwagi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wz.map(w => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs">{w.numer_wz || '—'}</TableCell>
                    <TableCell>{w.odbiorca || '—'}</TableCell>
                    <TableCell className="text-xs">{w.adres || '—'}</TableCell>
                    <TableCell className="text-right">{Math.round(w.masa_kg)}</TableCell>
                    <TableCell className="text-right">{w.objetosc_m3.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{w.ilosc_palet}</TableCell>
                    <TableCell className="text-xs">{w.nr_zamowienia || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{w.uwagi || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="gap-2">
          {zlecenie.status === 'robocza' && !zlecenie.kurs_numer && (
            <Button variant="outline" onClick={() => { onClose(); onAssignToKurs(zlecenie.id); }}>
              ➕ Przypisz do kursu
            </Button>
          )}
          <Button variant="outline" onClick={() => { onClose(); onEdit(zlecenie.id); }}>
            ✏️ Edytuj zlecenie
          </Button>
          <Button variant="secondary" onClick={onClose}>Zamknij</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ZleceniaTab({
  oddzialId,
  pastOnly = false,
  onOpenKursModal,
}: {
  oddzialId: number;
  pastOnly?: boolean;
  onOpenKursModal?: (zlecenieId: string) => void;
}) {
  const { zlecenia, loading, refetch } = useZleceniaOddzialu(oddzialId, pastOnly);
  const [statusFilter, setStatusFilter] = useState<ZlStatusFilter>('all');
  const [selectedZl, setSelectedZl] = useState<ZlecenieOddzialuDto | null>(null);
  const [editZlId, setEditZlId] = useState<string | null>(null);

  const filtered = statusFilter === 'all' ? zlecenia : zlecenia.filter(z => z.status === statusFilter);

  const counts: Record<ZlStatusFilter, number> = {
    all: zlecenia.length,
    robocza: zlecenia.filter(z => z.status === 'robocza').length,
    potwierdzona: zlecenia.filter(z => z.status === 'potwierdzona').length,
    w_trasie: zlecenia.filter(z => z.status === 'w_trasie').length,
    dostarczona: zlecenia.filter(z => z.status === 'dostarczona').length,
    anulowana: zlecenia.filter(z => z.status === 'anulowana').length,
  };

  if (loading) return <p className="text-muted-foreground text-center py-8">Ładowanie zleceń...</p>;

  return (
    <div className="space-y-4">
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
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Brak zleceń</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dzień</TableHead>
                  <TableHead>Godzina</TableHead>
                  <TableHead>Typ pojazdu</TableHead>
                  <TableHead>Nadawca</TableHead>
                  <TableHead>Odbiorca</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead>Kurs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(z => (
                  <TableRow
                    key={z.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedZl(z)}
                  >
                    <TableCell className="font-mono text-sm">{z.numer}</TableCell>
                    <TableCell><StatusBadge status={z.status} /></TableCell>
                    <TableCell>{z.dzien}</TableCell>
                    <TableCell>{z.preferowana_godzina || '—'}</TableCell>
                    <TableCell>{z.typ_pojazdu || '—'}</TableCell>
                    <TableCell className="text-xs">{z.oddział_nadawcy || '—'}</TableCell>
                    <TableCell className="text-xs">{z.odbiorca || '—'}</TableCell>
                    <TableCell className="text-right">{Math.round(z.suma_kg)}</TableCell>
                    <TableCell>
                      {z.kurs_numer
                        ? <Badge variant="outline" className="font-mono text-xs">{z.kurs_numer}{z.kurs_nrrej ? ` · ${z.kurs_nrrej}` : ''}</Badge>
                        : <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs">bez kursu ⚠️</Badge>
                      }
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
        onAssignToKurs={(id) => onOpenKursModal?.(id)}
      />

      <EdytujZlecenieModal
        zlecenieId={editZlId}
        open={!!editZlId}
        onClose={() => setEditZlId(null)}
        onSaved={refetch}
      />
    </div>
  );
}
