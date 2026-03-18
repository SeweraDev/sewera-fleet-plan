import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useMojeZlecenia } from '@/hooks/useMojeZlecenia';

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {zlecenia.map(z => (
              <TableRow key={z.id}>
                <TableCell className="font-mono text-sm">{z.numer}</TableCell>
                <TableCell><StatusBadge status={z.status} /></TableCell>
                <TableCell>{z.dzien}</TableCell>
                <TableCell>{z.oddzial}</TableCell>
                <TableCell>{z.typ_pojazdu || '—'}</TableCell>
                <TableCell className="text-right">{z.liczba_wz}</TableCell>
                <TableCell className="text-right">{Math.round(z.suma_kg)}</TableCell>
                <TableCell className="text-right">{z.suma_palet > 0 ? `📦 ${z.suma_palet}` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
