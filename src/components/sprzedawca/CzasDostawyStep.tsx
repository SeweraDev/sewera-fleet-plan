import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useQuickAvailability } from '@/hooks/useQuickAvailability';

const TIME_OPTIONS = [
  'do 8:00',
  'do 10:00',
  'do 12:00',
  'do 14:00',
  'do 16:00',
  'Dowolna',
];

interface CzasDostawyStepProps {
  dzien: string;
  setDzien: (v: string) => void;
  godzina: string;
  setGodzina: (v: string) => void;
  /** Oddział (id) — potrzebny do sprawdzenia dostępności. */
  oddzialId: number | null;
  /** Typ pojazdu wybrany w kroku 1 — sprawdzamy dostępność tego typu. */
  typPojazdu: string;
  onBack: () => void;
  onNext: () => void;
  /** Smart Prefill — true gdy data wzięta z uwag WZ ("transport DD.MM.YYYY").
   *  Pomarańczowa ramka informuje sprzedawcę żeby zweryfikował. */
  dzienAutoSet?: boolean;
  /** Smart Prefill — true gdy godzina wzięta z uwag WZ ("godz. 8:00"). */
  godzinaAutoSet?: boolean;
}

function formatDayPL(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function CzasDostawyStep({
  dzien, setDzien,
  godzina, setGodzina,
  oddzialId, typPojazdu,
  onBack, onNext,
  dzienAutoSet,
  godzinaAutoSet,
}: CzasDostawyStepProps) {
  // Pomijamy quick check gdy user nie wybrał konkretnego typu (bez_preferencji / pusty)
  const isAnyType = !typPojazdu || typPojazdu === 'bez_preferencji';
  const avail = useQuickAvailability(oddzialId, isAnyType ? '' : typPojazdu, dzien);

  // 0 dostępnych = blokada na "Dalej" (chyba że user świadomie kliknie "Złóż mimo to")
  const brakDostepnosci = !isAnyType && !avail.loading && avail.totalCount > 0 && avail.availableCount === 0;

  return (
    <div className="space-y-4">
      <div>
        <Label>Dzień dostawy{dzienAutoSet && <span className="ml-2 text-[11px] text-orange-700 dark:text-orange-400 font-normal">🟠 auto z uwag WZ — sprawdź</span>}</Label>
        <Input type="date" value={dzien} onChange={e => setDzien(e.target.value)} className={cn('w-56', dzienAutoSet && 'border-orange-400 bg-orange-50 dark:bg-orange-950/20 focus-visible:ring-orange-400')} />

        {/* Wskaźnik dostępności pod polem dnia — tylko gdy typ konkretny i dzień wybrany */}
        {!isAnyType && dzien && !avail.loading && avail.totalCount > 0 && (
          <div className="mt-2">
            {avail.availableCount > 0 ? (
              <div className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5">
                <span>✅</span>
                <span>
                  <strong>{avail.availableCount}</strong> {avail.availableCount === 1 ? 'auto dostępne' : avail.availableCount < 5 ? 'auta dostępne' : 'aut dostępnych'} typu {typPojazdu}
                  {avail.blocked.length > 0 && (
                    <span className="text-muted-foreground"> ({avail.blocked.length} zablokowanych)</span>
                  )}
                </span>
              </div>
            ) : (
              <div className="rounded-lg border-2 border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-700 p-3 space-y-2">
                <div className="text-sm font-semibold text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>Brak dostępnych aut typu „{typPojazdu}" w dniu {formatDayPL(dzien)}</span>
                </div>
                <ul className="text-xs text-orange-700 dark:text-orange-300 space-y-0.5 ml-6 list-disc">
                  {avail.blocked.map(b => (
                    <li key={b.flota_id}>
                      <strong className="font-mono">{b.nr_rej}</strong> — zablokowany do {formatDayPL(b.zablokowany_do)}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Możesz złożyć zlecenie mimo to — dyspozytor zaplanuje je ręcznie (np. innym typem auta, transportem zewnętrznym lub przeniesie na inny dzień).
                </p>
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {!isAnyType && dzien && avail.loading && (
          <div className="mt-2 text-xs text-muted-foreground">Sprawdzam dostępność...</div>
        )}

        {/* Brak floty tego typu w oddziale */}
        {!isAnyType && dzien && !avail.loading && avail.totalCount === 0 && (
          <div className="mt-2 text-sm text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Twój oddział nie ma aut typu „{typPojazdu}" — zlecenie wymaga transportu zewnętrznego lub innego oddziału.</span>
          </div>
        )}
      </div>

      <div>
        <Label>Preferowana godzina{godzinaAutoSet && <span className="ml-2 text-[11px] text-orange-700 dark:text-orange-400 font-normal">🟠 auto z uwag WZ — sprawdź</span>}</Label>
        <div className="flex flex-col gap-2 mt-2">
          {TIME_OPTIONS.map(opt => {
            const isSelected = (godzina || '').toLowerCase() === opt.toLowerCase();
            const highlightAuto = godzinaAutoSet && isSelected;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setGodzina(opt)}
                className={cn(
                  'w-full h-12 rounded-lg border-2 text-sm font-medium transition-colors text-left px-4',
                  highlightAuto
                    ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20 text-orange-800 dark:text-orange-300'
                    : isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-muted-foreground/50'
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Godzina jest wskazówką dla dyspozytora</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>← Wstecz</Button>
        {brakDostepnosci ? (
          <Button
            onClick={onNext}
            disabled={!dzien || !godzina}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            Złóż mimo to →
          </Button>
        ) : (
          <Button onClick={onNext} disabled={!dzien || !godzina}>
            Dalej →
          </Button>
        )}
      </div>
    </div>
  );
}
