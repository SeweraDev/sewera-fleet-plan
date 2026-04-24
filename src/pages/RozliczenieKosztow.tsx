// Strona rozliczenia kosztów transportu — tylko dla zarządu i admina.
// Pokazuje zakończone kursy w zadanym okresie + koszt per punkt + per WZ.
// Eksport CSV/XLS z pełnym rozbiciem.

import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/shared/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ChevronDown, ChevronRight, FileSpreadsheet, FileText } from 'lucide-react';
import { useOddzialy } from '@/hooks/useOddzialy';
import { useRozliczenieKursow, type RozliczenieKursuRow } from '@/hooks/useRozliczenieKursow';

function formatZl(n: number): string {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}

function formatKm(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
}

function formatProc(u: number): string {
  return (u * 100).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
}

/** Spłaszcz rozliczenie do wierszy CSV — per WZ */
function flattenToRows(data: RozliczenieKursuRow[]) {
  const rows: Record<string, string | number>[] = [];
  for (const r of data) {
    for (const p of r.rozliczenie.punkty) {
      for (const w of p.wz) {
        rows.push({
          'Kurs': r.numer,
          'Data': r.dzien,
          'Oddzial': r.oddzial_nazwa,
          'Nr rej.': r.nr_rej,
          'Typ pojazdu': r.typ_pojazdu,
          'Kierowca': r.kierowca,
          'Km kolka': r.rozliczenie.km_kolka,
          'Adres': p.adres,
          'Klasyfikacja': p.klasyfikacja,
          'Linia prosta (km)': p.km_prosta,
          'Udzial %': (p.udzial_proc * 100).toFixed(2),
          'Km w kolku': p.km_punktu.toFixed(2),
          'Koszt punktu (zl)': p.koszt_punktu.toFixed(2),
          'Nr WZ': w.numer_wz,
          'Masa WZ (kg)': w.masa_kg,
          'Wartosc netto (zl)': w.wartosc_netto ?? '',
          'Udzial WZ %': (w.udzial * 100).toFixed(2),
          'Koszt WZ (zl)': w.koszt_wz.toFixed(2),
          'Zrodlo rozdzialu': p.zrodlo_rozdzialu,
        });
      }
    }
  }
  return rows;
}

