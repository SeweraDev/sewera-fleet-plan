import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { KursDto, PrzystanekDto } from '@/hooks/useKursyDnia';
import { wyslijPowiadomienie } from '@/lib/powiadomienia';

interface ZlBezKursu {
  id: string;
  numer: string;
  dzien: string;
  preferowana_godzina: string | null;
  typ_pojazdu: string | null;
  suma_kg: number;
  suma_m3: number;
  suma_palet: number;
  odbiorca: string;
  adres: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  kurs: KursDto | null;
  przystanki: PrzystanekDto[];
  oddzialId: number | null;
  dzien: string;
  onDone: () => void;
}

export function DodajDoKursuModal({ open, onClose, kurs, przystanki, oddzialId, dzien, onDone }: Props) {
  const [zlecenia, setZlecenia] = useState<ZlBezKursu[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Pobierz zlecenia bez kursu dla tego oddziału i dnia
  useEffect(() => {
    if (!open || !oddzialId) return;
    setChecked(new Set());
    setLoading(true);

    (async () => {
      // Zlecenia robocze/do_weryfikacji bez kursu — na ten sam dzień co kurs
      const { data: zlData } = await supabase
        .from('zlecenia')
        .select('id, numer, dzien, preferowana_godzina, typ_pojazdu, status, kurs_id')
        .eq('oddzial_id', oddzialId)
        .eq('dzien', dzien)
        .in('status', ['robocza', 'do_weryfikacji'])
        .is('kurs_id', null);

      // Wyklucz te już przypisane do aktywnych kursów
      const { data: activeKursy } = await supabase
        .from('kursy')
        .select('id')
        .neq('status', 'usuniety');
      const activeKursIds = (activeKursy || []).map(k => k.id);

      let assigned = new Set<string>();
      if (activeKursIds.length > 0) {
        const { data: przData } = await supabase
          .from('kurs_przystanki')
          .select('zlecenie_id')
          .in('kurs_id', activeKursIds);
        assigned = new Set((przData || []).map(p => p.zlecenie_id));
      }

      const unassigned = (zlData || []).filter(z => !assigned.has(z.id));
      const ids = unassigned.map(z => z.id);

      // Pobierz WZ z danymi
      let wzMap = new Map<string, { kg: number; m3: number; palet: number; odbiorca: string; adres: string }>();
      if (ids.length > 0) {
        const { data: wzData } = await supabase
          .from('zlecenia_wz')
          .select('zlecenie_id, masa_kg, objetosc_m3, ilosc_palet, odbiorca, adres')
          .in('zlecenie_id', ids);
        (wzData || []).forEach(w => {
          const prev = wzMap.get(w.zlecenie_id) || { kg: 0, m3: 0, palet: 0, odbiorca: '', adres: '' };
          prev.kg += Number(w.masa_kg) || 0;
          prev.m3 += Number(w.objetosc_m3) || 0;
          prev.palet += Number(w.ilosc_palet) || 0;
          if (!prev.odbiorca && w.odbiorca) prev.odbiorca = w.odbiorca;
          if (!prev.adres && w.adres) prev.adres = w.adres;
          wzMap.set(w.zlecenie_id, prev);
        });
      }

      setZlecenia(unassigned.map(z => {
        const wz = wzMap.get(z.id) || { kg: 0, m3: 0, palet: 0, odbiorca: '', adres: '' };
        return {
          id: z.id, numer: z.numer, dzien: z.dzien,
          preferowana_godzina: z.preferowana_godzina,
          typ_pojazdu: z.typ_pojazdu,
          suma_kg: wz.kg, suma_m3: wz.m3, suma_palet: wz.palet,
          odbiorca: wz.odbiorca, adres: wz.adres,
        };
      }));
      setLoading(false);
    })();
  }, [open, oddzialId]);

  const toggle = (id: string) => {
    const s = new Set(checked);
    s.has(id) ? s.delete(id) : s.add(id);
    setChecked(s);
  };

  const toggleAll = () => {
    if (checked.size === zlecenia.length) setChecked(new Set());
    else setChecked(new Set(zlecenia.map(z => z.id)));
  };

  // Obecne obciążenie kursu
  const currentLoad = useMemo(() => {
    if (!kurs) return { kg: 0, m3: 0, pal: 0 };
    return przystanki
      .filter(p => p.kurs_id === kurs.id)
      .reduce((acc, p) => ({
        kg: acc.kg + (Number(p.masa_kg) || 0),
        m3: acc.m3 + (Number(p.objetosc_m3) || 0),
        pal: acc.pal + (Number(p.ilosc_palet) || 0),
      }), { kg: 0, m3: 0, pal: 0 });
  }, [kurs, przystanki]);

  // Obciążenie zaznaczonych
  const addedLoad = useMemo(() => {
    return zlecenia
      .filter(z => checked.has(z.id))
      .reduce((acc, z) => ({
        kg: acc.kg + z.suma_kg, m3: acc.m3 + z.suma_m3, pal: acc.pal + z.suma_palet,
      }), { kg: 0, m3: 0, pal: 0 });
  }, [checked, zlecenia]);

  const afterLoad = { kg: currentLoad.kg + addedLoad.kg, m3: currentLoad.m3 + addedLoad.m3, pal: currentLoad.pal + addedLoad.pal };
  const capKg = kurs ? Number(kurs.ladownosc_kg) || 0 : 0;
  const capM3 = kurs ? Number(kurs.objetosc_m3) || 0 : 0;
  const capPal = kurs ? Number(kurs.max_palet) || 0 : 0;
  const overKg = capKg > 0 && afterLoad.kg > capKg;
  const overM3 = capM3 > 0 && afterLoad.m3 > capM3;
  const overPal = capPal > 0 && afterLoad.pal > capPal;
  const isOverloaded = overKg || overM3 || overPal;

  const handleAdd = async () => {
    if (!kurs || checked.size === 0) return;
    setSubmitting(true);

    // Max kolejność w kursie
    const maxKol = przystanki
      .filter(p => p.kurs_id === kurs.id)
      .reduce((m, p) => Math.max(m, p.kolejnosc), 0);

    const ids = Array.from(checked);
    // Wstaw przystanki
    const rows = ids.map((zlId, i) => ({
      kurs_id: kurs.id,
      zlecenie_id: zlId,
      kolejnosc: maxKol + i + 1,
      status: 'oczekuje',
    }));

    const { error } = await supabase.from('kurs_przystanki').insert(rows);
    if (error) {
      toast.error('Błąd: ' + error.message);
      setSubmitting(false);
      return;
    }

    // Zaktualizuj zlecenia
    await supabase
      .from('zlecenia')
      .update({ status: 'potwierdzona', kurs_id: kurs.id } as any)
      .in('id', ids);

    // Powiadom nadawców o przypisaniu do kursu
    const { data: zlDane } = await supabase
      .from('zlecenia')
      .select('id, numer, nadawca_id')
      .in('id', ids);
    if (zlDane) {
      for (const zl of zlDane) {
        if (zl.nadawca_id) {
          wyslijPowiadomienie({
            user_id: zl.nadawca_id,
            typ: 'zlecenie_w_kursie',
            tresc: `Zlecenie ${zl.numer} przypisane do kursu ${kurs.numer || ''}`,
            zlecenie_id: zl.id,
          });
        }
      }
    }

    toast.success('Dodano ' + ids.length + ' zleceń do kursu');
    setSubmitting(false);
    onDone();
    onClose();
  };

  if (!kurs) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            Dodaj zlecenia do kursu {kurs.numer || ''} · {kurs.nr_rej || '?'} · {kurs.pojazd_typ || ''}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-center text-muted-foreground py-6">Ładowanie zleceń...</p>
        ) : zlecenia.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">Brak zleceń bez kursu do dodania</p>
        ) : (
          <div className="space-y-3">
            {/* Podsumowanie zaznaczonych */}
            {checked.size > 0 && (
              <div className="flex items-center gap-3 rounded-lg bg-primary/10 border border-primary/30 px-3 py-2 text-sm">
                <span className="font-semibold">Zaznaczono {checked.size}</span>
                <span className="text-muted-foreground">
                  +{Math.round(addedLoad.kg)} kg
                  {addedLoad.m3 > 0 && ` · +${addedLoad.m3.toFixed(1)} m³`}
                  {addedLoad.pal > 0 && ` · +${addedLoad.pal} pal`}
                </span>
                <span className="ml-auto text-xs">
                  Po dodaniu: <strong className={overKg ? 'text-red-600' : ''}>{Math.round(afterLoad.kg)}{capKg > 0 ? '/' + capKg : ''} kg</strong>
                  {capPal > 0 && <> · <strong className={overPal ? 'text-red-600' : ''}>{afterLoad.pal}/{capPal} pal</strong></>}
                </span>
              </div>
            )}

            {isOverloaded && checked.size > 0 && (
              <div className="p-2 rounded-md text-xs bg-red-100 dark:bg-red-950/50 border border-red-400 text-red-600">
                ⚠️ Przekroczona pojemność pojazdu!
                {overKg && <span> Waga: +{Math.round(afterLoad.kg - capKg)} kg</span>}
                {overM3 && <span> Objętość: +{(afterLoad.m3 - capM3).toFixed(1)} m³</span>}
                {overPal && <span> Palety: +{afterLoad.pal - capPal}</span>}
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={checked.size === zlecenia.length && zlecenia.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Dzień</TableHead>
                  <TableHead>Godzina</TableHead>
                  <TableHead>Odbiorca</TableHead>
                  <TableHead>Adres</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">m³</TableHead>
                  <TableHead className="text-right">Pal.</TableHead>
                  <TableHead>Typ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zlecenia.map(z => (
                  <TableRow key={z.id} className="cursor-pointer hover:bg-muted/50" onClick={() => toggle(z.id)}>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox checked={checked.has(z.id)} onCheckedChange={() => toggle(z.id)} />
                    </TableCell>
                    <TableCell className="text-xs">{z.dzien}</TableCell>
                    <TableCell className="text-xs">{z.preferowana_godzina || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate">{z.odbiorca || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate">{z.adres || '—'}</TableCell>
                    <TableCell className="text-right">{Math.round(z.suma_kg)}</TableCell>
                    <TableCell className="text-right">{z.suma_m3 > 0 ? z.suma_m3.toFixed(1) : '—'}</TableCell>
                    <TableCell className="text-right">{z.suma_palet || '—'}</TableCell>
                    <TableCell className="text-xs">{z.typ_pojazdu || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button
            onClick={handleAdd}
            disabled={submitting || checked.size === 0}
            variant={isOverloaded ? 'destructive' : 'default'}
          >
            {submitting ? 'Dodawanie...' : isOverloaded
              ? `⚠️ Dodaj mimo przekroczenia (${checked.size})`
              : `Dodaj ${checked.size} zleceń do kursu`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
