import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/shared/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, Package, AlertTriangle, FileWarning, Truck, Loader2 } from 'lucide-react';
import { parseKatalogCSV, parseKatalogXLSX, type KatalogRow } from '@/lib/katalogParser';

/**
 * Panel admina: baza towarow Sewery.
 * - Upload CSV/XLSX z Ekonoma (raz/miesiac), nadpisuje cala tabele
 * - Walidator sanity: flaguje podejrzane m3 (>5 dla SZT, m3==waga, ml/L z m3>0.5)
 * - Raport: ile rekordow, ile HDS, ile podejrzanych m3
 */

interface Stats {
  total: number;
  z_m3: number;
  podejrzanych: number;
  hds: number;
}

export default function KatalogTowarow() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [suspicious, setSuspicious] = useState<KatalogRow[]>([]);
  const [showSuspicious, setShowSuspicious] = useState(false);

  const fetchStats = useCallback(async () => {
    const { count: total } = await supabase.from('katalog_towarow' as any).select('*', { count: 'exact', head: true });
    const { count: z_m3 } = await supabase.from('katalog_towarow' as any).select('*', { count: 'exact', head: true }).not('m3_per_szt', 'is', null);
    const { count: podejrzanych } = await supabase.from('katalog_towarow' as any).select('*', { count: 'exact', head: true }).eq('m3_podejrzany', true);
    const { count: hds } = await supabase.from('katalog_towarow' as any).select('*', { count: 'exact', head: true }).eq('wymaga_hds', true);
    setStats({ total: total ?? 0, z_m3: z_m3 ?? 0, podejrzanych: podejrzanych ?? 0, hds: hds ?? 0 });
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const loadSuspicious = useCallback(async () => {
    const { data } = await supabase
      .from('katalog_towarow' as any)
      .select('kod, nazwa, jm, m3_per_szt, kg_per_szt, dzial, producent')
      .eq('m3_podejrzany', true)
      .limit(200);
    setSuspicious((data as any) || []);
    setShowSuspicious(true);
  }, []);

  const handleFile = async (file: File) => {
    setUploading(true);
    setProgress(null);
    try {
      const isCSV = /\.csv$/i.test(file.name);
      const rows = isCSV ? await parseKatalogCSV(file) : await parseKatalogXLSX(file);
      if (rows.length === 0) {
        toast.error('Plik pusty lub nie udało się sparsować');
        setUploading(false);
        return;
      }
      toast.info(`Sparsowano ${rows.length.toLocaleString('pl-PL')} pozycji. Zapisuję do bazy...`);

      // Strategia: nadpisanie calej tabeli (delete + insert chunkami).
      // Bezpieczne dla raz/miesiac update — kompletny snapshot.
      // 1. Najpierw delete all (1 zapytanie, RLS sprawdza admin role)
      const { error: delErr } = await supabase.from('katalog_towarow' as any).delete().neq('kod', '__never__');
      if (delErr) {
        toast.error('Błąd czyszczenia tabeli: ' + delErr.message);
        setUploading(false);
        return;
      }

      // 2. Chunked insert (1000 wierszy per request — Supabase ma limit payloadu)
      const CHUNK = 1000;
      let done = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error: insErr } = await supabase.from('katalog_towarow' as any).insert(slice as any);
        if (insErr) {
          toast.error(`Błąd przy wierszu ${i}: ${insErr.message}`);
          setUploading(false);
          return;
        }
        done += slice.length;
        setProgress({ done, total: rows.length });
      }

      toast.success(`Zaimportowano ${rows.length.toLocaleString('pl-PL')} towarów`);
      setProgress(null);
      await fetchStats();
    } catch (e: any) {
      toast.error('Błąd: ' + (e?.message || String(e)));
    }
    setUploading(false);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            Katalog towarów Sewery
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Baza z systemu Ekonom · aktualizacja raz/miesiąc · CSV (cp1250) lub XLSX
          </p>
        </div>

        {/* Statystyki */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Łącznie pozycji</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums">{stats.total.toLocaleString('pl-PL')}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Z wypełnionym m³</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums">{stats.z_m3.toLocaleString('pl-PL')}</div>
                <p className="text-xs text-muted-foreground">
                  {stats.total > 0 ? Math.round((stats.z_m3 / stats.total) * 100) : 0}% bazy
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5" />
                  Wymaga HDS
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums">{stats.hds.toLocaleString('pl-PL')}</div>
                <p className="text-xs text-muted-foreground">towarów z flagą</p>
              </CardContent>
            </Card>
            <Card className={stats.podejrzanych > 0 ? 'border-amber-400' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  Podejrzane m³
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums text-amber-700">
                  {stats.podejrzanych.toLocaleString('pl-PL')}
                </div>
                <p className="text-xs text-muted-foreground">do weryfikacji</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Wgraj nową bazę
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Plik <strong>nadpisuje całą bazę</strong> — bezpieczne dla aktualizacji miesięcznej.
              Oczekiwane kolumny:
              <code className="text-xs bg-muted px-1 rounded ml-1">
                Kod;Nazwa;Nazwa dodatkowa;Kod producenta;Jm.;Objętość;Dział;Producent;Waga netto;EAN;HDS
              </code>
            </p>
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {uploading && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress
                  ? <span>Zapisuję: {progress.done.toLocaleString('pl-PL')} / {progress.total.toLocaleString('pl-PL')} ({Math.round((progress.done / progress.total) * 100)}%)</span>
                  : <span>Parsuję plik...</span>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Podejrzane m3 */}
        {stats && stats.podejrzanych > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileWarning className="h-4 w-4 text-amber-600" />
                Podejrzane wartości m³
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Reguły: m³ &gt; 5 dla 1 SZT, m³ == waga, m³ &gt; 0,5 dla produktów w ml/L.
                Parser WZ ignoruje te wartości i wraca do regexu z opisu pozycji.
              </p>
            </CardHeader>
            <CardContent>
              {!showSuspicious ? (
                <Button variant="outline" onClick={loadSuspicious}>
                  Pokaż listę ({stats.podejrzanych})
                </Button>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kod</TableHead>
                      <TableHead>Nazwa</TableHead>
                      <TableHead>JM</TableHead>
                      <TableHead className="text-right">m³ (bug)</TableHead>
                      <TableHead className="text-right">Waga</TableHead>
                      <TableHead>Dział</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suspicious.map((r: any) => (
                      <TableRow key={r.kod}>
                        <TableCell className="font-mono text-xs">{r.kod}</TableCell>
                        <TableCell className="text-sm">{r.nazwa}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{r.jm}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700 font-medium">
                          {r.m3_per_szt?.toLocaleString('pl-PL', { maximumFractionDigits: 4 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.kg_per_szt?.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.dzial}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
