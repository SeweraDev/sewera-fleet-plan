import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/shared/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Search, MapPin, Activity } from 'lucide-react';

/**
 * Statystyki wyceny — dostepne tylko dla admina.
 * Czyta z tabeli wyszukiwania_log (RLS: SELECT admin only).
 *
 * Sekcje:
 *  - 3 karty podsumowania: wczoraj / 7 dni / 30 dni + dynamika vs poprzedni okres
 *  - TOP wyszukiwane frazy (ile razy, ile sukcesow vs problemow)
 *  - Wyceny z problemem (nameMatch=false) — co ludzie wpisuja a system nie znajduje
 *  - Najaktywniejsze oddzialy
 */

interface LogRow {
  id: number;
  created_at: string;
  query: string;
  oddzial_kod: string | null;
  typ_pojazdu: string | null;
  znaleziono_adres: string | null;
  has_house_number: boolean | null;
  name_match: boolean | null;
  uzyto_cache_klientow: boolean | null;
  zrodlo: string;
  zalogowany: boolean;
  wynik_km: number | null;
  wynik_koszt_netto: number | null;
}

interface OkresStats {
  total: number;
  sukces: number;
  problem: number;
  niezalogowani: number;
  zalogowani: number;
}

interface TopFraza {
  query: string;
  liczba: number;
  sukcesy: number;
  problemy: number;
  ostatnio: string;
}

interface TopOddzial {
  kod: string;
  liczba: number;
}

const KOD_TO_NAZWA: Record<string, string> = {
  KAT: 'Katowice',
  R: 'Katowice (R)',
  SOS: 'Sosnowiec',
  GL: 'Gliwice',
  DG: 'D. Górnicza',
  TG: 'T. Góry',
  CH: 'Chrzanów',
  OS: 'Oświęcim',
};

