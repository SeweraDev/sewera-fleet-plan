import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useSprawdzDostepnosc, pctColor, pctBg, type VehicleOccupancy } from '@/hooks/useSprawdzDostepnosc';
import { useCostComparison } from '@/hooks/useCostComparison';
import type { WzInput } from '@/hooks/useCreateZlecenie';

/** Próg w zł netto — banner pojawia się gdy alternatywa jest tańsza o tyle. */
const COST_THRESHOLD_PLN = 30;

interface DostepnoscStepProps {
  oddzialId: number;
  /** Nazwa obecnego oddziału (np. "Gliwice") — do porównania kosztów alternatywnych. */
  oddzialNazwa: string;
  typPojazdu: string;
  dzien: string;
  godzina?: string;
  wzList: WzInput[];
  /** Lista wszystkich oddziałów (do mapowania nazwy → id przy zmianie). */
  oddzialy: { id: number; nazwa: string }[];
  onBack: () => void;
  onSubmit: (forceVerify: boolean) => void;
  submitting: boolean;
  onChangeDzien?: (newDzien: string) => void;
  onChangeGodzina?: (newGodzina: string) => void;
  /** Wraca do Kroku 1 z preselected nowym oddziałem (dane WZ pozostają). */
  onChangeOddzial?: (newOddzialId: number) => void;
}

function fmtPLN(v: number): string {
  return v.toFixed(2).replace('.', ',') + ' zł';
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
              ⚠️ ≥90%
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px]">
              ✅ Mieści się
            </Badge>
          )
        ) : (
          <Badge variant="destructive" className="text-[10px]">❌ Przekroczone</Badge>
        )}
      </div>
      <OccupancyBar label="Waga" pct={v.pct_kg} value={v.used_kg} max={v.ladownosc_kg} />
      <OccupancyBar label="Objętość" pct={v.pct_m3} value={v.used_m3} max={v.objetosc_m3} />
      <OccupancyBar label="Palety" pct={v.pct_palet} value={v.used_palet} max={v.max_palet} />
    </Card>
  );
}

