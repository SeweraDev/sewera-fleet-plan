import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useKierowcyStatusDnia, type KierowcaStatusDto } from '@/hooks/useKierowcyStatusDnia';
import { useKalendarzFloty, type KursKalendarzDto } from '@/hooks/useKalendarzFloty';
import { useBlokady } from '@/hooks/useBlokady';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';

function formatDayHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return { day: days[d.getDay()], date: `${dd}.${mm}` };
}

function KursCell({
  kurs,
  blocked,
  onToggle,
}: {
  kurs: KursKalendarzDto | undefined;
  blocked: boolean;
  onToggle: () => void;
}) {
  // Has a kurs — show status badge (not clickable for toggle)
  if (kurs) {
    switch (kurs.status) {
      case 'zaplanowany':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-[10px] px-1.5">
            {kurs.numer || 'plan'}
          </Badge>
        );
      case 'aktywny':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-[10px] px-1.5">
            w trasie
          </Badge>
        );
      case 'zakończony':
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-[10px] px-1.5">
            ✓
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {kurs.status}
          </Badge>
        );
    }
  }

  // No kurs — toggleable cell
  if (blocked) {
    return (
      <button
        onClick={onToggle}
        className="w-full h-full flex items-center justify-center text-red-600 dark:text-red-400 hover:opacity-70 transition-opacity cursor-pointer"
        title="Kliknij aby odblokować"
      >
        🔒
      </button>
    );
  }

  return (
    <button
      onClick={onToggle}
      className="w-full h-full flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors cursor-pointer"
      title="Kliknij aby zablokować"
    >
      ·
    </button>
  );
}