function exportCSV(data: RozliczenieKursuRow[], filename: string) {
  const rows = flattenToRows(data);
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.join(';'),
    ...rows.map(r => headers.map(h => {
      const v = r[h];
      const s = v == null ? '' : String(v);
      return s.includes(';') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';'))
  ];
  const csv = '\ufeff' + csvRows.join('\r\n'); // BOM dla Excel PL
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function exportXLSX(data: RozliczenieKursuRow[], filename: string) {
  const rows = flattenToRows(data);
  if (rows.length === 0) return;
  // Dynamic import — xlsx jest ciężki, ładujemy na żądanie
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rozliczenie');
  XLSX.writeFile(wb, filename + '.xlsx');
}

function KursRow({ row, expanded, onToggle }: { row: RozliczenieKursuRow; expanded: boolean; onToggle: () => void }) {
  const { rozliczenie, numer, dzien, nr_rej, typ_pojazdu, kierowca } = row;
  const wzCount = rozliczenie.punkty.reduce((s, p) => s + p.wz.length, 0);

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <TableCell className="w-8 p-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-mono text-xs">{numer}</TableCell>
        <TableCell className="text-xs">{dzien}</TableCell>
        <TableCell className="text-xs"><span className="font-mono">{nr_rej}</span> <span className="text-muted-foreground">{typ_pojazdu}</span></TableCell>
        <TableCell className="text-xs">{kierowca}</TableCell>
        <TableCell className="text-xs text-right">{formatKm(rozliczenie.km_kolka)}</TableCell>
        <TableCell className="text-xs text-right">{wzCount}</TableCell>
        <TableCell className="text-xs text-right font-semibold">{formatZl(rozliczenie.koszt_calkowity)}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="p-0 bg-muted/20">
            <div className="p-3 space-y-3">
              {rozliczenie.ostrzezenia.length > 0 && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-900 p-2">
                  <div className="text-[11px] font-medium text-yellow-800 dark:text-yellow-200 mb-1">Uwagi:</div>
                  <ul className="text-[11px] text-yellow-700 dark:text-yellow-300 list-disc pl-4">
                    {rozliczenie.ostrzezenia.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
              )}
              {rozliczenie.punkty.map(p => (
                <div key={p.kolejnosc} className="rounded border bg-background">
                  <div className="px-3 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="font-semibold">#{p.kolejnosc}</span>
                    <span>{p.adres}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{p.klasyfikacja}</Badge>
                    <span className="text-muted-foreground">linia prosta: <span className="text-foreground">{formatKm(p.km_prosta)}</span></span>
                    <span className="text-muted-foreground">udział: <span className="text-foreground">{formatProc(p.udzial_proc)}</span></span>
                    <span className="text-muted-foreground">km w kółku: <span className="text-foreground">{formatKm(p.km_punktu)}</span></span>
                    <span className="ml-auto font-semibold">{formatZl(p.koszt_punktu)}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">Nr WZ</TableHead>
                        <TableHead className="text-[10px] text-right">Masa (kg)</TableHead>
                        <TableHead className="text-[10px] text-right">Wartość netto</TableHead>
                        <TableHead className="text-[10px] text-right">Udział</TableHead>
                        <TableHead className="text-[10px] text-right">Koszt WZ</TableHead>
                        <TableHead className="text-[10px]">Źródło</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.wz.map(w => (
                        <TableRow key={w.id}>
                          <TableCell className="font-mono text-[11px]">{w.numer_wz || '—'}</TableCell>
                          <TableCell className="text-[11px] text-right">{w.masa_kg.toLocaleString('pl-PL')}</TableCell>
                          <TableCell className="text-[11px] text-right">{w.wartosc_netto != null ? formatZl(w.wartosc_netto) : '—'}</TableCell>
                          <TableCell className="text-[11px] text-right">{formatProc(w.udzial)}</TableCell>
                          <TableCell className="text-[11px] text-right font-semibold">{formatZl(w.koszt_wz)}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">
                            {p.zrodlo_rozdzialu === 'wartosc_netto' ? 'wartość' : p.zrodlo_rozdzialu === 'masa_kg' ? 'masa' : 'równy'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function RozliczenieKosztow() {
  const { oddzialy } = useOddzialy();
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [dzienOd, setDzienOd] = useState(monthAgo);
  const [dzienDo, setDzienDo] = useState(today);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { rows, loading, error } = useRozliczenieKursow(oddzialId, dzienOd, dzienDo);

  const podsumowanie = useMemo(() => {
    const kursow = rows.length;
    const wzy = rows.reduce((s, r) => s + r.rozliczenie.punkty.reduce((a, p) => a + p.wz.length, 0), 0);
    const koszt = rows.reduce((s, r) => s + r.rozliczenie.koszt_calkowity, 0);
    const km = rows.reduce((s, r) => s + r.rozliczenie.km_kolka, 0);
    return { kursow, wzy, koszt, km };
  }, [rows]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const fileBase = `rozliczenie_${oddzialId ? (oddzialy.find(o => o.id === oddzialId)?.nazwa || '') : ''}_${dzienOd}_${dzienDo}`.replace(/\s/g, '_');

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Rozliczenie kosztów transportu</h1>
        </div>

        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px]">
                <Label className="text-xs">Oddział</Label>
                <Select value={oddzialId ? String(oddzialId) : ''} onValueChange={v => setOddzialId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Wybierz oddział…" /></SelectTrigger>
                  <SelectContent>
                    {oddzialy.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nazwa}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Od</Label>
                <Input type="date" value={dzienOd} onChange={e => setDzienOd(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Do</Label>
                <Input type="date" value={dzienDo} onChange={e => setDzienDo(e.target.value)} />
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => exportCSV(rows, fileBase)} disabled={!rows.length}>
                  <FileText className="h-4 w-4 mr-2" />CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportXLSX(rows, fileBase)} disabled={!rows.length}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />XLSX
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {oddzialId && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Podsumowanie</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div><div className="text-xs text-muted-foreground">Kursy</div><div className="text-xl font-semibold">{podsumowanie.kursow}</div></div>
                <div><div className="text-xs text-muted-foreground">WZ</div><div className="text-xl font-semibold">{podsumowanie.wzy}</div></div>
                <div><div className="text-xs text-muted-foreground">Razem km</div><div className="text-xl font-semibold">{formatKm(podsumowanie.km)}</div></div>
                <div><div className="text-xs text-muted-foreground">Koszt łączny</div><div className="text-xl font-semibold">{formatZl(podsumowanie.koszt)}</div></div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            {!oddzialId && <p className="text-sm text-muted-foreground text-center py-6">Wybierz oddział, aby zobaczyć rozliczenie.</p>}
            {oddzialId && loading && <p className="text-sm text-muted-foreground text-center py-6">Ładowanie…</p>}
            {oddzialId && error && <p className="text-sm text-destructive text-center py-6">{error}</p>}
            {oddzialId && !loading && !error && rows.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">Brak zakończonych kursów w tym okresie.</p>
            )}
            {oddzialId && rows.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Kurs</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Pojazd</TableHead>
                      <TableHead>Kierowca</TableHead>
                      <TableHead className="text-right">Km kółka</TableHead>
                      <TableHead className="text-right">WZ</TableHead>
                      <TableHead className="text-right">Koszt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <KursRow key={r.kurs_id} row={r} expanded={expanded.has(r.kurs_id)} onToggle={() => toggleExpand(r.kurs_id)} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
