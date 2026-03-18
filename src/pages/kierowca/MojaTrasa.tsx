import { Topbar } from '@/components/shared/Topbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useMojeKursyDzis } from '@/hooks/useMojeKursyDzis';
import { useKursActions } from '@/hooks/useKursActions';

function formatDate() {
  const d = new Date();
  const days = ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${day} ${dd}.${mm}`;
}

export default function KierowcaMojaTrasa() {
  const { kursy, loading, refetch } = useMojeKursyDzis();
  const { handleStart, handleStop, handlePrzystanek, acting } = useKursActions(refetch);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <main className="flex-1 w-full max-w-[480px] mx-auto px-5 py-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-foreground">🚛 Moje kursy</h1>
          <span className="text-sm text-muted-foreground">{formatDate()}</span>
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Ładowanie...</p>
        ) : kursy.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              Brak kursów na dziś
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {kursy.map(kurs => {
              const allDone = kurs.przystanki.length > 0 && kurs.przystanki.every(p => p.status === 'dostarczone' || p.status === 'nieudane');
              const done = kurs.przystanki.filter(p => p.status === 'dostarczone').length;

              return (
                <Card key={kurs.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <span className="font-mono">{kurs.nr_rej}</span>
                        <StatusBadge status={kurs.status} />
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">{done}/{kurs.przystanki.length} przystanków</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {kurs.status === 'zaplanowany' && (
                        <Button size="sm" className="w-full" onClick={() => handleStart(kurs.id)} disabled={acting}>
                          🚀 Wyjeżdżam
                        </Button>
                      )}
                      {kurs.status === 'aktywny' && allDone && (
                        <Button size="sm" variant="secondary" className="w-full" onClick={() => handleStop(kurs.id)} disabled={acting}>
                          🏁 Wróciłem
                        </Button>
                      )}
                    </div>

                    {/* Przystanki */}
                    {kurs.przystanki.map(p => (
                      <div
                        key={p.id}
                        className={`p-3 rounded-lg border text-sm ${
                          p.status === 'dostarczone' ? 'bg-muted/50 opacity-60' : 'bg-card'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-0.5 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {p.status === 'dostarczone' ? '✅' : `📍 ${p.kolejnosc}.`} {p.odbiorca}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{p.adres}</p>
                            {p.tel && <p className="text-xs text-muted-foreground">📞 {p.tel}</p>}
                            <p className="text-xs">{p.masa_kg} kg {p.nr_wz ? `· WZ: ${p.nr_wz}` : ''}</p>
                            {p.uwagi && <p className="text-xs text-amber-600">⚠️ {p.uwagi}</p>}
                          </div>
                          {p.status === 'oczekuje' && kurs.status === 'aktywny' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrzystanek(p.id)}
                              disabled={acting}
                              className="shrink-0"
                            >
                              ✓ Dostarczyłem
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
