import { Fragment, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PodgladWZDialog } from '@/components/shared/PodgladWZDialog';
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
  // Rozwiniete zlecenia (pokaz liste WZ)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [podgladWZ, setPodgladWZ] = useState<{ path: string; numer: string } | null>(null);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
              <TableHead className="w-8"></TableHead>
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
            {zlecenia.map(z => {
              const isExpanded = expanded.has(z.id);
              const canExpand = z.liczba_wz > 0;
              return (
                <Fragment key={z.id}>
                  <TableRow
                    className={`${z.flaga_brak_wz ? 'bg-red-50 dark:bg-red-950/20' : ''} ${canExpand ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                    onClick={() => canExpand && toggleExpand(z.id)}
                  >
                    <TableCell className="text-muted-foreground text-xs">
                      {canExpand ? (isExpanded ? '▼' : '▶') : ''}
                    </TableCell>
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
                  {isExpanded && z.wz_lista.length > 0 && (
                    <TableRow className="bg-muted/20">
                      <TableCell colSpan={10} className="p-0">
                        <div className="px-6 py-3 space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground mb-2">Dokumenty WZ:</p>
                          {z.wz_lista.map(wz => (
                            <div key={wz.id} className="flex items-center gap-3 text-sm">
                              <span className="font-mono text-xs w-32 shrink-0">{wz.numer_wz || '—'}</span>
                              <span className="flex-1 truncate">{wz.odbiorca || '—'}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-xs">{wz.adres || ''}</span>
                              {wz.archiwum_path ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPodgladWZ({ path: wz.archiwum_path!, numer: wz.numer_wz || '' });
                                  }}
                                  className="text-blue-600 hover:text-blue-800 text-base leading-none shrink-0"
                                  title="Podgląd dokumentu WZ"
                                >
                                  📄
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground shrink-0 w-4">—</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      <PodgladWZDialog
        archiwumPath={podgladWZ?.path ?? null}
        numerWz={podgladWZ?.numer ?? null}
        isOpen={!!podgladWZ}
        onClose={() => setPodgladWZ(null)}
      />
    </div>
  );
}
