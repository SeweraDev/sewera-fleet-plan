// Modal do edycji km kółka dla kursa zakończonego.
// Pozwala dyspozytorowi:
// - nadpisać km z drogomierza (`kursy.km_rozliczeniowe`) zamiast OSRM
// - dodać/usunąć odcinki techniczne (serwis, tankowanie itp.) — tabela `kurs_odcinki_techniczne`

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OdcinekTechniczny } from '@/hooks/useKursyDnia';

interface Props {
  kursId: string | null;
  open: boolean;
  onClose: () => void;
  kmOsrm: number | null;
  kmRozliczeniowe: number | null;
  odcinkiTech: OdcinekTechniczny[];
  onSaved: () => void;
}

export function EdytujKmModal({ kursId, open, onClose, kmOsrm, kmRozliczeniowe, odcinkiTech, onSaved }: Props) {
  const [kmValue, setKmValue] = useState<string>('');
  const [odcinki, setOdcinki] = useState<OdcinekTechniczny[]>([]);
  const [newOpis, setNewOpis] = useState('');
  const [newKm, setNewKm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKmValue(kmRozliczeniowe != null ? String(kmRozliczeniowe) : '');
    setOdcinki(odcinkiTech);
    setNewOpis('');
    setNewKm('');
  }, [open, kmRozliczeniowe, odcinkiTech]);

  const odcinkiSum = odcinki.reduce((s, o) => s + (o.km || 0), 0);
  const kmEfektywne = kmValue !== ''
    ? Number(kmValue)
    : ((kmOsrm ?? 0) + odcinkiSum);

  const addOdcinek = async () => {
    if (!kursId) return;
    const km = Number(newKm.replace(',', '.'));
    if (!newOpis.trim() || !isFinite(km) || km <= 0) {
      toast.error('Wpisz opis i km (> 0)');
      return;
    }
    const { data, error } = await supabase
      .from('kurs_odcinki_techniczne')
      .insert({ kurs_id: kursId, opis: newOpis.trim(), km })
      .select('id, opis, km')
      .single();
    if (error || !data) {
      toast.error('Błąd dodawania odcinka: ' + (error?.message || ''));
      return;
    }
    setOdcinki([...odcinki, { id: data.id, opis: data.opis, km: Number(data.km) }]);
    setNewOpis('');
    setNewKm('');
  };

  const removeOdcinek = async (id: string) => {
    const { error } = await supabase.from('kurs_odcinki_techniczne').delete().eq('id', id);
    if (error) {
      toast.error('Błąd usuwania: ' + error.message);
      return;
    }
    setOdcinki(odcinki.filter(o => o.id !== id));
  };

  const handleSave = async () => {
    if (!kursId) return;
    setSaving(true);
    const kmRozl = kmValue === '' ? null : Number(kmValue.replace(',', '.'));
    const { error } = await supabase
      .from('kursy')
      .update({ km_rozliczeniowe: kmRozl })
      .eq('id', kursId);
    setSaving(false);
    if (error) {
      toast.error('Błąd zapisu: ' + error.message);
      return;
    }
    toast.success('Zapisano');
    onSaved();
    onClose();
  };

  const handleClearOverride = () => setKmValue('');

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edytuj km kółka</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded border bg-muted/30 p-3 text-xs space-y-1">
            <div>Km OSRM (plan): <span className="font-mono">{kmOsrm != null ? kmOsrm.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km' : '—'}</span></div>
            <div>Odcinki techniczne (suma): <span className="font-mono">{odcinkiSum.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</span></div>
            <div className="pt-1 border-t border-border/50 font-medium">
              Użyte w rozliczeniu: <span className="font-mono">{kmEfektywne.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</span>
            </div>
          </div>

          <div>
            <Label htmlFor="km-rozl" className="text-sm">Km rzeczywiste z drogomierza (opcjonalne)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="km-rozl"
                type="number"
                step="0.1"
                placeholder={`Domyślnie: OSRM + odcinki = ${((kmOsrm ?? 0) + odcinkiSum).toFixed(1)}`}
                value={kmValue}
                onChange={e => setKmValue(e.target.value)}
              />
              {kmValue !== '' && (
                <Button variant="outline" size="sm" onClick={handleClearOverride}>Wyczyść</Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Jeśli wpisane — ta wartość zastępuje OSRM + odcinki. Pozostaw puste, by algorytm sumował.
            </p>
          </div>

          <div>
            <Label className="text-sm">Odcinki techniczne (serwis, tankowanie, objazd)</Label>
            <div className="space-y-1 mt-1 max-h-40 overflow-y-auto">
              {odcinki.length === 0 && <p className="text-xs text-muted-foreground py-2">Brak — dodaj poniżej jeśli kierowca miał odcinki techniczne</p>}
              {odcinki.map(o => (
                <div key={o.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs">
                  <span className="flex-1 truncate">{o.opis}</span>
                  <span className="font-mono">{o.km.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => removeOdcinek(o.id)}>×</Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                placeholder="Opis (np. Serwis)"
                value={newOpis}
                onChange={e => setNewOpis(e.target.value)}
                className="flex-1"
              />
              <Input
                type="number"
                step="0.1"
                placeholder="km"
                value={newKm}
                onChange={e => setNewKm(e.target.value)}
                className="w-24"
              />
              <Button variant="outline" size="sm" onClick={addOdcinek}>+ Dodaj</Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button onClick={handleSave} disabled={saving}>Zapisz</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
