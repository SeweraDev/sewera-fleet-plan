import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const STATUSY = [
  { value: 'robocza', label: 'Robocza' },
  { value: 'potwierdzona', label: 'Potwierdzona' },
  { value: 'w_trasie', label: 'W trasie' },
  { value: 'dostarczona', label: 'Dostarczona' },
  { value: 'anulowana', label: 'Anulowana' },
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

interface ZlData {
  numer: string;
  status: string;
  dzien: string;
  preferowana_godzina: string | null;
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
}

export function EdytujZlecenieModal({ zlecenieId, open, onClose, onSaved }: Props) {
  const [zlecenie, setZlecenie] = useState<ZlData | null>(null);
  const [wz, setWz] = useState<WzData | null>(null);
  const [status, setStatus] = useState('');
  const [godzina, setGodzina] = useState('');
  const [odbiorca, setOdbiorca] = useState('');
  const [adres, setAdres] = useState('');
  const [tel, setTel] = useState('');
  const [masaKg, setMasaKg] = useState('');
  const [objetoscM3, setObjetoscM3] = useState('');
  const [iloscPalet, setIloscPalet] = useState('');
  const [uwagi, setUwagi] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nadawcaNazwa, setNadawcaNazwa] = useState('');

  useEffect(() => {
    if (!open || !zlecenieId) return;
    setLoading(true);

    Promise.all([
      supabase.from('zlecenia').select('numer, status, dzien, preferowana_godzina, nadawca_id').eq('id', zlecenieId).single(),
      supabase.from('zlecenia_wz').select('id, odbiorca, adres, tel, masa_kg, objetosc_m3, ilosc_palet, uwagi').eq('zlecenie_id', zlecenieId).limit(1).single(),
    ]).then(async ([zlRes, wzRes]) => {
      const zl = zlRes.data;
      const w = wzRes.data;
      if (zl) {
        setZlecenie(zl as ZlData);
        setStatus(zl.status);
        setGodzina(zl.preferowana_godzina || 'dowolna');

        if (zl.nadawca_id) {
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', zl.nadawca_id).single();
          setNadawcaNazwa(prof?.full_name || '—');
        } else {
          setNadawcaNazwa('—');
        }
      }
      if (w) {
        setWz(w as unknown as WzData);
        setOdbiorca(w.odbiorca || '');
        setAdres(w.adres || '');
        setTel(w.tel || '');
        setMasaKg(String(w.masa_kg || 0));
        setObjetoscM3(String(w.objetosc_m3 || ''));
        setIloscPalet(String(w.ilosc_palet || ''));
        setUwagi(w.uwagi || '');
      }
      setLoading(false);
    });
  }, [open, zlecenieId]);

  const handleSave = async () => {
    if (!zlecenieId) return;
    setSaving(true);

    const { error: zlErr } = await supabase
      .from('zlecenia')
      .update({
        status,
        preferowana_godzina: godzina === 'dowolna' ? null : godzina,
      })
      .eq('id', zlecenieId);

    if (wz) {
      await supabase
        .from('zlecenia_wz')
        .update({
          odbiorca,
          adres,
          tel: tel || null,
          masa_kg: Number(masaKg) || 0,
          objetosc_m3: Number(objetoscM3) || 0,
          ilosc_palet: Number(iloscPalet) || 0,
          uwagi: uwagi || null,
        })
        .eq('id', wz.id);
    }

    setSaving(false);
    if (zlErr) {
      toast({ title: 'Błąd', description: zlErr.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Zlecenie zaktualizowane' });
      onSaved();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Edycja zlecenia {zlecenie?.numer || ''}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-center text-muted-foreground py-6">Ładowanie...</p>
        ) : (
          <div className="space-y-4">
            {/* Read-only fields */}
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
                <p className="text-[10px] text-muted-foreground uppercase">Data złożenia</p>
                <p className="text-sm">{zlecenie?.dzien}</p>
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Status zlecenia</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSY.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Preferowana godzina</Label>
                <Select value={godzina} onValueChange={setGodzina}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GODZINY.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Odbiorca</Label>
              <Input value={odbiorca} onChange={e => setOdbiorca(e.target.value)} />
            </div>

            <div>
              <Label>Adres dostawy</Label>
              <Input value={adres} onChange={e => setAdres(e.target.value)} />
            </div>

            <div>
              <Label>Telefon</Label>
              <Input value={tel} onChange={e => setTel(e.target.value)} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Masa kg</Label>
                <Input type="number" value={masaKg} onChange={e => setMasaKg(e.target.value)} />
              </div>
              <div>
                <Label>Objętość m³</Label>
                <Input type="number" value={objetoscM3} onChange={e => setObjetoscM3(e.target.value)} />
              </div>
              <div>
                <Label>Ilość palet</Label>
                <Input type="number" value={iloscPalet} onChange={e => setIloscPalet(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Uwagi</Label>
              <Textarea value={uwagi} onChange={e => setUwagi(e.target.value)} rows={3} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
