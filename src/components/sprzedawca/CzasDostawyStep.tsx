import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  onBack: () => void;
  onNext: () => void;
}

export function CzasDostawyStep({
  dzien, setDzien,
  godzina, setGodzina,
  onBack, onNext,
}: CzasDostawyStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Dzień dostawy</Label>
        <Input type="date" value={dzien} onChange={e => setDzien(e.target.value)} />
      </div>
      <div>
        <Label>Preferowana godzina</Label>
        <div className="flex flex-col gap-2 mt-2">
          {TIME_OPTIONS.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => setGodzina(opt)}
              className={cn(
                'w-full h-12 rounded-lg border-2 text-sm font-medium transition-colors text-left px-4',
                godzina === opt
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-muted-foreground/50'
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Godzina jest wskazówką dla dyspozytora</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>← Wstecz</Button>
        <Button onClick={onNext} disabled={!dzien || !godzina}>Dalej →</Button>
      </div>
    </div>
  );
}
