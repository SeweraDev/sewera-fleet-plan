import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { ModalImportWZ, type WZImportData } from '@/components/shared/ModalImportWZ';

const STATUSY = [
  { value: 'robocza', label: 'Robocza' },
  { value: 'potwierdzona', label: 'Potwierdzona' },
  { value: 'w_trasie', label: 'W trasie' },
  { value: 'dostarczona', label: 'Dostarczona' },
  { value: 'anulowana', label: 'Anulowana' },
  { value: 'do_weryfikacji', label: 'Do weryfikacji' },
];

const GODZINY = [
  { value: 'do 8:00', label: 'do 8:00' },
  { value: 'do 10:00', label: 'do 10:00' },
  { value: 'do 12:00', label: 'do 12:00' },
  { value: 'do 14:00', label: 'do 14:00' },
  { value: 'do 16:00', label: 'do 16:00' },
  { value: 'dowolna', label: 'Dowolna' },
];

interface Props {
  zlecenieId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const TYPY_POJAZDOW = [
  'Dostawczy 1,2t', 'Winda 1,8t', 'Winda 6,3t', 'Winda MAX 15,8t',
  'HDS 9,0t', 'HDS 12,0t',
];

interface ZlData {
  numer: string;
  status: string;
  dzien: string;
  preferowana_godzina: string | null;
  typ_pojazdu: string | null;
  nadawca_id: string | null;
}

interface WzData {
  id: string;
  odbiorca: string;
  adres: string;
  tel: string;
  masa_kg: number;
  objetosc_m3: number;
  ilosc_palet: number;
  uwagi: string;
  numer_wz: string;
  nr_zamowienia: string;
}

export function EdytujZlecenieModal({ zlecenieId, open, onClose, onSaved }: Props) {
  const [zlecenie, setZlecenie] = useState<ZlData | null>(null);
  const [wzList, setWzList] = useState<WzData[]>([]);
  const [status, setStatus] = useState('');
  const [godzina, setGodzina] = useState('');
  const [typPojazdu, setTypPojazdu] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nadawcaNazwa, setNadawcaNazwa] = useState('');
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    if (!open || !zlecenieId) return;
    setLoading(true);

