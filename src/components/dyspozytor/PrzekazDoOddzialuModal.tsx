import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOddzialy } from '@/hooks/useOddzialy';
import { usePrzekazZlecenie } from '@/hooks/usePrzekazZlecenie';

interface Props {
  zlecenieId: string | null;
  zlecenieNumer?: string | null;
  obecnyOddzialId: number | null;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}

export function PrzekazDoOddzialuModal({ zlecenieId, zlecenieNumer, obecnyOddzialId, open, onClose, onDone }: Props) {
  const { oddzialy } = useOddzialy();
  const { przekaz, submitting } = usePrzekazZlecenie(() => {
    onDone?.();
    onClose();
  });
  const [docelowy, setDocelowy] = useState<string>('');

  useEffect(() => {
    if (open) setDocelowy('');
  }, [open]);

  const dostepne = oddzialy.filter(o => o.id !== obecnyOddzialId);
  const obecnyNazwa = oddzialy.find(o => o.id === obecnyOddzialId)?.nazwa || '—';

  const handleSubmit = () => {
    if (!zlecenieId || !docelowy) return;
    przekaz(zlecenieId, Number(docelowy));
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Przekaż zlecenie do innego oddziału</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm">
            <div className="text-muted-foreground">Zlecenie</div>
            <div className="font-mono font-medium">{zlecenieNumer || '—'}</div>
          </div>

          <div className="text-sm">
            <div className="text-muted-foreground">Obecny oddział</div>
            <div className="font-medium">{obecnyNazwa}</div>
          </div>

          <div>
            <Label>Przekaż do</Label>
            <Select value={docelowy} onValueChange={setDocelowy}>
              <SelectTrigger><SelectValue placeholder="Wybierz oddział docelowy" /></SelectTrigger>
              <SelectContent>
                {dostepne.map(o => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.nazwa}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Zlecenie zostanie przeniesione do wybranego oddziału. Jeśli było przypisane do kursu — zostanie z niego odpięte. Numer zlecenia pozostaje bez zmian.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Anuluj</Button>
          <Button onClick={handleSubmit} disabled={!docelowy || submitting}>
            {submitting ? 'Przekazywanie...' : '↗ Przekaż'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
