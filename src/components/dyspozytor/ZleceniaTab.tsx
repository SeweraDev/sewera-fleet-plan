import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useZleceniaOddzialu, useZlecenieWz } from '@/hooks/useZleceniaOddzialu';

type ZlStatusFilter = 'all' | 'robocza' | 'potwierdzona' | 'w_trasie' | 'dostarczona' | 'anulowana';

const ZL_STATUS_FILTERS: { key: ZlStatusFilter; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'robocza', label: 'Robocze' },
  { key: 'potwierdzona', label: 'Potwierdzone' },
  { key: 'w_trasie', label: 'W trasie' },
  { key: 'dostarczona', label: 'Dostarczone' },
  { key: 'anulowana', label: 'Anulowane' },
];

function WzDialog({ zlecenieId, numer, open, onClose }: { zlecenieId: string; numer: string; open: boolean; onClose: () => void }) {
  const { wz, loading } = useZlecenieWz(open ? zlecenieId : null);

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Zlecenie {numer} — dokumenty WZ</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-muted-foreground text-center py-4">Ładowanie...</p>
        ) : wz.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">Brak dokumentów WZ</p>
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
      </DialogContent>
    </Dialog>
  );
}

export function ZleceniaTab({ oddzialId, pastOnly = false }: { oddzialId: number; pastOnly?: boolean }) {
  const { zlecenia, loading } = useZleceniaOddzialu(oddzialId, pastOnly);
  const [statusFilter, setStatusFilter] = useState<ZlStatusFilter>('all');
  const [selectedZl, setSelectedZl] = useState<{ id: string; numer: string } | null>(null);

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dzień</TableHead>
              <TableHead>Typ pojazdu</TableHead>
              <TableHead className="text-right">Kg</TableHead>
              <TableHead>Kurs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(z => (
              <TableRow
                key={z.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelectedZl({ id: z.id, numer: z.numer })}
              >
                <TableCell className="font-mono text-sm">{z.numer}</TableCell>
                <TableCell><StatusBadge status={z.status} /></TableCell>
                <TableCell>{z.dzien}</TableCell>
                <TableCell>{z.typ_pojazdu || '—'}</TableCell>
                <TableCell className="text-right">{Math.round(z.suma_kg)}</TableCell>
                <TableCell className="font-mono text-xs">{z.kurs_numer || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selectedZl && (
        <WzDialog
          zlecenieId={selectedZl.id}
          numer={selectedZl.numer}
          open={!!selectedZl}
          onClose={() => setSelectedZl(null)}
        />
      )}
    </div>
  );
}
