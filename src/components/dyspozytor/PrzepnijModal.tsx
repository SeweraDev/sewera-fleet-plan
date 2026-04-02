import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { KursDto, PrzystanekDto } from '@/hooks/useKursyDnia';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';
import type { Kierowca } from '@/hooks/useKierowcyOddzialu';

interface Props {
  open: boolean;
  onClose: () => void;
  przystanek: PrzystanekDto | null;
  currentKurs: KursDto | null;
  allKursy: KursDto[];
  allPrzystanki: PrzystanekDto[];
  oddzialId: number | null;
  dzien: string;
  flota: Pojazd[];
  kierowcy: Kierowca[];
  onDone: () => void;
}

// Auto-usuń kurs jeśli nie ma żadnych przystanków
async function autoDeleteEmptyKurs(kursId: string) {
  const { data } = await supabase
    .from('kurs_przystanki')
    .select('id')
    .eq('kurs_id', kursId)
    .limit(1);
  if (!data || data.length === 0) {
    await supabase.from('kursy').delete().eq('id', kursId);
    console.log(`[autoDelete] Pusty kurs ${kursId} usunięty`);
  }
}

export function PrzepnijModal({ open, onClose, przystanek, currentKurs, allKursy, allPrzystanki, oddzialId, dzien, flota, kierowcy, onDone }: Props) {
  const [targetKursId, setTargetKursId] = useState('');
  const [createNew, setCreateNew] = useState(false);
  const [newFlotaId, setNewFlotaId] = useState('');
  const [newKierowcaId, setNewKierowcaId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTargetKursId('');
      setCreateNew(false);
      setNewFlotaId('');
      setNewKierowcaId('');
    }
  }, [open]);

  const eligibleKursy = allKursy.filter(
    k => k.id !== currentKurs?.id && (k.status === 'zaplanowany' || k.status === 'aktywny')
  );

  const handleSubmit = async () => {
    if (!przystanek || !currentKurs || !oddzialId) return;
    setSubmitting(true);

    if (createNew) {
      // Create new kurs
      const selectedKierowca = kierowcy.find(k => k.id === newKierowcaId);
      const { data: newKurs, error: e1 } = await supabase
        .from('kursy')
        .insert({
          oddzial_id: oddzialId,
          dzien,
          flota_id: newFlotaId || null,
          kierowca_id: newKierowcaId || null,
          kierowca_nazwa: selectedKierowca?.imie_nazwisko || null,
          status: 'zaplanowany',
        })
        .select('id, numer')
        .single();

      if (e1 || !newKurs) {
        toast.error('Błąd tworzenia kursu: ' + (e1?.message || ''));
        setSubmitting(false);
        return;
      }

      const { error: e2 } = await supabase
        .from('kurs_przystanki')
        .update({ kurs_id: newKurs.id })
        .eq('zlecenie_id', przystanek.zlecenie_id!)
        .eq('kurs_id', currentKurs.id);

      if (e2) {
        toast.error('Błąd przepinania: ' + e2.message);
      } else {
        toast.success(`Nowy kurs ${newKurs.numer || ''} utworzony`);
        // Auto-usuń stary kurs jeśli pusty
        await autoDeleteEmptyKurs(currentKurs.id);
        onDone();
        onClose();
      }
    } else {
      // Move to existing kurs
      if (!targetKursId) { setSubmitting(false); return; }

      const { error } = await supabase
        .from('kurs_przystanki')
        .update({ kurs_id: targetKursId })
        .eq('zlecenie_id', przystanek.zlecenie_id!)
        .eq('kurs_id', currentKurs.id);

      if (error) {
        toast.error('Błąd przepinania: ' + error.message);
      } else {
        const target = allKursy.find(k => k.id === targetKursId);
        toast.success(`Zlecenie przepięte do ${target?.numer || target?.nr_rej || 'kursu'}`);
        // Auto-usuń stary kurs jeśli pusty
        await autoDeleteEmptyKurs(currentKurs.id);
        onDone();
        onClose();
      }
    }

    setSubmitting(false);
  };

  if (!przystanek || !currentKurs) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Przepnij {przystanek.zl_numer}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Obecny kurs: <span className="font-medium text-foreground">{currentKurs.numer || '—'} · {currentKurs.nr_rej}</span>
          </p>

          {/* Option A: existing kurs */}
          <div>
            <Label className="mb-2 block">Przepnij do istniejącego kursu</Label>
            <Select value={targetKursId} onValueChange={v => { setTargetKursId(v); setCreateNew(false); }} disabled={createNew}>
              <SelectTrigger><SelectValue placeholder="Wybierz kurs" /></SelectTrigger>
              <SelectContent>
                {eligibleKursy.map(k => {
                  const stopCount = allPrzystanki.filter(p => p.kurs_id === k.id).length;
                  return (
                    <SelectItem key={k.id} value={k.id}>
                      {k.numer || '—'} · {k.nr_rej} · {k.pojazd_typ} · {stopCount} rozładunków
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {eligibleKursy.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Brak innych kursów na ten dzień</p>
            )}
          </div>

          {/* Option B: create new */}
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCreateNew(!createNew)}>
              <Checkbox checked={createNew} />
              <Label className="cursor-pointer">Utwórz nowy kurs</Label>
            </div>
            {createNew && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Pojazd</Label>
                  <Select value={newFlotaId} onValueChange={setNewFlotaId}>
                    <SelectTrigger><SelectValue placeholder="Pojazd" /></SelectTrigger>
                    <SelectContent>
                      {flota.map(f => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.nr_rej} · {f.typ}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Kierowca</Label>
                  <Select value={newKierowcaId} onValueChange={setNewKierowcaId}>
                    <SelectTrigger><SelectValue placeholder="Kierowca" /></SelectTrigger>
                    <SelectContent>
                      {kierowcy.map(k => (
                        <SelectItem key={k.id} value={k.id}>{k.imie_nazwisko}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button onClick={handleSubmit} disabled={submitting || (!createNew && !targetKursId)}>
            {submitting ? 'Przepinanie...' : '🔀 Przepnij'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
