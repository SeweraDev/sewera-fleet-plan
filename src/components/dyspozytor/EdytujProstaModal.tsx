// Modal edycji linii prostej oddział→adres (override Photon/Haversine).
// Używany w kursach zakończonych gdy Photon błędnie geocoduje adres
// (np. peryferie miasta — wychodzi centrum zamiast konkretnego numeru).
//
// Zmiana propaguje się do WSZYSTKICH WZ z tym samym adresem w danym kursie.

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onClose: () => void;
  /** ID zleceń które mają WZ pod tym samym adresem w tym kursie */
  zlecenieIds: string[];
  adres: string;
  oddzialAdres: string;
  aktualneKmProsta: number | null;
  aktualnyOverride: number | null;
  onSaved: () => void;
}

export function EdytujProstaModal({
  open, onClose, zlecenieIds, adres, oddzialAdres, aktualneKmProsta, aktualnyOverride, onSaved,
}: Props) {
  const [value, setValue] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue(aktualnyOverride != null ? String(aktualnyOverride) : '');
  }, [open, aktualnyOverride]);

  const googleMapsUrl = (() => {
    const from = encodeURIComponent(oddzialAdres);
    const to = encodeURIComponent(adres);
    return `https://www.google.pl/maps/dir/${from}/${to}`;
  })();

  const handleSave = async () => {
    if (zlecenieIds.length === 0) return;
    setSaving(true);
    const kmNew = value === '' ? null : Number(value.replace(',', '.'));
    if (kmNew != null && (!isFinite(kmNew) || kmNew < 0)) {
      toast.error('Niepoprawna wartość km');
      setSaving(false);
      return;
    }
    // Propagacja po (zlecenie_id IN ...) AND adres = X — wszystkie WZ tego adresu
    const { error } = await supabase
      .from('zlecenia_wz')
      .update({ km_prosta_override: kmNew })
      .in('zlecenie_id', zlecenieIds)
      .eq('adres', adres);
    setSaving(false);
    if (error) {
      toast.error('Błąd zapisu: ' + error.message);
      return;
    }
    toast.success(kmNew == null ? 'Przywrócono automatyczne liczenie' : `Zapisano: ${kmNew} km`);
    onSaved();
    onClose();
  };

  const handleClear = () => setValue('');

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edytuj linię prostą</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded border bg-muted/30 p-3 text-xs space-y-1">
            <div className="text-muted-foreground">Adres:</div>
            <div className="font-medium">{adres}</div>
            <div className="text-muted-foreground pt-2">Automatycznie wyliczone (Photon + Haversine):</div>
            <div className="font-mono">{aktualneKmProsta != null ? `${aktualneKmProsta.toFixed(1)} km` : '—'}</div>
          </div>

          <div>
            <Label htmlFor="km-prosta" className="text-sm">Km w linii prostej (ręcznie)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="km-prosta"
                type="number"
                step="0.1"
                min={0}
                placeholder={aktualneKmProsta != null ? `Domyślnie: ${aktualneKmProsta.toFixed(1)}` : 'np. 37,77'}
                value={value}
                onChange={e => setValue(e.target.value)}
                autoFocus
              />
              {value !== '' && (
                <Button variant="outline" size="sm" onClick={handleClear}>Wyczyść</Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Pozostaw puste, by użyć automatycznego wyliczenia.
              Zmiana dotyczy wszystkich WZ pod tym adresem w tym kursie.
            </p>
          </div>

          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm text-primary hover:underline"
          >
            🗺️ Sprawdź w Google Maps ↗
          </a>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button onClick={handleSave} disabled={saving}>Zapisz</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
