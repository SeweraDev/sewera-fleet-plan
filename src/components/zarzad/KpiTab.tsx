import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { KpiDzis, ZajetoscFloty, KosztySplit, AktywnyKurs, ZleceniePerOddzial, ZlecenieBezKursu } from '@/hooks/useZarzadKPI';

interface KpiTabProps {
  kpiDzis: KpiDzis;
  zajetoscFloty: ZajetoscFloty[];
  kosztySplit: KosztySplit;
  aktywneKursy: AktywnyKurs[];
  zleceniaPerOddzial: ZleceniePerOddzial[];
  zleceniaBezKursu: ZlecenieBezKursu[];
  lastUpdated: Date;
}

function utilizationColor(pct: number) {
  if (pct <= 40) return 'bg-green-500';
  if (pct <= 70) return 'bg-yellow-500';
  if (pct <= 95) return 'bg-orange-500';
  return 'bg-red-500';
}

function bezKursuColor(n: number) {
  if (n === 0) return 'text-green-600';
  if (n <= 3) return 'text-yellow-600';
  return 'text-red-600';
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function elapsedSince(startTime: string | null) {
  if (!startTime) return '';
  const now = new Date();
  const [h, m] = startTime.split(':').map(Number);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  const diffMs = now.getTime() - start.getTime();
  if (diffMs < 0) return '';
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  return `od ${startTime.slice(0, 5)} (${diffH}h ${diffM}min)`;
}

export function KpiTab({
  kpiDzis, zajetoscFloty, kosztySplit, aktywneKursy,
  zleceniaPerOddzial, zleceniaBezKursu, lastUpdated,
}: KpiTabProps) {
  const totalKoszty = kosztySplit.kursy_wlasne + kosztySplit.kursy_zewnetrzne;
  const pctZewn = totalKoszty > 0 ? Math.round((kosztySplit.kursy_zewnetrzne / totalKoszty) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ROW 1: 4 metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard value={kpiDzis.total} label="Kursy dziś" icon="🚛" />
        <MetricCard value={kpiDzis.aktywne} label="Aktywne teraz" icon="🟢" valueClass="text-green-600" />
        <MetricCard value={kpiDzis.zakonczone} label="Zakończone dziś" icon="✓" />
        <MetricCard
          value={zleceniaBezKursu.length}
          label="Zlecenia bez kursu"
          icon="⚠️"
          valueClass={zleceniaBezKursu.length > 0 ? 'text-destructive' : ''}
        />
      </div>

      {/* ROW 2: Fleet utilization + Own vs External */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Fleet utilization - 2/3 width */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">🚛 Zajętość floty</h3>
            {zajetoscFloty.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak pojazdów w flocie</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nr rej.</TableHead>
                    <TableHead className="text-xs">Typ</TableHead>
                    <TableHead className="text-xs">Oddział</TableHead>
                    <TableHead className="text-xs">kg</TableHead>
                    <TableHead className="text-xs">%</TableHead>
                    <TableHead className="text-xs">m³</TableHead>
                    <TableHead className="text-xs">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zajetoscFloty
                    .sort((a, b) => {
                      const pctA = a.ladownosc_kg > 0 ? (a.uz_kg / a.ladownosc_kg) * 100 : 0;
                      const pctB = b.ladownosc_kg > 0 ? (b.uz_kg / b.ladownosc_kg) * 100 : 0;
                      return pctB - pctA;
                    })
                    .map(f => {
                      const pctKg = f.ladownosc_kg > 0 ? Math.round((f.uz_kg / f.ladownosc_kg) * 100) : 0;
                      const pctM3 = f.objetosc_m3 > 0 ? Math.round((f.uz_m3 / f.objetosc_m3) * 100) : 0;
                      return (
                        <TableRow key={f.nr_rej}>
                          <TableCell className="text-xs font-medium">{f.nr_rej}</TableCell>
                          <TableCell className="text-xs">{f.typ}</TableCell>
                          <TableCell className="text-xs">{f.oddzial}</TableCell>
                          <TableCell className="text-xs">
                            <div className="w-16">
                              <div className={`h-2 rounded ${utilizationColor(pctKg)}`} style={{ width: `${Math.min(pctKg, 100)}%` }} />
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{pctKg}%</TableCell>
                          <TableCell className="text-xs">
                            <div className="w-16">
                              <div className={`h-2 rounded ${utilizationColor(pctM3)}`} style={{ width: `${Math.min(pctM3, 100)}%` }} />
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{pctM3}%</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Own vs External - 1/3 width */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">Własne vs Zewnętrzne</h3>
            <div className="flex gap-4 mb-3">
              <div className="text-center flex-1">
                <p className="text-2xl font-bold text-primary">{kosztySplit.kursy_wlasne}</p>
                <p className="text-xs text-muted-foreground">własnych</p>
              </div>
              <div className="text-center flex-1">
                <p className="text-2xl font-bold text-purple-600">{kosztySplit.kursy_zewnetrzne}</p>
                <p className="text-xs text-muted-foreground">zewnętrznych</p>
              </div>
            </div>
            {totalKoszty > 0 && (
              <>
                <div className="flex h-3 rounded-full overflow-hidden">
                  <div className="bg-primary" style={{ width: `${100 - pctZewn}%` }} />
                  <div className="bg-purple-500" style={{ width: `${pctZewn}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  zewnętrzne stanowią {pctZewn}% kursów
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live active courses */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-semibold text-sm">🟢 Kursy w trasie teraz</h3>
            <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-0.5 rounded-full">
              {aktywneKursy.length}
            </span>
          </div>
          {aktywneKursy.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak aktywnych kursów</p>
          ) : (
            <div className="space-y-2">
              {aktywneKursy.map(k => {
                const pct = k.przystanki_total > 0 ? Math.round((k.przystanki_done / k.przystanki_total) * 100) : 0;
                return (
                  <div key={k.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                    <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded font-medium">
                      {k.nr_rej}
                    </span>
                    <span className="text-sm">{k.kierowca}</span>
                    <span className="text-xs text-muted-foreground">{k.oddzial}</span>
                    <span className="text-xs">✓ {k.przystanki_done}/{k.przystanki_total} rozładunków</span>
                    <span className="text-xs text-muted-foreground">{elapsedSince(k.godzina_start)}</span>
                    <div className="flex-1 max-w-[100px]">
                      <Progress value={pct} className="h-2" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Zlecenia per oddział table */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm mb-3">📋 Zlecenia dziś — per oddział</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Oddział</TableHead>
                <TableHead className="text-xs">Zlecenia dziś</TableHead>
                <TableHead className="text-xs">Bez kursu ⚠️</TableHead>
                <TableHead className="text-xs">Suma kg</TableHead>
                <TableHead className="text-xs">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zleceniaPerOddzial.map(o => (
                <TableRow key={o.nazwa}>
                  <TableCell className="text-sm">{o.nazwa}</TableCell>
                  <TableCell className="text-sm">{o.liczba}</TableCell>
                  <TableCell className={`text-sm font-medium ${bezKursuColor(o.bez_kursu)}`}>
                    {o.bez_kursu > 0 && (o.bez_kursu >= 4 ? '🔴 ' : '⚠️ ')}{o.bez_kursu}
                  </TableCell>
                  <TableCell className="text-sm">{Math.round(o.suma_kg)} kg</TableCell>
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                </TableRow>
              ))}
              {zleceniaPerOddzial.length > 0 && (
                <TableRow className="font-bold">
                  <TableCell>RAZEM</TableCell>
                  <TableCell>{zleceniaPerOddzial.reduce((s, o) => s + o.liczba, 0)}</TableCell>
                  <TableCell>{zleceniaPerOddzial.reduce((s, o) => s + o.bez_kursu, 0)}</TableCell>
                  <TableCell>{Math.round(zleceniaPerOddzial.reduce((s, o) => s + o.suma_kg, 0))} kg</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Alert: zlecenia bez kursu */}
      {zleceniaBezKursu.length > 0 && (
        <div className="rounded-[10px] border p-4" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
          <p className="font-semibold text-sm mb-2">
            ⚠️ {zleceniaBezKursu.length} zleceń bez przypisanego kursu
          </p>
          <div className="space-y-1">
            {zleceniaBezKursu.slice(0, 5).map(z => (
              <p key={z.id} className="text-xs">
                {z.numer} · {z.typ_pojazdu || '—'} · {z.oddzial} · {z.dzien} · {Math.round(z.suma_kg)} kg
              </p>
            ))}
            {zleceniaBezKursu.length > 5 && (
              <p className="text-xs text-muted-foreground">
                + {zleceniaBezKursu.length - 5} kolejnych zleceń
              </p>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="text-[10px] text-muted-foreground">
        Ostatnia aktualizacja: {formatTime(lastUpdated)}
      </p>
    </div>
  );
}

function MetricCard({ value, label, icon, valueClass = '' }: {
  value: number; label: string; icon: string; valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-lg mb-1">{icon}</p>
        <p className={`text-[32px] font-bold text-primary leading-none ${valueClass}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}