export function DostepnoscStep({
  oddzialId,
  oddzialNazwa,
  typPojazdu,
  dzien,
  godzina,
  wzList,
  oddzialy,
  onBack,
  onSubmit,
  submitting,
  onChangeDzien,
  onChangeGodzina,
  onChangeOddzial,
}: DostepnoscStepProps) {
  const { vehicles, anyFits, loading, check, nextAvailable, searchingNext, freeSlots } = useSprawdzDostepnosc();

  const totalKg = wzList.reduce((s, w) => s + (w.masa_kg || 0), 0);
  const totalM3 = wzList.reduce((s, w) => s + (Number(w.objetosc_m3) || 0), 0);
  const totalPalet = wzList.reduce((s, w) => s + (w.ilosc_palet || 0), 0);

  // Porównanie kosztów: bierzemy adres z PIERWSZEJ WZ-tki (zwykle wszystkie WZ jednego zlecenia
  // mają ten sam adres dostawy)
  const adresDostawy = wzList[0]?.adres || '';
  const cmp = useCostComparison(oddzialNazwa, typPojazdu, adresDostawy);

  useEffect(() => {
    if (oddzialId && dzien) {
      check(oddzialId, typPojazdu, dzien, totalKg, totalM3, totalPalet, godzina);
    }
  }, [oddzialId, typPojazdu, dzien, godzina, totalKg, totalM3, totalPalet, check]);

  if (loading) {
    return <p className="text-center text-muted-foreground py-8">Sprawdzanie dostępności floty...</p>;
  }

  const isExternalOrNoPref = !typPojazdu || typPojazdu === 'bez_preferencji' || typPojazdu === 'zewnetrzny';

  // Banner porównania kosztów: pokazuj tylko gdy istnieje tańsza alternatywa o > próg
  const showCostBanner = !!cmp.savings && cmp.savings >= COST_THRESHOLD_PLN && !!cmp.cheapest && !!cmp.current;
  const cheapestOddzialId = cmp.cheapest
    ? oddzialy.find(o => o.nazwa === cmp.cheapest!.oddzialNazwa)?.id
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 bg-muted/30">
        <p className="text-xs font-medium text-muted-foreground mb-1">Podsumowanie ładunku</p>
        <div className="flex gap-4 text-sm">
          <span>⚖️ {totalKg} kg</span>
          {totalM3 > 0 && <span>📐 {totalM3.toFixed(2)} m³</span>}
          {totalPalet > 0 && <span>📦 {totalPalet} palet</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Dzień: {dzien} · Typ: {typPojazdu || 'bez preferencji'}
        </p>
      </div>

      {/* Banner porównania kosztów — pokazujemy tylko gdy istnieje tańsza alternatywa */}
      {showCostBanner && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-lg">💡</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Inny oddział byłby tańszy o {fmtPLN(Math.round(cmp.savings!))}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                Adres dostawy jest bliżej oddziału {cmp.cheapest!.oddzialNazwa}. Możesz zmienić oddział
                z którego startuje zlecenie — dane WZ zostaną zachowane.
              </p>
            </div>
          </div>

          {/* Tabelka 3 najtańszych + obecny */}
          <div className="rounded border bg-white/70 dark:bg-black/20 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-2 py-1 font-medium">Oddział</th>
                  <th className="text-right px-2 py-1 font-medium">km</th>
                  <th className="text-right px-2 py-1 font-medium">Sewera (netto)</th>
                  <th className="text-right px-2 py-1 font-medium">Zewn. (netto)</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Pokaż top 3 + obecny (jeśli nie w top 3)
                  const top3 = cmp.rows.slice(0, 3);
                  const inTop3 = top3.some(r => r.isCurrent);
                  const visible = inTop3 ? top3 : [...top3, cmp.current!];
                  return visible.map((r, idx) => (
                    <tr
                      key={r.oddzialKod}
                      className={
                        r.isCurrent
                          ? 'bg-orange-100 dark:bg-orange-900/30 font-medium'
                          : idx === 0
                          ? 'bg-green-100 dark:bg-green-900/30'
                          : ''
                      }
                    >
                      <td className="px-2 py-1.5">
                        {idx === 0 && !r.isCurrent && '🟢 '}
                        {r.isCurrent && '📍 '}
                        {r.oddzialNazwa}
                        {r.isCurrent && <span className="text-muted-foreground"> (Twój)</span>}
                      </td>
                      <td className="text-right px-2 py-1.5 text-muted-foreground">{r.km} km</td>
                      <td className="text-right px-2 py-1.5">
                        {r.kosztWew ? fmtPLN(r.kosztWew.netto) : '—'}
                      </td>
                      <td className="text-right px-2 py-1.5">
                        {r.kosztZew ? fmtPLN(r.kosztZew.netto) : '—'}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 flex-wrap">
            {onChangeOddzial && cheapestOddzialId && (
              <Button
                size="sm"
                onClick={() => onChangeOddzial(cheapestOddzialId)}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                ← Zmień oddział na {cmp.cheapest!.oddzialNazwa}
              </Button>
            )}
            <p className="text-xs text-muted-foreground self-center">
              lub zignoruj i kontynuuj poniżej z {cmp.current!.oddzialNazwa}
            </p>
          </div>
        </div>
      )}

      {isExternalOrNoPref ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">
            Typ „{typPojazdu || 'bez preferencji'}" — dyspozytor dobierze pojazd.
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={onBack}>← Wstecz</Button>
            <Button onClick={() => onSubmit(false)} disabled={submitting}>
              {submitting ? 'Wysyłanie...' : '✅ Złóż zlecenie'}
            </Button>
          </div>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">Brak pojazdów typu „{typPojazdu}" w tym oddziale.</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={onBack}>← Zmień typ / termin</Button>
            <Button variant="secondary" onClick={() => onSubmit(true)} disabled={submitting}>
              {submitting ? 'Wysyłanie...' : '⚠️ Złóż mimo to (do weryfikacji)'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-muted-foreground">
            Dostępność pojazdów ({vehicles.filter(v => v.fits).length}/{vehicles.length} wolnych)
          </p>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {vehicles.map(v => <VehicleCard key={v.flota_id} v={v} />)}
          </div>

          {anyFits ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={onBack}>← Wstecz</Button>
              <Button onClick={() => onSubmit(false)} disabled={submitting}>
                {submitting ? 'Wysyłanie...' : '✅ Złóż zlecenie'}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 space-y-3">
              <p className="text-sm font-medium text-destructive">
                Żaden pojazd typu „{typPojazdu}" nie ma wystarczającej pojemności na {dzien}.
              </p>

              {/* Wolne przedziały na ten dzień */}
              {freeSlots.length > 0 && onChangeGodzina && (
                <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 p-3 space-y-2">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                    Wolne przedziały na {dzien}:
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {freeSlots.map(slot => (
                      <Button key={slot} size="sm" variant="outline"
                        className="border-yellow-400 text-yellow-700 hover:bg-yellow-100"
                        onClick={() => onChangeGodzina(slot)}>
                        {slot}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sugestia następnego wolnego terminu */}
              {searchingNext && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-3">
                  <p className="text-sm text-blue-700 dark:text-blue-300">Szukam najbliższego wolnego terminu...</p>
                </div>
              )}
              {nextAvailable && (
                <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-3 space-y-2">
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">
                    Najbliższy wolny termin: <strong>{nextAvailable.dzien}</strong>
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {nextAvailable.nr_rej} · {nextAvailable.typ} — {nextAvailable.pct_kg}% zajęte
                  </p>
                  {onChangeDzien && (
                    <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-100"
                      onClick={() => onChangeDzien(nextAvailable.dzien)}>
                      Użyj tego terminu ({nextAvailable.dzien})
                    </Button>
                  )}
                </div>
              )}
              {!searchingNext && !nextAvailable && (
                <p className="text-xs text-muted-foreground">Brak wolnych terminów w najbliższych 14 dniach roboczych.</p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={onBack}>
                  Zmień termin / pojazd
                </Button>
                <Button variant="secondary" onClick={() => onSubmit(true)} disabled={submitting}>
                  {submitting ? 'Wysyłanie...' : 'Złóż mimo to (do weryfikacji)'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