function KalendarzTab({
  flota,
  kierowcy,
  kursy,
  businessDays,
  loading,
  isBlocked,
  onToggle,
}: {
  flota: Pojazd[];
  kierowcy: KierowcaStatusDto[];
  kursy: KursKalendarzDto[];
  businessDays: string[];
  loading: boolean;
  isBlocked: (typ: string, zasobId: string, dzien: string) => boolean;
  onToggle: (typ: string, zasobId: string, dzien: string) => void;
}) {
  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Ładowanie kalendarza...</p>;
  }

  const flotaKursy = new Map<string, Map<string, KursKalendarzDto>>();
  const kierowcaKursy = new Map<string, Map<string, KursKalendarzDto>>();

  kursy.forEach(k => {
    if (k.flota_id) {
      if (!flotaKursy.has(k.flota_id)) flotaKursy.set(k.flota_id, new Map());
      flotaKursy.get(k.flota_id)!.set(k.dzien, k);
    }
    if (k.kierowca_id) {
      if (!kierowcaKursy.has(k.kierowca_id)) kierowcaKursy.set(k.kierowca_id, new Map());
      kierowcaKursy.get(k.kierowca_id)!.set(k.dzien, k);
    }
  });

  const today = new Date().toISOString().split('T')[0];

  const renderDayHeaders = () =>
    businessDays.map(d => {
      const { day, date } = formatDayHeader(d);
      return (
        <TableHead key={d} className={`text-center min-w-[70px] ${d === today ? 'bg-accent/50' : ''}`}>
          <div className="text-[10px] text-muted-foreground">{day}</div>
          <div className="text-xs">{date}</div>
        </TableHead>
      );
    });

  return (
    <div className="space-y-6">
      {/* Vehicles calendar */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">🚛 Pojazdy</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-10 min-w-[140px]">Pojazd</TableHead>
                {renderDayHeaders()}
              </TableRow>
            </TableHeader>
            <TableBody>
              {flota.map(f => (
                <TableRow key={f.id}>
                  <TableCell className="sticky left-0 bg-background z-10 font-mono text-xs">
                    {f.nr_rej}
                    <span className="text-muted-foreground ml-1 text-[10px]">{f.typ}</span>
                  </TableCell>
                  {businessDays.map(d => {
                    const kurs = flotaKursy.get(f.id)?.get(d);
                    const blocked = isBlocked('pojazd', f.id, d);
                    return (
                      <TableCell
                        key={d}
                        className={`text-center p-1 ${d === today ? 'bg-accent/30' : ''} ${blocked && !kurs ? 'bg-red-50 dark:bg-red-950/30' : ''}`}
                      >
                        <KursCell
                          kurs={kurs}
                          blocked={blocked}
                          onToggle={() => onToggle('pojazd', f.id, d)}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Drivers calendar */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">👤 Kierowcy</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-10 min-w-[140px]">Kierowca</TableHead>
                {renderDayHeaders()}
              </TableRow>
            </TableHeader>
            <TableBody>
              {kierowcy.map(k => (
                <TableRow key={k.id}>
                  <TableCell className="sticky left-0 bg-background z-10 text-xs font-medium">
                    {k.imie_nazwisko}
                  </TableCell>
                  {businessDays.map(d => {
                    const kurs = kierowcaKursy.get(k.id)?.get(d);
                    const blocked = isBlocked('kierowca', k.id, d);
                    return (
                      <TableCell
                        key={d}
                        className={`text-center p-1 ${d === today ? 'bg-accent/30' : ''} ${blocked && !kurs ? 'bg-red-50 dark:bg-red-950/30' : ''}`}
                      >
                        <KursCell
                          kurs={kurs}
                          blocked={blocked}
                          onToggle={() => onToggle('kierowca', k.id, d)}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export function FlotaSection({
  oddzialId,
  flota,
  oddzialy,
}: {
  oddzialId: number | null;
  flota: Pojazd[];
  oddzialy: { id: number; nazwa: string }[];
}) {
  const { kierowcy, loading: loadingKierowcy } = useKierowcyStatusDnia(oddzialId);
  const { kursy, businessDays, loading: loadingKalendarz } = useKalendarzFloty(oddzialId);
  const { isBlocked, toggleBlokada } = useBlokady(oddzialId, businessDays);
  const oddzialNazwa = oddzialy.find(o => o.id === oddzialId)?.nazwa || '';

  return (
    <Tabs defaultValue="pojazdy">
      <TabsList>
        <TabsTrigger value="pojazdy">🚛 Pojazdy</TabsTrigger>
        <TabsTrigger value="kierowcy">👤 Kierowcy</TabsTrigger>
        <TabsTrigger value="kalendarz">📅 Kalendarz</TabsTrigger>
      </TabsList>

      <TabsContent value="pojazdy" className="mt-4">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">🚛 Flota — {oddzialNazwa}</h2>
          {flota.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">Brak pojazdów</CardContent></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nr rejestracyjny</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Ładowność (kg)</TableHead>
                  <TableHead className="text-right">Objętość (m³)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flota.map(f => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono">{f.nr_rej}</TableCell>
                    <TableCell>{f.typ}</TableCell>
                    <TableCell className="text-right">{f.ladownosc_kg}</TableCell>
                    <TableCell className="text-right">{f.objetosc_m3}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </TabsContent>

      <TabsContent value="kierowcy" className="mt-4">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">👤 Kierowcy — {oddzialNazwa}</h2>
          {loadingKierowcy ? (
            <p className="text-muted-foreground text-center py-4">Ładowanie kierowców...</p>
          ) : kierowcy.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">Brak kierowców</CardContent></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Imię i nazwisko</TableHead>
                  <TableHead>Uprawnienia</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Status dziś</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kierowcy.map(k => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.imie_nazwisko}</TableCell>
                    <TableCell>{k.uprawnienia || '—'}</TableCell>
                    <TableCell>{k.tel || '—'}</TableCell>
                    <TableCell>
                      {k.kurs_status ? (
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          W kursie {k.kurs_numer || ''}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          Dostępny
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </TabsContent>

      <TabsContent value="kalendarz" className="mt-4">
        <KalendarzTab
          flota={flota}
          kierowcy={kierowcy}
          kursy={kursy}
          businessDays={businessDays}
          loading={loadingKalendarz || loadingKierowcy}
          isBlocked={isBlocked}
          onToggle={toggleBlokada}
        />
      </TabsContent>
    </Tabs>
  );
}
