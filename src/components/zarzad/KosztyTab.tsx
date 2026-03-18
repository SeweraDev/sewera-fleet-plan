import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { KosztySplit, ZewnetrznyPrzewoznik } from '@/hooks/useZarzadKPI';

interface KosztyTabProps {
  kosztySplit: KosztySplit;
  zewnetrzniPrzewoznicy: ZewnetrznyPrzewoznik[];
}

export function KosztyTab({ kosztySplit, zewnetrzniPrzewoznicy }: KosztyTabProps) {
  const total = kosztySplit.kursy_wlasne + kosztySplit.kursy_zewnetrzne;
  const pctWlasne = total > 0 ? Math.round((kosztySplit.kursy_wlasne / total) * 100) : 0;
  const pctZewn = total > 0 ? 100 - pctWlasne : 0;

  const monthName = new Date().toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Two big tiles */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-primary">
          <CardContent className="p-6 text-center">
            <p className="text-4xl font-bold text-primary-foreground">{kosztySplit.kursy_wlasne}</p>
            <p className="text-sm text-primary-foreground/80 mt-1">kursy własnymi autami</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-600">
          <CardContent className="p-6 text-center">
            <p className="text-4xl font-bold text-white">{kosztySplit.kursy_zewnetrzne}</p>
            <p className="text-sm text-white/80 mt-1">kursy zewnętrznymi przewoźnikami</p>
          </CardContent>
        </Card>
      </div>

      {/* Split bar */}
      {total > 0 && (
        <div>
          <div className="flex h-4 rounded-full overflow-hidden">
            <div className="bg-primary" style={{ width: `${pctWlasne}%` }} />
            <div className="bg-purple-500" style={{ width: `${pctZewn}%` }} />
          </div>
          <p className="text-sm text-muted-foreground mt-2 text-center">
            {pctWlasne}% własne / {pctZewn}% zewnętrzne w {monthName}
          </p>
        </div>
      )}

      {/* External carriers table */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm mb-3">🚚 Zewnętrzni przewoźnicy — aktywność w tym miesiącu</h3>
          {zewnetrzniPrzewoznicy.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak zewnętrznych przewoźników</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Firma</TableHead>
                  <TableHead className="text-xs">Nr rej.</TableHead>
                  <TableHead className="text-xs">Typ</TableHead>
                  <TableHead className="text-xs">Kursy w miesiącu</TableHead>
                  <TableHead className="text-xs">Zakończone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zewnetrzniPrzewoznicy.map(p => (
                  <TableRow key={p.nr_rej}>
                    <TableCell className="text-sm">{p.firma}</TableCell>
                    <TableCell className="text-sm font-medium">{p.nr_rej}</TableCell>
                    <TableCell className="text-sm">{p.typ}</TableCell>
                    <TableCell className="text-sm">{p.liczba_kursow}</TableCell>
                    <TableCell className="text-sm">{p.zakonczone}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Moduł kosztów szczegółowych (stawki za km, faktury) — planowany w kolejnej wersji
      </p>
    </div>
  );
}