    Promise.all([
      supabase.from('zlecenia').select('numer, status, dzien, preferowana_godzina, typ_pojazdu, nadawca_id').eq('id', zlecenieId).single(),
      supabase.from('zlecenia_wz').select('id, odbiorca, adres, tel, masa_kg, objetosc_m3, ilosc_palet, uwagi, numer_wz, nr_zamowienia').eq('zlecenie_id', zlecenieId),
    ]).then(async ([zlRes, wzRes]) => {
      const zl = zlRes.data;
      if (zl) {
        setZlecenie(zl as ZlData);
        setStatus(zl.status);
        setGodzina(zl.preferowana_godzina || 'dowolna');
        setTypPojazdu(zl.typ_pojazdu || 'brak');
        if (zl.nadawca_id) {
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', zl.nadawca_id).single();
          setNadawcaNazwa(prof?.full_name || '—');
        } else {
          setNadawcaNazwa('—');
        }
      }
      const wzData = (wzRes.data || []).map((w: any) => ({
        id: w.id,
        odbiorca: w.odbiorca || '',
        adres: w.adres || '',
        tel: w.tel || '',
        masa_kg: Number(w.masa_kg) || 0,
        objetosc_m3: Number(w.objetosc_m3) || 0,
        ilosc_palet: Number(w.ilosc_palet) || 0,
        uwagi: w.uwagi || '',
        numer_wz: w.numer_wz || '',
        nr_zamowienia: w.nr_zamowienia || '',
      }));
      setWzList(wzData);
      setLoading(false);
    });
  }, [open, zlecenieId]);

  const updateWz = (idx: number, field: keyof WzData, value: string | number) => {
    setWzList(prev => prev.map((w, i) => i === idx ? { ...w, [field]: value } : w));
  };

  const handleImportWz = useCallback((data: WZImportData[]) => {
    if (data.length > 0) {
      const d = data[0];
      // Wypełnij pierwszy WZ importowanymi danymi
      if (wzList.length > 0) {
        const updated = { ...wzList[0] };
        if (d.odbiorca) updated.odbiorca = d.odbiorca;
        if (d.adres) updated.adres = d.adres;
        if (d.tel) updated.tel = d.tel;
        if (d.masa_kg) updated.masa_kg = d.masa_kg;
        if (d.ilosc_palet) updated.ilosc_palet = d.ilosc_palet;
        if (d.objetosc_m3) updated.objetosc_m3 = d.objetosc_m3;
        if (d.uwagi) updated.uwagi = d.uwagi;
        setWzList(prev => [updated, ...prev.slice(1)]);
      }
    }
  }, [wzList]);

  const handleSave = async () => {
    if (!zlecenieId) return;
    setSaving(true);

    const { error: zlErr } = await supabase
      .from('zlecenia')
      .update({
        status,
        preferowana_godzina: godzina === 'dowolna' ? null : godzina,
        typ_pojazdu: typPojazdu === 'brak' ? null : typPojazdu,
      })
      .eq('id', zlecenieId);

    // Zapisz wszystkie WZ
    for (const w of wzList) {
      await supabase
        .from('zlecenia_wz')
        .update({
          odbiorca: w.odbiorca,
          adres: w.adres,
          tel: w.tel || null,
          masa_kg: w.masa_kg || 0,
          objetosc_m3: w.objetosc_m3 || 0,
          ilosc_palet: w.ilosc_palet || 0,
          uwagi: w.uwagi || null,
        })
        .eq('id', w.id);
    }

    setSaving(false);
    if (zlErr) {
      toast({ title: 'Błąd', description: zlErr.message, variant: 'destructive' });
    } else {
      toast({ title: 'Zlecenie zaktualizowane' });
      onSaved();
      onClose();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Edycja zlecenia {zlecenie?.numer || ''}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="text-center text-muted-foreground py-6">Ładowanie...</p>
          ) : (
            <div className="space-y-4">
              {/* Read-only */}
              <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/50">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Numer</p>
                  <p className="text-sm font-mono font-medium">{zlecenie?.numer}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Nadawca</p>
                  <p className="text-sm">{nadawcaNazwa}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Dzień</p>
                  <p className="text-sm">{zlecenie?.dzien}</p>
                </div>
              </div>

              {/* Status + godzina + typ pojazdu */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSY.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Godzina dostawy</Label>
                  <Select value={godzina} onValueChange={setGodzina}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GODZINY.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Typ pojazdu</Label>
                  <Select value={typPojazdu} onValueChange={setTypPojazdu}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brak">Nie wybrano</SelectItem>
                      {TYPY_POJAZDOW.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* WZ list */}
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Dokumenty WZ ({wzList.length})</Label>
                <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
                  Importuj z WZ
                </Button>
              </div>

              {wzList.map((w, idx) => (
                <Card key={w.id} className="p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      WZ #{idx + 1} {w.numer_wz && <span className="font-mono">({w.numer_wz})</span>}
                    </span>
                    {w.nr_zamowienia && <span className="text-xs text-muted-foreground">Zam: {w.nr_zamowienia}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Odbiorca</Label>
                      <Input className="h-8 text-sm" value={w.odbiorca} onChange={e => updateWz(idx, 'odbiorca', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Adres</Label>
                      <Input className="h-8 text-sm" value={w.adres} onChange={e => updateWz(idx, 'adres', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Telefon</Label>
                      <Input className="h-8 text-sm" value={w.tel} onChange={e => updateWz(idx, 'tel', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <Label className="text-xs">Kg</Label>
                        <Input className="h-8 text-sm" type="number" value={w.masa_kg || ''} onChange={e => updateWz(idx, 'masa_kg', Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-xs">m3</Label>
                        <Input className="h-8 text-sm" type="number" value={w.objetosc_m3 || ''} onChange={e => updateWz(idx, 'objetosc_m3', Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-xs">Pal.</Label>
                        <Input className="h-8 text-sm" type="number" value={w.ilosc_palet || ''} onChange={e => updateWz(idx, 'ilosc_palet', Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Uwagi</Label>
                    <Input className="h-8 text-sm" value={w.uwagi} onChange={e => updateWz(idx, 'uwagi', e.target.value)} />
                  </div>
                </Card>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Anuluj</Button>
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Zapisywanie...' : `Zapisz zmiany (${wzList.length} WZ)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModalImportWZ
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImportWz}
      />
    </>
  );
}
