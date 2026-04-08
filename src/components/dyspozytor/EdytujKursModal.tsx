import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { KursDto } from '@/hooks/useKursyDnia';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';
import type { Kierowca } from '@/hooks/useKierowcyOddzialu';

interface Props {
  open: boolean;
  onClose: () => void;
  kurs: KursDto | null;
  dzien: string;
  oddzialId: number | null;
  flota: Pojazd[];
  kierowcy: Kierowca[];
  przystankiCount: number;
  onSaved: () => void;
  isBlocked?: (typ: string, zasobId: string, dzien: string) => boolean;
}

const STATUS_OPTIONS = [
  { value: 'zaplanowany', label: 'Zaplanowany' },
  { value: 'aktywny', label: 'Aktywny' },
  { value: 'zakonczony', label: 'Zakończony' },
];

export function EdytujKursModal({ open, onClose, kurs, dzien, oddzialId, flota, kierowcy, przystankiCount, onSaved, isBlocked }: Props) {
  const [flotaId, setFlotaId] = useState('');
  const [kierowcaId, setKierowcaId] = useState('');
  const [editDzien, setEditDzien] = useState(dzien);
  const [status, setStatus] = useState('zaplanowany');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && kurs) {
      // Find flota_id from nr_rej match (own or external)
      const matchedFlota = flota.find(f => f.nr_rej_raw === kurs.nr_rej || f.nr_rej === kurs.nr_rej);
      setFlotaId(matchedFlota?.id || '');
      setKierowcaId(kurs.kierowca_id || '');
      setEditDzien(dzien);
      setStatus(kurs.status);
    }
  }, [open, kurs, flota, dzien]);

  const availableFlota = isBlocked
    ? flota.filter(f => f.id === flotaId || !isBlocked('pojazd', f.id, editDzien))
    : flota;

  const availableKierowcy = isBlocked
    ? kierowcy.filter(k => k.id === kierowcaId || !isBlocked('kierowca', k.id, editDzien))
    : kierowcy;

  const handleSave = async () => {
    if (!kurs) return;
    setSaving(true);

    const selectedVehicle = flota.find(f => f.id === flotaId);
    const isZew = selectedVehicle?.jest_zewnetrzny;

    const updates: Record<string, any> = {
      flota_id: isZew ? null : (flotaId || null),
      nr_rej_zewn: isZew ? (selectedVehicle?.nr_rej_raw || null) : null,
      kierowca_id: kierowcaId || null,
      dzien: editDzien,
      status,
    };

    const selectedKierowca = kierowcy.find(k => k.id === kierowcaId);
    updates.kierowca_nazwa = selectedKierowca?.imie_nazwisko || null;

    const { error } = await supabase
      .from('kursy')
      .update(updates)
      .eq('id', kurs.id);

    if (error) {
      toast.error('Błąd: ' + error.message);
    } else {
      toast.success('✅ Kurs zaktualizowany');
      onSaved();
      onClose();
    }
    setSaving(false);
  };

  if (!kurs) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edytuj kurs {kurs.numer || ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Read-only info */}
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Numer kursu: <span className="font-mono font-medium text-foreground">{kurs.numer || '—'}</span></p>
            <p>Rozładunki: <span className="font-medium text-foreground">{przystankiCount}</span></p>
          </div>

          <div>
            <Label>Pojazd</Label>
            <Select value={flotaId} onValueChange={setFlotaId}>
              <SelectTrigger><SelectValue placeholder="Wybierz pojazd" /></SelectTrigger>
              <SelectContent>
                {availableFlota.map(f => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.nr_rej} · {f.typ} · do {Math.round(f.ladownosc_kg)} kg{f.max_palet != null ? ` · ${f.max_palet} pal` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Kierowca</Label>
            <Select value={kierowcaId} onValueChange={setKierowcaId}>
              <SelectTrigger><SelectValue placeholder="Wybierz kierowcę" /></SelectTrigger>
              <SelectContent>
                {availableKierowcy.map(k => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.imie_nazwisko} · {k.uprawnienia || '—'}{k.tel ? ` · 📞 ${k.tel}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Dzień</Label>
            <Input type="date" value={editDzien} onChange={e => setEditDzien(e.target.value)} />
          </div>

          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
