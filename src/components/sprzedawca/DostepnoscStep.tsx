import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSprawdzDostepnosc, pctColor, pctBg } from '@/hooks/useSprawdzDostepnosc';
import type { VehicleOccupancy } from '@/hooks/useSprawdzDostepnosc';
import type { WzInput } from '@/hooks/useCreateZlecenie';

interface DostepnoscStepProps {
  oddzialId: number;
  typPojazdu: string;
  dzien: string;
  wzList: WzInput[];
  onBack: () => void;
  onSubmit: (forceVerify: boolean) => void;
  onChangeDzien?: (dzien: string) => void;
  submitting: boolean;
}

function OccupancyBar({ label, pct, value, max }: { label: string; pct: number; value: number; max: number | null }) {
  if (!max) return null;
  const clampedPct = Math.min(pct, 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={pctColor(pct)}>
          {Math.round(value)} / {max} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pctBg(pct)}`}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
    </div>
  );
}

function VehicleCard({ v }: { v: VehicleOccupancy }) {
  const warn = v.pct_kg >= 90 || v.pct_m3 >= 90 || v.pct_palet >= 90;

  return (
    <Card className={`p-3 space-y-2 ${v.fits ? 'border-border' : 'border-destructive/50 bg-destructive/5'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{v.nr_rej}</span>
          <span className="text-xs text-muted-foreground">{v.typ}</span>
        </div>
        {v.fits ? (
          warn ? (
            <Badge variant="outline" className="bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-[10px]">
              ! >=90%
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px]">
              Wolne
            </Badge>
          )
        ) : (
          <Badge variant="destructive" className="text-[10px]">Brak miejsca</Badge>
        )}
      </div>
      <OccupancyBar label="Waga" pct={v.pct_kg} value={v.used_kg} max={v.ladownosc_kg} />
      <OccupancyBar label="Obj." pct={v.pct_m3} value={v.used_m3} max={v.objetosc_m3} />
      <OccupancyBar label="Pal." pct={v.pct_palet} value={v.used_palet} max={v.max_palet} />
    </Card>
  );
}

export function DostepnoscStep({
  oddzialId,
  typPojazdu,
  dzien,
  wzList,
  onBack,
  onSubmit,
  onChangeDzien,
  submitting,
}: DostepnoscStepProps) {
  const { vehicles, anyFits, loading, nextAvailable, searchingNext, check } = useSprawdzDostepnosc();

  const totalKg = wzList.reduce((s, w) => s + (w.masa_kg || 0), 0);
  const totalM3 = wzList.reduce((s, w) => s + (Number(w.objetosc_m3) || 0), 0);
  const totalPalet = wzList.reduce((s, w) => s + (w.ilosc_palet || 0), 0);

  useEffect(() => {
    if (oddzialId && dzien) {
      check(oddzialId, typPojazdu, dzien, totalKg, totalM3, totalPalet);
    }
  }, [oddzialId, typPojazdu, dzien, totalKg, totalM3, totalPalet, check]);

  if (loading) {
    return <p className="text-center text-muted-foreground py-8">Sprawdzanie dostepnosci floty...</p>;
  }

  const isExternalOrNoPref = !typPojazdu || typPojazdu === 'bez_preferencji' || typPojazdu === 'zewnetrzny';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 bg-muted/30">
        <p className="text-xs font-medium text-muted-foreground mb-1">Podsumowanie ladunku</p>
        <div className="flex gap-4 text-sm">
          <span>Waga: {totalKg} kg</span>
          {totalM3 > 0 && <span>Obj: {totalM3.toFixed(2)} m3</span>}
          {totalPalet > 0 && <span>Pal: {totalPalet}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Dzien: {dzien} | Typ: {typPojazdu || 'bez preferencji'}
        </p>
      </div>

      {isExternalOrNoPref ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">
            Typ "{typPojazdu || 'bez preferencji'}" -- dyspozytor dobierze pojazd.
          </p>
          <div className="flex gap-2 mt-4 justify-center">
            <Button variant="outline" onClick={onBack}>Wstecz</Button>
            <Button onClick={() => onSubmit(false)} disabled={submitting}>
              {submitting ? 'Wysylanie...' : 'Zloz zlecenie'}
            </Button>
          </div>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">Brak pojazdow typu "{typPojazdu}" w tym oddziale.</p>
          <div className="flex gap-2 mt-4 justify-center">
            <Button variant="outline" onClick={onBack}>Zmien typ / termin</Button>
            <Button variant="secondary" onClick={() => onSubmit(true)} disabled={submitting}>
              {submitting ? 'Wysylanie...' : 'Zloz mimo to (do weryfikacji)'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-muted-foreground">
            Dostepnosc pojazdow ({vehicles.filter(v => v.fits).length}/{vehicles.length} wolnych)
          </p>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {vehicles.map(v => <VehicleCard key={v.flota_id} v={v} />)}
          </div>

          {anyFits ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={onBack}>Wstecz</Button>
              <Button onClick={() => onSubmit(false)} disabled={submitting}>
                {submitting ? 'Wysylanie...' : 'Zloz zlecenie'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">
                  Zaden pojazd typu "{typPojazdu}" nie ma wystarczajacej pojemnosci na {dzien}.
                </p>
              </div>

              {/* Sugestia nastepnego wolnego terminu */}
              {searchingNext && (
                <div className="rounded-lg border p-3 bg-blue-50 dark:bg-blue-900/20">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Szukam najblizszego wolnego terminu...
                  </p>
                </div>
              )}

              {nextAvailable && (
                <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 p-3 space-y-2">
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    Najblizszy wolny termin:
                  </p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-semibold">{nextAvailable.dzien}</span>
                    <span className="font-mono">{nextAvailable.nr_rej}</span>
                    <span className="text-muted-foreground">{nextAvailable.typ}</span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className={pctColor(nextAvailable.pct_kg)}>Waga: {nextAvailable.pct_kg}%</span>
                    {nextAvailable.pct_m3 > 0 && <span className={pctColor(nextAvailable.pct_m3)}>Obj: {nextAvailable.pct_m3}%</span>}
                    {nextAvailable.pct_palet > 0 && <span className={pctColor(nextAvailable.pct_palet)}>Pal: {nextAvailable.pct_palet}%</span>}
                  </div>
                  {onChangeDzien && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-green-400 text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900/40"
                      onClick={() => onChangeDzien(nextAvailable.dzien)}
                    >
                      Uzyj tego terminu ({nextAvailable.dzien})
                    </Button>
                  )}
                </div>
              )}

              {!searchingNext && !nextAvailable && (
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">
                    Brak wolnych terminow w ciagu najblizszych 14 dni roboczych.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={onBack}>Zmien recznie</Button>
                <Button variant="secondary" onClick={() => onSubmit(true)} disabled={submitting}>
                  {submitting ? 'Wysylanie...' : 'Zloz mimo to (do weryfikacji)'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
