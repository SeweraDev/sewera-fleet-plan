import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useMojeZlecenia } from '@/hooks/useMojeZlecenia';

function DeadlineBadge({ zlecenie }: { zlecenie: { ma_wz: boolean; deadline_wz: string | null; flaga_brak_wz: boolean } }) {
  if (zlecenie.ma_wz) {
    return <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap">🟢 WZ dodane</Badge>;
  }

  if (!zlecenie.deadline_wz) return null;

  const now = new Date();
  const deadline = new Date(zlecenie.deadline_wz);

  if (zlecenie.flaga_brak_wz || deadline < now) {
    return (
      <Badge variant="destructive" className="text-[10px] whitespace-nowrap">
        🔴 ⏰ Deadline — oczekuje na decyzję
      </Badge>
    );
  }

  // Format deadline nicely
  const days = ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  const dayName = days[deadline.getDay()];
  const dd = deadline.getDate().toString().padStart(2, '0');
  const mm = (deadline.getMonth() + 1).toString().padStart(2, '0');

  return (
    <Badge variant="outline" className="text-[10px] bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 whitespace-nowrap">
      🟡 Dodaj WZ do {dayName} {dd}.{mm} 16:00
    </Badge>
  );
}

export function MojeZleceniaTab() {
  const [statusFilter, setStatusFilter] = useState('wszystkie');
  const { zlecenia, loading } = useMojeZlecenia(statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-sm">Status:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="wszystkie">Wszystkie</SelectItem>
            <SelectItem value="robocza">Robocza</SelectItem>
            <SelectItem value="potwierdzona">Potwierdzona</SelectItem>
            <SelectItem value="w_trasie">W trasie</SelectItem>
            <SelectItem value="dostarczona">Dostarczona</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Ładowanie...</p>
      ) : zlecenia.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Brak zleceń</CardContent></Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dzień</TableHead>
              <TableHead>Oddział</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead className="text-right">WZ</TableHead>
              <TableHead className="text-right">Kg</TableHead>
              <TableHead className="text-right">Pal</TableHead>
              <TableHead>Deadline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {zlecenia.map(z => (
              <TableRow key={z.id} className={z.flaga_brak_wz ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                <TableCell className="font-mono text-sm">{z.numer}</TableCell>
                <TableCell><StatusBadge status={z.status} /></TableCell>
                <TableCell>{z.dzien}</TableCell>
                <TableCell>{z.oddzial}</TableCell>
                <TableCell>{z.typ_pojazdu || '—'}</TableCell>
                <TableCell className="text-right">{z.liczba_wz}</TableCell>
                <TableCell className="text-right">{Math.round(z.suma_kg)}</TableCell>
                <TableCell className="text-right">{z.suma_palet > 0 ? `📦 ${z.suma_palet}` : '—'}</TableCell>
                <TableCell>
                  <DeadlineBadge zlecenie={z} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
