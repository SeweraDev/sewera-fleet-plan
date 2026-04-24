import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useKierowcyStatusDnia, type KierowcaStatusDto } from '@/hooks/useKierowcyStatusDnia';
import { useKierowcyOddzialu } from '@/hooks/useKierowcyOddzialu';
import { useKalendarzFloty, type KursKalendarzDto } from '@/hooks/useKalendarzFloty';
import { useBlokady } from '@/hooks/useBlokady';
import { useFlotaZewnetrzna, type PojazdZewnetrzny } from '@/hooks/useFlotaZewnetrzna';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';

const TYPY_POJAZDOW = [
  'Dostawczy 1,2t',
  'Winda 1,8t',
  'Winda 6,3t',
  'Winda MAX 15,8t',
  'HDS 9,0t',
  'HDS 12,0t',
];

const UPRAWNIENIA = ['B', 'C', 'C_HDS'];

// ── Calendar helpers ──

function formatDayHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return { day: days[d.getDay()], date: `${dd}.${mm}` };
}

function KursCell({ kurs, blocked, onToggle }: { kurs: KursKalendarzDto | undefined; blocked: boolean; onToggle: () => void }) {
  if (kurs) {
    const map: Record<string, { cls: string; label: string }> = {
      zaplanowany: { cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', label: kurs.numer || 'plan' },
      aktywny: { cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', label: 'w trasie' },
      'zakończony': { cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', label: '✓' },
    };
    const m = map[kurs.status] || { cls: '', label: kurs.status };
    return <Badge variant="secondary" className={`${m.cls} text-[10px] px-1.5`}>{m.label}</Badge>;
  }
  if (blocked) {
    return (
      <button onClick={onToggle} className="w-full h-full flex items-center justify-center text-red-600 dark:text-red-400 hover:opacity-70 transition-opacity cursor-pointer" title="Kliknij aby odblokować">🔒</button>
    );
  }
  return (
    <button onClick={onToggle} className="w-full h-full flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors cursor-pointer" title="Kliknij aby zablokować">·</button>
  );
}

// ── Pojazd Modal ──

function PojazdModal({
  open, onClose, pojazd, oddzialId, oddzialy, onSaved,
}: {
  open: boolean; onClose: () => void; pojazd: Pojazd | null; oddzialId: number | null;
  oddzialy: { id: number; nazwa: string }[]; onSaved: () => void;
}) {
  const isEdit = !!pojazd;
  const [nr_rej, setNrRej] = useState('');
  const [typ, setTyp] = useState('');
  const [oddId, setOddId] = useState('');
  const [ladownosc_kg, setLadownosc] = useState(0);
  const [objetosc_m3, setObjetosc] = useState<number | ''>('');
  const [max_palet, setMaxPalet] = useState<number | ''>('');
  const [aktywny, setAktywny] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setNrRej(''); setTyp(''); setOddId(''); setLadownosc(0); setObjetosc(''); setMaxPalet(''); setAktywny(true);
      return;
    }
    if (pojazd) {
      setNrRej(pojazd.nr_rej);
      setTyp(pojazd.typ);
      setOddId(String(pojazd.oddzial_id || oddzialId || ''));
      setLadownosc(pojazd.ladownosc_kg);
      setObjetosc(pojazd.objetosc_m3 ?? '');
      setMaxPalet(pojazd.max_palet ?? '');
      setAktywny(pojazd.aktywny);
    } else {
      setOddId(String(oddzialId || ''));
      setAktywny(true);
    }
  }, [open, pojazd, oddzialId]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = async () => {
    if (!nr_rej || !typ || !oddId) { toast.error('Uzupełnij wymagane pola'); return; }
    setSaving(true);
    const row = {
      nr_rej: nr_rej.toUpperCase(),
      typ,
      oddzial_id: Number(oddId),
      ladownosc_kg,
      objetosc_m3: objetosc_m3 === '' ? null : Number(objetosc_m3),
      max_palet: max_palet === '' ? null : Number(max_palet),
      aktywny,
    };
    let err;
    if (isEdit) {
      const { error } = await supabase.from('flota').update(row).eq('id', pojazd!.id);
      err = error;
    } else {
      const { error } = await supabase.from('flota').insert(row);
      err = error;
    }
    setSaving(false);
    if (err) { toast.error(err.message); return; }
    toast.success(isEdit ? 'Pojazd zaktualizowany' : 'Pojazd dodany');
    handleClose();
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj pojazd' : 'Dodaj pojazd'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Nr rejestracyjny *</Label><Input className="h-8 uppercase" value={nr_rej} onChange={e => setNrRej(e.target.value.toUpperCase())} /></div>
          <div>
            <Label className="text-xs">Typ *</Label>
            <Select value={typ} onValueChange={setTyp}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Wybierz typ" /></SelectTrigger>
              <SelectContent>{TYPY_POJAZDOW.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Oddział *</Label>
            <Select value={oddId} onValueChange={setOddId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
              <SelectContent>{oddzialy.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nazwa}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label className="text-xs">Ładowność kg *</Label><Input className="h-8" type="number" value={ladownosc_kg || ''} onChange={e => setLadownosc(Number(e.target.value))} /></div>
            <div><Label className="text-xs">Objętość m³</Label><Input className="h-8" type="number" value={objetosc_m3} onChange={e => setObjetosc(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            <div><Label className="text-xs">Max palet</Label><Input className="h-8" type="number" value={max_palet} onChange={e => setMaxPalet(e.target.value === '' ? '' : Number(e.target.value))} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={aktywny} onCheckedChange={setAktywny} />
            <Label className="text-xs">Aktywny</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Anuluj</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Zapisywanie...' : 'Zapisz'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Zewnętrzny Modal ──

function ZewnetrznyModal({
  open, onClose, pojazd, oddzialId, oddzialy, onSaved,
}: {
  open: boolean; onClose: () => void; pojazd: PojazdZewnetrzny | null; oddzialId: number | null;
  oddzialy: { id: number; nazwa: string }[]; onSaved: () => void;
}) {
  const isEdit = !!pojazd;
  const [nr_rej, setNrRej] = useState('');
  const [typ, setTyp] = useState('');
  const [oddId, setOddId] = useState('');
  const [ladownosc_kg, setLadownosc] = useState<number | ''>('');
  const [max_palet, setMaxPalet] = useState<number | ''>('');
  const [objetosc_m3, setObjetosc] = useState<number | ''>('');
  const [firma, setFirma] = useState('');
  const [kierowca, setKierowca] = useState('');
  const [tel, setTel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setNrRej(''); setTyp(''); setOddId(''); setLadownosc(''); setMaxPalet(''); setObjetosc('');
      setFirma(''); setKierowca(''); setTel('');
      return;
    }
    if (pojazd) {
      setNrRej(pojazd.nr_rej);
      setTyp(pojazd.typ);
      setOddId(String(pojazd.oddzial_id || oddzialId || ''));
      setLadownosc(pojazd.ladownosc_kg ?? '');
      setMaxPalet(pojazd.max_palet ?? '');
      setObjetosc(pojazd.objetosc_m3 ?? '');
      setFirma(pojazd.firma || '');
      setKierowca(pojazd.kierowca || '');
      setTel(pojazd.tel || '');
    } else {
      setOddId(String(oddzialId || ''));
    }
  }, [open, pojazd, oddzialId]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = async () => {
    if (!nr_rej || !typ) { toast.error('Uzupełnij wymagane pola'); return; }
    setSaving(true);
    const row = {
      nr_rej: nr_rej.toUpperCase(),
      typ,
      oddzial_id: oddId ? Number(oddId) : null,
      ladownosc_kg: ladownosc_kg === '' ? null : Number(ladownosc_kg),
      max_palet: max_palet === '' ? null : Number(max_palet),
      objetosc_m3: objetosc_m3 === '' ? null : Number(objetosc_m3),
      firma: firma || '',
      kierowca: kierowca || null,
      tel: tel || null,
    };
    let err;
    if (isEdit) {
      const { error } = await supabase.from('flota_zewnetrzna').update(row).eq('id', pojazd!.id);
      err = error;
    } else {
      const { error } = await supabase.from('flota_zewnetrzna').insert({ ...row, aktywny: true });
      err = error;
    }
    setSaving(false);
    if (err) { toast.error(err.message); return; }
    toast.success(isEdit ? 'Pojazd zewnętrzny zaktualizowany' : 'Pojazd zewnętrzny dodany');
    handleClose();
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj zewnętrznego' : 'Dodaj zewnętrznego'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Nr rejestracyjny *</Label><Input className="h-8 uppercase" value={nr_rej} onChange={e => setNrRej(e.target.value.toUpperCase())} /></div>
            <div>
              <Label className="text-xs">Typ pojazdu *</Label>
              <Select value={typ} onValueChange={setTyp}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Wybierz typ" /></SelectTrigger>
                <SelectContent>{TYPY_POJAZDOW.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label className="text-xs">Ładowność kg *</Label><Input className="h-8" type="number" value={ladownosc_kg} onChange={e => setLadownosc(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            <div><Label className="text-xs">Max palet</Label><Input className="h-8" type="number" value={max_palet} onChange={e => setMaxPalet(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            <div><Label className="text-xs">Objętość m³</Label><Input className="h-8" type="number" value={objetosc_m3} onChange={e => setObjetosc(e.target.value === '' ? '' : Number(e.target.value))} /></div>
          </div>
          <div><Label className="text-xs">Firma</Label><Input className="h-8" value={firma} onChange={e => setFirma(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Kierowca</Label><Input className="h-8" value={kierowca} onChange={e => setKierowca(e.target.value)} /></div>
            <div><Label className="text-xs">Telefon kierowcy</Label><Input className="h-8" value={tel} onChange={e => setTel(e.target.value)} /></div>
          </div>
          <div>
            <Label className="text-xs">Oddział</Label>
            <Select value={oddId} onValueChange={setOddId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
              <SelectContent>{oddzialy.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nazwa}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Anuluj</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Zapisywanie...' : 'Zapisz'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Kierowca Modal ──

function KierowcaModal({
  open, onClose, kierowca, oddzialId, oddzialy, onSaved,
}: {
  open: boolean; onClose: () => void; kierowca: { id: string; imie_nazwisko: string; uprawnienia: string; tel: string; oddzial_id: number | null; aktywny: boolean } | null;
  oddzialId: number | null; oddzialy: { id: number; nazwa: string }[]; onSaved: () => void;
}) {
  const isEdit = !!kierowca;
  const [imie, setImie] = useState('');
  const [uprawnienia, setUprawnienia] = useState('');
  const [oddId, setOddId] = useState('');
  const [tel, setTel] = useState('');
  const [aktywny, setAktywny] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setImie(''); setUprawnienia(''); setOddId(''); setTel(''); setAktywny(true);
      return;
    }
    if (kierowca) {
      setImie(kierowca.imie_nazwisko);
      setUprawnienia(kierowca.uprawnienia);
      setOddId(String(kierowca.oddzial_id || oddzialId || ''));
      setTel(kierowca.tel);
      setAktywny(kierowca.aktywny);
    } else {
      setOddId(String(oddzialId || ''));
      setAktywny(true);
    }
  }, [open, kierowca, oddzialId]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = async () => {
    if (!imie || !uprawnienia || !oddId) { toast.error('Uzupełnij wymagane pola'); return; }
    setSaving(true);
    const row = {
      imie_nazwisko: imie,
      uprawnienia,
      oddzial_id: Number(oddId),
      tel: tel || null,
      aktywny,
    };
    let err;
    if (isEdit) {
      const { error } = await supabase.from('kierowcy').update(row).eq('id', kierowca!.id);
      err = error;
    } else {
      const { error } = await supabase.from('kierowcy').insert(row);
      err = error;
    }
    setSaving(false);
    if (err) { toast.error(err.message); return; }
    toast.success(isEdit ? 'Kierowca zaktualizowany' : 'Kierowca dodany');
    handleClose();
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj kierowcę' : 'Dodaj kierowcę'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Imię i nazwisko *</Label><Input className="h-8" value={imie} onChange={e => setImie(e.target.value)} /></div>
          <div>
            <Label className="text-xs">Uprawnienia *</Label>
            <Select value={uprawnienia} onValueChange={setUprawnienia}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Wybierz" /></SelectTrigger>
              <SelectContent>{UPRAWNIENIA.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Oddział *</Label>
            <Select value={oddId} onValueChange={setOddId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
              <SelectContent>{oddzialy.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nazwa}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Telefon</Label><Input className="h-8" value={tel} onChange={e => setTel(e.target.value)} /></div>
          <div className="flex items-center gap-2">
            <Switch checked={aktywny} onCheckedChange={setAktywny} />
            <Label className="text-xs">Aktywny</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Anuluj</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Zapisywanie...' : 'Zapisz'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Calendar Tab ──

function KalendarzTab({
  flota, kierowcy, flotaZewn, kursy, businessDays, loading, isBlocked, onToggle,
}: {
  flota: Pojazd[]; kierowcy: KierowcaStatusDto[]; flotaZewn: PojazdZewnetrzny[]; kursy: KursKalendarzDto[];
  businessDays: string[]; loading: boolean;
  isBlocked: (typ: string, zasobId: string, dzien: string) => boolean;
  onToggle: (typ: string, zasobId: string, dzien: string) => void;
}) {
  if (loading) return <p className="text-muted-foreground text-center py-8">Ładowanie kalendarza...</p>;

  const flotaKursy = new Map<string, Map<string, KursKalendarzDto>>();
  const kierowcaKursy = new Map<string, Map<string, KursKalendarzDto>>();
  kursy.forEach(k => {
    if (k.flota_id) { if (!flotaKursy.has(k.flota_id)) flotaKursy.set(k.flota_id, new Map()); flotaKursy.get(k.flota_id)!.set(k.dzien, k); }
    if (k.kierowca_id) { if (!kierowcaKursy.has(k.kierowca_id)) kierowcaKursy.set(k.kierowca_id, new Map()); kierowcaKursy.get(k.kierowca_id)!.set(k.dzien, k); }
  });
  const today = new Date().toISOString().split('T')[0];
  const renderDayHeaders = () => businessDays.map(d => {
    const { day, date } = formatDayHeader(d);
    return (
      <TableHead key={d} className={`text-center min-w-[70px] ${d === today ? 'bg-accent/50' : ''}`}>
        <div className="text-[10px] text-muted-foreground">{day}</div>
        <div className="text-xs">{date}</div>
      </TableHead>
    );
  });

  const flotaWlasna = flota.filter(f => !f.jest_zewnetrzny);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">🚛 Flota Sewera</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead className="sticky left-0 bg-background z-10 min-w-[140px]">Pojazd</TableHead>{renderDayHeaders()}</TableRow></TableHeader>
            <TableBody>
              {flotaWlasna.map(f => (
                <TableRow key={f.id}>
                  <TableCell className="sticky left-0 bg-background z-10 font-mono text-xs">{f.nr_rej}<span className="text-muted-foreground ml-1 text-[10px]">{f.typ}</span></TableCell>
                  {businessDays.map(d => {
                    const kurs = flotaKursy.get(f.id)?.get(d);
                    const blocked = isBlocked('pojazd', f.id, d);
                    return <TableCell key={d} className={`text-center p-1 ${d === today ? 'bg-accent/30' : ''} ${blocked && !kurs ? 'bg-red-50 dark:bg-red-950/30' : ''}`}><KursCell kurs={kurs} blocked={blocked} onToggle={() => onToggle('pojazd', f.id, d)} /></TableCell>;
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">🚚 Transport zewnętrzny</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">Pojazd</TableHead>{renderDayHeaders()}</TableRow></TableHeader>
            <TableBody>
              {flotaZewn.map(f => (
                <TableRow key={f.id}>
                  <TableCell className="sticky left-0 bg-background z-10 font-mono text-xs">
                    {f.nr_rej}
                    {f.firma && <span className="text-muted-foreground ml-1 text-[10px]">· {f.firma}</span>}
                  </TableCell>
                  {businessDays.map(d => {
                    const blocked = isBlocked('zewnetrzny', f.id, d);
                    return (
                      <TableCell key={d} className={`text-center p-1 ${d === today ? 'bg-accent/30' : ''} ${blocked ? 'bg-red-50 dark:bg-red-950/30' : ''}`}>
                        <KursCell kurs={undefined} blocked={blocked} onToggle={() => onToggle('zewnetrzny', f.id, d)} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">👤 Kierowcy</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead className="sticky left-0 bg-background z-10 min-w-[140px]">Kierowca</TableHead>{renderDayHeaders()}</TableRow></TableHeader>
            <TableBody>
              {kierowcy.map(k => (
                <TableRow key={k.id}>
                  <TableCell className="sticky left-0 bg-background z-10 text-xs font-medium">{k.imie_nazwisko}</TableCell>
                  {businessDays.map(d => {
                    const kurs = kierowcaKursy.get(k.id)?.get(d);
                    const blocked = isBlocked('kierowca', k.id, d);
                    return <TableCell key={d} className={`text-center p-1 ${d === today ? 'bg-accent/30' : ''} ${blocked && !kurs ? 'bg-red-50 dark:bg-red-950/30' : ''}`}><KursCell kurs={kurs} blocked={blocked} onToggle={() => onToggle('kierowca', k.id, d)} /></TableCell>;
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

// ── Main FlotaSection ──

export function FlotaSection({
  oddzialId, flota, oddzialy, onFlotaRefresh,
}: {
  oddzialId: number | null;
  flota: Pojazd[];
  oddzialy: { id: number; nazwa: string }[];
  onFlotaRefresh: () => void;
}) {
  const { kierowcy: kierowcyStatus, loading: loadingKierowcy } = useKierowcyStatusDnia(oddzialId);
  const { kierowcy: kierowcyCrud, refetch: refetchKierowcy } = useKierowcyOddzialu(oddzialId);
  const { kursy, businessDays, loading: loadingKalendarz } = useKalendarzFloty(oddzialId);
  const { isBlocked, toggleBlokada } = useBlokady(oddzialId, businessDays);
  const { flota: flotaZewn, loading: loadingZewn, refetch: refetchZewn } = useFlotaZewnetrzna(oddzialId);
  const oddzialNazwa = oddzialy.find(o => o.id === oddzialId)?.nazwa || '';

  // Pojazd CRUD state
  const [pojazdModal, setPojazdModal] = useState(false);
  const [editPojazd, setEditPojazd] = useState<Pojazd | null>(null);
  const [deletePojazd, setDeletePojazd] = useState<Pojazd | null>(null);

  // Zewnętrzny CRUD state
  const [zewnModal, setZewnModal] = useState(false);
  const [editZewn, setEditZewn] = useState<PojazdZewnetrzny | null>(null);
  const [deleteZewn, setDeleteZewn] = useState<PojazdZewnetrzny | null>(null);

  // Kierowca CRUD state
  const [kierowcaModal, setKierowcaModal] = useState(false);
  const [editKierowca, setEditKierowca] = useState<typeof kierowcyCrud[0] | null>(null);
  const [deleteKierowca, setDeleteKierowca] = useState<typeof kierowcyCrud[0] | null>(null);

  const handleDeletePojazd = async () => {
    if (!deletePojazd) return;
    await supabase.from('flota').update({ aktywny: false }).eq('id', deletePojazd.id);
    toast.success('Pojazd dezaktywowany');
    setDeletePojazd(null);
    onFlotaRefresh();
  };

  const handleDeleteZewn = async () => {
    if (!deleteZewn) return;
    const { error } = await supabase.from('flota_zewnetrzna').delete().eq('id', deleteZewn.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Pojazd zewnętrzny usunięty');
    setDeleteZewn(null);
    refetchZewn();
  };

  const handleDeleteKierowca = async () => {
    if (!deleteKierowca) return;
    await supabase.from('kierowcy').update({ aktywny: false }).eq('id', deleteKierowca.id);
    toast.success('Kierowca dezaktywowany');
    setDeleteKierowca(null);
    refetchKierowcy();
  };

  return (
    <>
      <Tabs defaultValue="pojazdy">
        <TabsList>
          <TabsTrigger value="pojazdy">🚛 Pojazdy własne</TabsTrigger>
          <TabsTrigger value="zewnetrzni">🚚 Zewnętrzni</TabsTrigger>
          <TabsTrigger value="kierowcy">👤 Kierowcy</TabsTrigger>
          <TabsTrigger value="kalendarz">📅 Kalendarz</TabsTrigger>
        </TabsList>

        {/* ── Pojazdy własne Tab ── */}
        <TabsContent value="pojazdy" className="mt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">🚛 Flota własna — {oddzialNazwa}</h2>
              <Button size="sm" onClick={() => { setEditPojazd(null); setPojazdModal(true); }}>+ Dodaj pojazd</Button>
            </div>
            {flota.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground">Brak pojazdów</CardContent></Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nr rejestracyjny</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead className="text-right">Ładowność (kg)</TableHead>
                    <TableHead className="text-right">Objętość (m³)</TableHead>
                    <TableHead className="text-right">Max palet</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flota.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono">{f.nr_rej}</TableCell>
                      <TableCell>{f.typ}</TableCell>
                      <TableCell className="text-right">{f.ladownosc_kg}</TableCell>
                      <TableCell className="text-right">{f.objetosc_m3 ?? '—'}</TableCell>
                      <TableCell className="text-right">{f.max_palet ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditPojazd(f); setPojazdModal(true); }}>✏️</Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => setDeletePojazd(f)}>🗑</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ── Zewnętrzni Tab ── */}
        <TabsContent value="zewnetrzni" className="mt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">🚚 Zewnętrzni — {oddzialNazwa}</h2>
              <Button size="sm" onClick={() => { setEditZewn(null); setZewnModal(true); }}>+ Dodaj zewnętrznego</Button>
            </div>
            {loadingZewn ? (
              <p className="text-muted-foreground text-center py-4">Ładowanie...</p>
            ) : flotaZewn.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground">Brak pojazdów zewnętrznych</CardContent></Card>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nr rej.</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead className="text-right">Ładowność kg</TableHead>
                      <TableHead className="text-right">Max palet</TableHead>
                      <TableHead className="text-right">m³</TableHead>
                      <TableHead>Firma</TableHead>
                      <TableHead>Kierowca</TableHead>
                      <TableHead>Telefon</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flotaZewn.map(f => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono">{f.nr_rej}</TableCell>
                        <TableCell>{f.typ}</TableCell>
                        <TableCell className="text-right">{f.ladownosc_kg ?? '—'}</TableCell>
                        <TableCell className="text-right">{f.max_palet ?? '—'}</TableCell>
                        <TableCell className="text-right">{f.objetosc_m3 ?? '—'}</TableCell>
                        <TableCell>{f.firma || '—'}</TableCell>
                        <TableCell>{f.kierowca || '—'}</TableCell>
                        <TableCell>{f.tel || '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditZewn(f); setZewnModal(true); }}>✏️</Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => setDeleteZewn(f)}>🗑</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Kierowcy Tab ── */}
        <TabsContent value="kierowcy" className="mt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">👤 Kierowcy — {oddzialNazwa}</h2>
              <Button size="sm" onClick={() => { setEditKierowca(null); setKierowcaModal(true); }}>+ Dodaj kierowcę</Button>
            </div>
            {loadingKierowcy ? (
              <p className="text-muted-foreground text-center py-4">Ładowanie kierowców...</p>
            ) : kierowcyStatus.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground">Brak kierowców</CardContent></Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Imię i nazwisko</TableHead>
                    <TableHead>Uprawnienia</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead>Status dziś</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kierowcyStatus.map(k => {
                    const crudK = kierowcyCrud.find(c => c.id === k.id);
                    return (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium">{k.imie_nazwisko}</TableCell>
                        <TableCell>{k.uprawnienia || '—'}</TableCell>
                        <TableCell>{k.tel || '—'}</TableCell>
                        <TableCell>
                          {k.kurs_status ? (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">W kursie {k.kurs_numer || ''}</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Dostępny</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => {
                              if (crudK) { setEditKierowca(crudK); setKierowcaModal(true); }
                            }}>✏️</Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => { if (crudK) setDeleteKierowca(crudK); }}>🗑</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="kalendarz" className="mt-4">
          <KalendarzTab
            flota={flota} kierowcy={kierowcyStatus} flotaZewn={flotaZewn} kursy={kursy}
            businessDays={businessDays} loading={loadingKalendarz || loadingKierowcy || loadingZewn}
            isBlocked={isBlocked} onToggle={toggleBlokada}
          />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <PojazdModal
        open={pojazdModal} onClose={() => { setPojazdModal(false); setEditPojazd(null); }}
        pojazd={editPojazd} oddzialId={oddzialId} oddzialy={oddzialy}
        onSaved={onFlotaRefresh}
      />
      <ZewnetrznyModal
        open={zewnModal} onClose={() => { setZewnModal(false); setEditZewn(null); }}
        pojazd={editZewn} oddzialId={oddzialId} oddzialy={oddzialy}
        onSaved={refetchZewn}
      />
      <KierowcaModal
        open={kierowcaModal} onClose={() => { setKierowcaModal(false); setEditKierowca(null); }}
        kierowca={editKierowca} oddzialId={oddzialId} oddzialy={oddzialy}
        onSaved={refetchKierowcy}
      />
      <ConfirmDialog
        open={!!deletePojazd} onOpenChange={() => setDeletePojazd(null)}
        title="Dezaktywuj pojazd" description={`Czy na pewno chcesz dezaktywować pojazd ${deletePojazd?.nr_rej}?`}
        onConfirm={handleDeletePojazd} confirmLabel="Dezaktywuj" destructive
      />
      <ConfirmDialog
        open={!!deleteZewn} onOpenChange={() => setDeleteZewn(null)}
        title="Usuń pojazd zewnętrzny" description={`Czy na pewno chcesz usunąć pojazd ${deleteZewn?.nr_rej} (${deleteZewn?.firma})?`}
        onConfirm={handleDeleteZewn} confirmLabel="Usuń" destructive
      />
      <ConfirmDialog
        open={!!deleteKierowca} onOpenChange={() => setDeleteKierowca(null)}
        title="Dezaktywuj kierowcę" description={`Czy na pewno chcesz dezaktywować kierowcę ${deleteKierowca?.imie_nazwisko}?`}
        onConfirm={handleDeleteKierowca} confirmLabel="Dezaktywuj" destructive
      />
    </>
  );
}
