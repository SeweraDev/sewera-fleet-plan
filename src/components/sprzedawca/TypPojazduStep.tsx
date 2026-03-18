import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TypPojazduStepProps {
  oddzialId: number | null;
  setOddzialId: (v: number | null) => void;
  typPojazdu: string;
  setTypPojazdu: (v: string) => void;
  oddzialy: { id: number; nazwa: string }[];
  loadingOddzialy: boolean;
  flota: { typ: string }[];
  loadingFlota: boolean;
  onNext: () => void;
}

export function TypPojazduStep({
  oddzialId, setOddzialId,
  typPojazdu, setTypPojazdu,
  oddzialy, loadingOddzialy,
  flota, loadingFlota,
  onNext,
}: TypPojazduStepProps) {
  const uniqueTypes = [...new Set(flota.map(f => f.typ))];

  return (
    <div className="space-y-4">
      <div>
        <Label>Oddział</Label>
        <Select onValueChange={v => setOddzialId(Number(v))} value={oddzialId?.toString() || ''}>
          <SelectTrigger><SelectValue placeholder={loadingOddzialy ? 'Ładowanie...' : 'Wybierz oddział'} /></SelectTrigger>
          <SelectContent>
            {oddzialy.map(o => <SelectItem key={o.id} value={o.id.toString()}>{o.nazwa}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Typ pojazdu</Label>
        {loadingFlota ? (
          <p className="text-sm text-muted-foreground py-2">Ładowanie floty...</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {/* Bez preferencji - full width */}
            <button
              type="button"
              onClick={() => setTypPojazdu('bez_preferencji')}
              className={cn(
                'col-span-2 flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-left transition-colors',
                typPojazdu === 'bez_preferencji'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-muted-foreground/30 hover:border-muted-foreground/50'
              )}
            >
              <span className="text-xl">🔀</span>
              <div>
                <div className="font-medium text-sm">Bez preferencji</div>
                <div className="text-xs text-muted-foreground">Dyspozytor dobierze auto</div>
              </div>
            </button>

            {uniqueTypes.map(typ => (
              <button
                key={typ}
                type="button"
                onClick={() => setTypPojazdu(typ)}
                className={cn(
                  'rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors',
                  typPojazdu === typ
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-muted-foreground/50'
                )}
              >
                {typ}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setTypPojazdu('zewnetrzny')}
              className={cn(
                'rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors',
                typPojazdu === 'zewnetrzny'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-muted-foreground/50'
              )}
            >
              Zewnętrzny
            </button>
          </div>
        )}
      </div>

      <Button onClick={onNext} disabled={!oddzialId || !typPojazdu}>Dalej →</Button>
    </div>
  );
}
