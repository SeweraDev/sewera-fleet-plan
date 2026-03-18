import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/StatusBadge';

interface Zlecenie {
  id: string;
  numer: string;
  status: string;
  dzien: string;
  typ_pojazdu: string | null;
  preferowana_godzina: string | null;
  oddzial: string;
  liczba_wz: number;
  suma_kg: number;
}

interface Oddzial {
  id: number;
  nazwa: string;
}

function getWeekDates() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return {
    od: monday.toISOString().split('T')[0],
    do: friday.toISOString().split('T')[0],
  };
}

export function RaportyTab() {
  const weekDates = getWeekDates();
  const [dateOd, setDateOd] = useState(weekDates.od);
  const [dateDo, setDateDo] = useState(weekDates.do);
  const [oddzialId, setOddzialId] = useState<string>('all');
  const [oddzialy, setOddzialy] = useState<Oddzial[]>([]);
  const [zlecenia, setZlecenia] = useState<Zlecenie[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => {
    supabase.from('oddzialy').select('id, nazwa').then(({ data }) => {
      setOddzialy(data || []);
    });
  }, []);

  const fetchRaport = async () => {
    setLoading(true);
    setPage(0);
    try {
      let query = supabase
        .from('zlecenia')
        .select('id, numer, status, dzien, typ_pojazdu, preferowana_godzina, oddzial_id')
        .gte('dzien', dateOd)
        .lte('dzien', dateDo)
        .order('dzien', { ascending: false });

      if (oddzialId !== 'all') {
        query = query.eq('oddzial_id', Number(oddzialId));
      }

      const { data: zleceniaData } = await query;
      const { data: wzData } = await supabase.from('zlecenia_wz').select('zlecenie_id, masa_kg');

      const wzMap = new Map<string, { count: number; kg: number }>();
      (wzData || []).forEach(wz => {
        const existing = wzMap.get(wz.zlecenie_id) || { count: 0, kg: 0 };
        wzMap.set(wz.zlecenie_id, { count: existing.count + 1, kg: existing.kg + Number(wz.masa_kg) });
      });

      const result: Zlecenie[] = (zleceniaData || []).map(z => {
        const wz = wzMap.get(z.id) || { count: 0, kg: 0 };
        const oddzial = oddzialy.find(o => o.id === z.oddzial_id);
        return {
          id: z.id,
          numer: z.numer,
          status: z.status,
          dzien: z.dzien,
          typ_pojazdu: z.typ_pojazdu,
          preferowana_godzina: z.preferowana_godzina,
          oddzial: oddzial?.nazwa || '',
          liczba_wz: wz.count,
          suma_kg: wz.kg,
        };
      });
      setZlecenia(result);
    } catch (err) {
      console.error('Raport fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (oddzialy.length > 0) fetchRaport();
  }, [oddzialy]);

  const paginatedZlecenia = zlecenia.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(zlecenia.length / PAGE_SIZE);

  const totalKg = zlecenia.reduce((s, z) => s + z.suma_kg, 0);
  const totalWz = zlecenia.reduce((s, z) => s + z.liczba_wz, 0);

  const exportCSV = () => {
    const header = 'Numer,Status,Dzien,TypPojazdu,Godzina,Oddzial,LiczbaWZ,SumaKg';
    const rows = zlecenia.map(z =>
      `${z.numer},${z.status},${z.dzien},${z.typ_pojazdu || ''},${z.preferowana_godzina || ''},${z.oddzial},${z.liczba_wz},${Math.round(z.suma_kg)}`
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transport_${dateOd}_${dateDo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Od</label>
              <Input type="date" value={dateOd} onChange={e => setDateOd(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Do</label>
              <Input type="date" value={dateDo} onChange={e => setDateDo(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Oddział</label>
              <Select value={oddzialId} onValueChange={setOddzialId}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Wszystkie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie</SelectItem>
                  {oddzialy.map(o => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.nazwa}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={fetchRaport} disabled={loading} className="bg-primary text-primary-foreground">
              {loading ? 'Ładowanie...' : 'Zastosuj filtry'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Zlecenia w zakresie</h3>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={zlecenia.length === 0}>
              ⬇️ Eksport CSV
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Numer</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Dzień</TableHead>
                <TableHead className="text-xs">Typ pojazdu</TableHead>
                <TableHead className="text-xs">Oddział</TableHead>
                <TableHead className="text-xs">WZ</TableHead>
                <TableHead className="text-xs">Masa kg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedZlecenia.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground text-sm">
                    Brak zleceń w wybranym zakresie
                  </TableCell>
                </TableRow>
              ) : (
                paginatedZlecenia.map(z => (
                  <TableRow key={z.id}>
                    <TableCell className="text-sm font-medium">{z.numer}</TableCell>
                    <TableCell><StatusBadge status={z.status} /></TableCell>
                    <TableCell className="text-sm">{z.dzien}</TableCell>
                    <TableCell className="text-sm">{z.typ_pojazdu || '—'}</TableCell>
                    <TableCell className="text-sm">{z.oddzial}</TableCell>
                    <TableCell className="text-sm">{z.liczba_wz}</TableCell>
                    <TableCell className="text-sm">{Math.round(z.suma_kg)} kg</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                ← Poprzednia
              </Button>
              <span className="text-sm text-muted-foreground">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                Następna →
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <p className="text-sm text-muted-foreground">
        Razem: {zlecenia.length} zleceń · {Math.round(totalKg)} kg · {totalWz} WZ w tym zakresie
      </p>
    </div>
  );
}
