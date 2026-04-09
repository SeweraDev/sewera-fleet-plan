import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { KursDto, PrzystanekDto } from '@/hooks/useKursyDnia';

interface Props {
  open: boolean;
  onClose: () => void;
  sourceKurs: KursDto | null;
  allKursy: KursDto[];
  allPrzystanki: PrzystanekDto[];
  onDone: () => void;
}

export function PolaczKursyModal({ open, onClose, sourceKurs, allKursy, allPrzystanki, onDone }: Props) {
  const [targetKursId, setTargetKursId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setTargetKursId('');
  }, [open]);

  // Kursy docelowe: zaplanowany/aktywny, nie źródłowy
  const eligibleKursy = allKursy.filter(
    k => k.id !== sourceKurs?.id && (k.status === 'zaplanowany' || k.status === 'aktywny')
  );

  // Ładunek źródłowy
  const sourceLoad = useMemo(() => {
    if (!sourceKurs) return { kg: 0, m3: 0, pal: 0 };
    return allPrzystanki
      .filter(p => p.kurs_id === sourceKurs.id)
      .reduce((acc, p) => ({
        kg: acc.kg + (Number(p.masa_kg) || 0),
        m3: acc.m3 + (Number(p.objetosc_m3) || 0),
        pal: acc.pal + (Number(p.ilosc_palet) || 0),
      }), { kg: 0, m3: 0, pal: 0 });
  }, [sourceKurs, allPrzystanki]);

  const sourcePrzystanki = useMemo(() => {
    if (!sourceKurs) return [];
    return allPrzystanki.filter(p => p.kurs_id === sourceKurs.id);
  }, [sourceKurs, allPrzystanki]);

  // Docelowy kurs
  const targetKurs = allKursy.find(k => k.id === targetKursId);

  // Ładunek docelowy
  const targetLoad = useMemo(() => {
    if (!targetKursId) return { kg: 0, m3: 0, pal: 0 };
    return allPrzystanki
      .filter(p => p.kurs_id === targetKursId)
      .reduce((acc, p) => ({
        kg: acc.kg + (Number(p.masa_kg) || 0),
        m3: acc.m3 + (Number(p.objetosc_m3) || 0),
        pal: acc.pal + (Number(p.ilosc_palet) || 0),
      }), { kg: 0, m3: 0, pal: 0 });
  }, [targetKursId, allPrzystanki]);

  // Suma po połączeniu
  const afterLoad = {
    kg: sourceLoad.kg + targetLoad.kg,
    m3: sourceLoad.m3 + targetLoad.m3,
    pal: sourceLoad.pal + targetLoad.pal,
  };

  // Pojemność docelowa
  const tCapKg = targetKurs ? Number(targetKurs.ladownosc_kg) || 0 : 0;
  const tCapM3 = targetKurs ? Number(targetKurs.objetosc_m3) || 0 : 0;
  const tCapPal = targetKurs ? Number(targetKurs.max_palet) || 0 : 0;

  const overKg = tCapKg > 0 && afterLoad.kg > tCapKg;
  const overM3 = tCapM3 > 0 && afterLoad.m3 > tCapM3;
  const overPal = tCapPal > 0 && afterLoad.pal > tCapPal;
  const isOverloaded = overKg || overM3 || overPal;

  const handleMerge = async () => {
    if (!sourceKurs || !targetKursId) return;
    setSubmitting(true);

    try {
      // 1. Pobierz max kolejność w docelowym kursie
      const targetPrz = allPrzystanki.filter(p => p.kurs_id === targetKursId);
      const maxKolejnosc = targetPrz.length > 0
        ? Math.max(...targetPrz.map(p => p.kolejnosc))
        : 0;

      // 2. Pobierz przystanki źródłowe z DB (unikalne ID)
      const { data: sourcePrzDb } = await supabase
        .from('kurs_przystanki')
        .select('id, kolejnosc')
        .eq('kurs_id', sourceKurs.id)
        .order('kolejnosc');

      if (sourcePrzDb && sourcePrzDb.length > 0) {
        // 3. Przenieś każdy przystanek z nową kolejnością
        for (let i = 0; i < sourcePrzDb.length; i++) {
          await supabase
            .from('kurs_przystanki')
            .update({ kurs_id: targetKursId, kolejnosc: maxKolejnosc + sourcePrzDb[i].kolejnosc })
            .eq('id', sourcePrzDb[i].id);
        }
      }

      // 4. Zaktualizuj zlecenia (zdenormalizowane kurs_id)
      const zlIds = [...new Set(sourcePrzystanki.map(p => p.zlecenie_id).filter(Boolean))] as string[];
      if (zlIds.length > 0) {
        await supabase
          .from('zlecenia')
          .update({ kurs_id: targetKursId } as any)
          .in('id', zlIds);
      }

      // 5. Oznacz źródłowy kurs jako usunięty
      await supabase
        .from('kursy')
        .update({ status: 'usuniety' } as any)
        .eq('id', sourceKurs.id);

      const targetLabel = targetKurs ? (targetKurs.nr_rej || targetKurs.numer || '?') : '?';
      toast.success('Połączono kursy → ' + targetLabel);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error('Błąd łączenia: ' + (e?.message || 'nieznany'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!sourceKurs) return null;

  const sourceStopCount = [...new Set(sourcePrzystanki.map(p => p.kolejnosc))].length;
  const targetStopCount = targetKursId
    ? [...new Set(allPrzystanki.filter(p => p.kurs_id === targetKursId).map(p => p.kolejnosc))].length
    : 0;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Połącz kurs z innym</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Źródłowy kurs */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <p className="text-xs text-muted-foreground uppercase">Kurs źródłowy (zostanie usunięty)</p>
            <p className="text-sm font-medium">
              {sourceKurs.nr_rej || 'Brak pojazdu'} · {sourceKurs.pojazd_typ || '?'}
            </p>
            <p className="text-xs text-muted-foreground">
              {sourceStopCount} {sourceStopCount === 1 ? 'przystanek' : sourceStopCount < 5 ? 'przystanki' : 'przystanków'}
              {' · '}{Math.round(sourceLoad.kg)} kg
              {sourceLoad.m3 > 0 && ' · ' + sourceLoad.m3.toFixed(1) + ' m³'}
              {sourceLoad.pal > 0 && ' · ' + sourceLoad.pal + ' pal'}
            </p>
          </div>

          {/* Select docelowy */}
          <div className="space-y-2">
            <Label>Przenieś przystanki do kursu:</Label>
            <Select value={targetKursId} onValueChange={setTargetKursId}>
              <SelectTrigger><SelectValue placeholder="Wybierz kurs docelowy" /></SelectTrigger>
              <SelectContent>
                {eligibleKursy.map(k => {
                  const stopCount = [...new Set(allPrzystanki.filter(p => p.kurs_id === k.id).map(p => p.kolejnosc))].length;
                  return (
                    <SelectItem key={k.id} value={k.id}>
                      {k.nr_rej || '?'} · {k.pojazd_typ || '?'} · {stopCount} przyst.
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {eligibleKursy.length === 0 && (
              <p className="text-xs text-muted-foreground">Brak innych kursów na ten dzień</p>
            )}
          </div>

          {/* Podsumowanie po połączeniu */}
          {targetKursId && targetKurs && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs text-muted-foreground uppercase">Po połączeniu</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Przystanki</span>
                  <p className="font-medium">{targetStopCount + sourceStopCount}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Waga</span>
                  <p className={'font-medium ' + (overKg ? 'text-red-600' : '')}>
                    {Math.round(afterLoad.kg)}{tCapKg > 0 ? ' / ' + tCapKg + ' kg' : ' kg'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Palety</span>
                  <p className={'font-medium ' + (overPal ? 'text-red-600' : '')}>
                    {afterLoad.pal}{tCapPal > 0 ? ' / ' + tCapPal + ' pal' : ' pal'}
                  </p>
                </div>
              </div>
              {tCapM3 > 0 && (
                <div className="text-sm">
                  <span className="text-muted-foreground text-xs">Objętość: </span>
                  <span className={'font-medium ' + (overM3 ? 'text-red-600' : '')}>
                    {afterLoad.m3.toFixed(1)} / {tCapM3} m³
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Ostrzeżenie o przekroczeniu */}
          {isOverloaded && (
            <div className="p-3 rounded-md text-sm bg-red-100 dark:bg-red-950/50 border border-red-400">
              <div className="font-semibold text-red-600 mb-1">⚠️ Przekroczona pojemność!</div>
              {overKg && <div className="text-red-600">Waga: {Math.round(afterLoad.kg)} / {tCapKg} kg (+{Math.round(afterLoad.kg - tCapKg)} kg)</div>}
              {overM3 && <div className="text-red-600">Objętość: {afterLoad.m3.toFixed(1)} / {tCapM3} m³</div>}
              {overPal && <div className="text-red-600">Palety: {afterLoad.pal} / {tCapPal} pal (+{afterLoad.pal - tCapPal})</div>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button
            onClick={handleMerge}
            disabled={submitting || !targetKursId}
            variant={isOverloaded ? 'destructive' : 'default'}
          >
            {submitting ? 'Łączenie...' : isOverloaded ? '⚠️ Połącz mimo przekroczenia' : 'Połącz kursy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