export default function StatystykiWyceny() {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Pobieramy 90 ostatnich dni — wystarczy do statystyk wczoraj/7d/30d + porownania
      const od = new Date();
      od.setDate(od.getDate() - 90);
      const { data, error } = await supabase
        .from('wyszukiwania_log' as any)
        .select('*')
        .gte('created_at', od.toISOString())
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) {
        setError('Brak dostępu do statystyk (tylko admin może je oglądać).');
        setLoading(false);
        return;
      }
      setLogs((data as any[]) || []);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <Card>
          <CardContent className="py-8 text-center text-destructive">{error}</CardContent>
        </Card>
      </AppLayout>
    );
  }

  // Agregaty per okres
  const now = new Date();
  const wczoraj = new Date(now);
  wczoraj.setDate(wczoraj.getDate() - 1);
  wczoraj.setHours(0, 0, 0, 0);
  const dzisRano = new Date(now);
  dzisRano.setHours(0, 0, 0, 0);
  const przedwczoraj = new Date(wczoraj);
  przedwczoraj.setDate(przedwczoraj.getDate() - 1);

  const okresStats = (od: Date, doData: Date): OkresStats => {
    const inOkres = logs.filter(l => {
      const d = new Date(l.created_at);
      return d >= od && d < doData;
    });
    return {
      total: inOkres.length,
      sukces: inOkres.filter(l => l.wynik_km != null && l.wynik_km > 0).length,
      problem: inOkres.filter(l => l.name_match === false).length,
      niezalogowani: inOkres.filter(l => !l.zalogowany).length,
      zalogowani: inOkres.filter(l => l.zalogowany).length,
    };
  };

  // Wczoraj (00:00-23:59) + przedwczoraj do porownania
  const statsWczoraj = okresStats(wczoraj, dzisRano);
  const statsPrzedwczoraj = okresStats(przedwczoraj, wczoraj);

  // Ostatnie 7 dni + poprzednie 7 do porownania
  const tydzienOd = new Date(dzisRano);
  tydzienOd.setDate(tydzienOd.getDate() - 7);
  const poprzedniTydzienOd = new Date(tydzienOd);
  poprzedniTydzienOd.setDate(poprzedniTydzienOd.getDate() - 7);
  const stats7d = okresStats(tydzienOd, dzisRano);
  const statsPoprzedniTydzien = okresStats(poprzedniTydzienOd, tydzienOd);

  // Ostatnie 30 dni + poprzednie 30 do porownania
  const miesiacOd = new Date(dzisRano);
  miesiacOd.setDate(miesiacOd.getDate() - 30);
  const poprzedniMiesiacOd = new Date(miesiacOd);
  poprzedniMiesiacOd.setDate(poprzedniMiesiacOd.getDate() - 30);
  const stats30d = okresStats(miesiacOd, dzisRano);
  const statsPoprzedniMiesiac = okresStats(poprzedniMiesiacOd, miesiacOd);

  // TOP frazy (z ostatnich 30 dni) — grupuj po znormalizowanej frazie
  const fraza30dMap = new Map<string, TopFraza>();
  for (const l of logs) {
    const d = new Date(l.created_at);
    if (d < miesiacOd) continue;
    const key = (l.query || '').trim().toLowerCase();
    if (!key) continue;
    const existing = fraza30dMap.get(key);
    if (existing) {
      existing.liczba++;
      if (l.wynik_km != null && l.wynik_km > 0) existing.sukcesy++;
      if (l.name_match === false) existing.problemy++;
      if (l.created_at > existing.ostatnio) existing.ostatnio = l.created_at;
    } else {
      fraza30dMap.set(key, {
        query: l.query,
        liczba: 1,
        sukcesy: l.wynik_km != null && l.wynik_km > 0 ? 1 : 0,
        problemy: l.name_match === false ? 1 : 0,
        ostatnio: l.created_at,
      });
    }
  }
  const topFrazy = [...fraza30dMap.values()].sort((a, b) => b.liczba - a.liczba).slice(0, 15);

  // Wyceny z problemem (ostatnie 30 dni, nameMatch=false) — pokazujemy jak pisali
  const problemowe30d = logs
    .filter(l => {
      const d = new Date(l.created_at);
      return d >= miesiacOd && l.name_match === false;
    })
    .slice(0, 20);

  // TOP oddzialy (z ostatnich 30 dni)
  const oddzialMap = new Map<string, number>();
  for (const l of logs) {
    const d = new Date(l.created_at);
    if (d < miesiacOd) continue;
    const k = l.oddzial_kod || '?';
    oddzialMap.set(k, (oddzialMap.get(k) || 0) + 1);
  }
  const topOddzialy: TopOddzial[] = [...oddzialMap.entries()]
    .map(([kod, liczba]) => ({ kod, liczba }))
    .sort((a, b) => b.liczba - a.liczba);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" />
            Statystyki wyceny transportu
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tylko admin · dane z tabeli wyszukiwania_log · ostatnie 90 dni
          </p>
        </div>

        {/* Karty podsumowania */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryCard title="Wczoraj" stats={statsWczoraj} prev={statsPrzedwczoraj} prevLabel="vs. przedwczoraj" />
          <SummaryCard title="Ostatnie 7 dni" stats={stats7d} prev={statsPoprzedniTydzien} prevLabel="vs. poprzedni tydzień" />
          <SummaryCard title="Ostatnie 30 dni" stats={stats30d} prev={statsPoprzedniMiesiac} prevLabel="vs. poprzedni miesiąc" />
        </div>

        {/* TOP frazy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Najczęściej wyszukiwane (ostatnie 30 dni)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topFrazy.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Brak danych w tym okresie.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Co wpisano</TableHead>
                    <TableHead className="text-center">Łącznie</TableHead>
                    <TableHead className="text-center">Sukces</TableHead>
                    <TableHead className="text-center">Problem</TableHead>
                    <TableHead className="text-right">Ostatnio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topFrazy.map((f, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">"{f.query}"</TableCell>
                      <TableCell className="text-center tabular-nums">{f.liczba}</TableCell>
                      <TableCell className="text-center tabular-nums text-green-700 dark:text-green-400">
                        {f.sukcesy}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {f.problemy > 0 ? (
                          <span className="text-red-700 dark:text-red-400 font-medium">{f.problemy}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatRelDate(f.ostatnio)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Wyceny z problemem */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Wyceny z problemem — system nie znalazł nazwy
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              User wpisał frazę, ale system wybrał COŚ INNEGO (np. centroid miasta zamiast firmy).
              Te przypadki wymagają uwagi — może oznaczać że klient nie jest w OpenStreetMap.
            </p>
          </CardHeader>
          <CardContent>
            {problemowe30d.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                ✅ Brak problemów w ostatnich 30 dniach.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Co wpisano</TableHead>
                    <TableHead>System znalazł</TableHead>
                    <TableHead className="w-24">Oddział</TableHead>
                    <TableHead className="w-32">Kiedy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {problemowe30d.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">"{l.query}"</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {l.znaleziono_adres || <em>nie znaleziono</em>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {KOD_TO_NAZWA[l.oddzial_kod || ''] || l.oddzial_kod || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelDate(l.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Najaktywniejsze oddziały */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Najaktywniejsze oddziały (ostatnie 30 dni)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topOddzialy.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Brak danych.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Oddział</TableHead>
                    <TableHead className="text-right">Liczba wycen</TableHead>
                    <TableHead className="text-right w-32">Udział</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topOddzialy.map(o => {
                    const total = topOddzialy.reduce((s, x) => s + x.liczba, 0);
                    const procent = total > 0 ? Math.round((o.liczba / total) * 100) : 0;
                    return (
                      <TableRow key={o.kod}>
                        <TableCell className="font-medium">
                          {KOD_TO_NAZWA[o.kod] || o.kod}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{o.liczba}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {procent}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

// ============================================================
// HELPERS
// ============================================================

function SummaryCard({
  title,
  stats,
  prev,
  prevLabel,
}: {
  title: string;
  stats: OkresStats;
  prev: OkresStats;
  prevLabel: string;
}) {
  const delta = stats.total - prev.total;
  const procent = prev.total > 0 ? Math.round((delta / prev.total) * 100) : null;
  const procentSukces = stats.total > 0 ? Math.round((stats.sukces / stats.total) * 100) : 0;
  const procentProblem = stats.total > 0 ? Math.round((stats.problem / stats.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-bold tabular-nums">{stats.total}</div>
          {procent !== null && (
            <Badge
              variant="outline"
              className={`text-xs ${
                delta > 0
                  ? 'border-green-400 text-green-700 dark:text-green-400'
                  : delta < 0
                  ? 'border-red-400 text-red-700 dark:text-red-400'
                  : 'border-muted-foreground'
              }`}
            >
              {delta > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : delta < 0 ? <TrendingDown className="h-3 w-3 mr-1" /> : null}
              {delta > 0 ? '+' : ''}{procent}%
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{prevLabel} ({prev.total})</p>
        <div className="pt-2 space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">✅ Udane wyliczenia:</span>
            <span className="font-medium tabular-nums">{stats.sukces} ({procentSukces}%)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">⚠️ Z problemem:</span>
            <span className={`font-medium tabular-nums ${stats.problem > 0 ? 'text-red-700 dark:text-red-400' : ''}`}>
              {stats.problem} ({procentProblem}%)
            </span>
          </div>
          <div className="flex justify-between pt-1 border-t">
            <span className="text-muted-foreground">🔓 Bez logowania:</span>
            <span className="tabular-nums">{stats.niezalogowani}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">🔐 Zalogowani:</span>
            <span className="tabular-nums">{stats.zalogowani}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatRelDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return diffMin === 0 ? 'przed chwilą' : `${diffMin} min temu`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} godz. temu`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} dni temu`;
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
}
