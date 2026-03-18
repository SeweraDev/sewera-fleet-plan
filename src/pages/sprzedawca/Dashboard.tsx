import { useState, useCallback } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useOddzialy } from '@/hooks/useOddzialy';
import { useFlotaOddzialu } from '@/hooks/useFlotaOddzialu';
import { useMojeZlecenia } from '@/hooks/useMojeZlecenia';
import { useCreateZlecenie, type WzInput } from '@/hooks/useCreateZlecenie';
import { toast } from 'sonner';

const SIDEBAR_ITEMS = [
  { id: 'nowe', label: '➕ Nowe zlecenie' },
  { id: 'moje', label: '📋 Moje zlecenia' },
];

function NoweZlecenieForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [typPojazdu, setTypPojazdu] = useState('');
  const [dzien, setDzien] = useState('');
  const [godzina, setGodzina] = useState('');
  const [wzList, setWzList] = useState<WzInput[]>([{
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, uwagi: '',
  }]);

  const { oddzialy, loading: loadingOddzialy } = useOddzialy();
  const { flota, loading: loadingFlota } = useFlotaOddzialu(oddzialId);
  const { create, submitting, error } = useCreateZlecenie(onSuccess);

  const addWz = () => setWzList([...wzList, {
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, uwagi: '',
  }]);

  const updateWz = (idx: number, field: keyof WzInput, value: string | number) => {
    const copy = [...wzList];
    (copy[idx] as any)[field] = value;
    setWzList(copy);
  };

  const removeWz = (idx: number) => {
    if (wzList.length <= 1) return;
    setWzList(wzList.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (!oddzialId || !dzien || !godzina) {
      toast.error('Uzupełnij wszystkie pola');
      return;
    }
    if (wzList.some(w => !w.odbiorca || !w.adres || !w.masa_kg)) {
      toast.error('Uzupełnij dane WZ');
      return;
    }
    create({
      oddzial_id: oddzialId,
      typ_pojazdu: typPojazdu,
      dzien,
      preferowana_godzina: godzina,
      wz_list: wzList,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Nowe zlecenie — Krok {step}/3</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Oddział</Label>
              <Select onValueChange={v => setOddzialId(Number(v))} value={oddzialId?.toString() || ''}>
                <SelectTrigger><SelectValue placeholder={loadingOddzialy ? 'Ładowanie...' : 'Wybierz oddział'} /></SelectTrigger>
                <SelectContent>
                  {oddzialy.map(o => <SelectItem key={o.id} value={o.id.toString()}>{o.nazwa}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Typ pojazdu</Label>
              <Select onValueChange={setTypPojazdu} value={typPojazdu}>
                <SelectTrigger><SelectValue placeholder="Wybierz typ" /></SelectTrigger>
                <SelectContent>
                  {loadingFlota ? (
                    <SelectItem value="_loading" disabled>Ładowanie...</SelectItem>
                  ) : (
                    [...new Set(flota.map(f => f.typ))].map(typ => (
                      <SelectItem key={typ} value={typ}>{typ}</SelectItem>
                    ))
                  )}
                  <SelectItem value="zewnetrzny">Zewnętrzny</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setStep(2)} disabled={!oddzialId || !typPojazdu}>Dalej →</Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label>Dzień dostawy</Label>
              <Input type="date" value={dzien} onChange={e => setDzien(e.target.value)} />
            </div>
            <div>
              <Label>Preferowana godzina</Label>
              <Input type="time" value={godzina} onChange={e => setGodzina(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>← Wstecz</Button>
              <Button onClick={() => setStep(3)} disabled={!dzien || !godzina}>Dalej →</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-sm text-foreground">Pozycje WZ ({wzList.length})</h3>
            {wzList.map((wz, idx) => (
              <Card key={idx} className="p-3 space-y-2 bg-muted/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">WZ #{idx + 1}</span>
                  {wzList.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeWz(idx)} className="text-destructive h-6 text-xs">Usuń</Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Nr WZ</Label><Input className="h-8 text-sm" value={wz.numer_wz || ''} onChange={e => updateWz(idx, 'numer_wz', e.target.value)} /></div>
                  <div><Label className="text-xs">Nr zamówienia</Label><Input className="h-8 text-sm" value={wz.nr_zamowienia || ''} onChange={e => updateWz(idx, 'nr_zamowienia', e.target.value)} /></div>
                  <div><Label className="text-xs">Odbiorca *</Label><Input className="h-8 text-sm" value={wz.odbiorca} onChange={e => updateWz(idx, 'odbiorca', e.target.value)} /></div>
                  <div><Label className="text-xs">Adres *</Label><Input className="h-8 text-sm" value={wz.adres} onChange={e => updateWz(idx, 'adres', e.target.value)} /></div>
                  <div><Label className="text-xs">Telefon</Label><Input className="h-8 text-sm" value={wz.tel || ''} onChange={e => updateWz(idx, 'tel', e.target.value)} /></div>
                  <div><Label className="text-xs">Masa (kg) *</Label><Input className="h-8 text-sm" type="number" value={wz.masa_kg || ''} onChange={e => updateWz(idx, 'masa_kg', Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Objętość (m³)</Label><Input className="h-8 text-sm" type="number" value={wz.objetosc_m3 || ''} onChange={e => updateWz(idx, 'objetosc_m3', Number(e.target.value))} /></div>
                  <div className="col-span-2"><Label className="text-xs">Uwagi</Label><Input className="h-8 text-sm" value={wz.uwagi || ''} onChange={e => updateWz(idx, 'uwagi', e.target.value)} /></div>
                </div>
              </Card>
            ))}
            <Button variant="outline" size="sm" onClick={addWz}>+ Dodaj WZ</Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>← Wstecz</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Wysyłanie...' : 'Złóż zlecenie'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MojeZleceniaTab() {
  const [statusFilter, setStatusFilter] = useState('wszystkie');
  const { zlecenia, loading } = useMojeZlecenia(statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-sm">Status:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="wszystkie">Wszystkie</SelectItem>
            <SelectItem value="robocza">Robocza</SelectItem>
            <SelectItem value="potwierdzona">Potwierdzona</SelectItem>
            <SelectItem value="w_trasie">W trasie</SelectItem>
            <SelectItem value="dostarczona">Dostarczona</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Ładowanie...</p>
      ) : zlecenia.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Brak zleceń</CardContent></Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dzień</TableHead>
              <TableHead>Oddział</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead className="text-right">WZ</TableHead>
              <TableHead className="text-right">Kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {zlecenia.map(z => (
              <TableRow key={z.id}>
                <TableCell className="font-mono text-sm">{z.numer}</TableCell>
                <TableCell><StatusBadge status={z.status} /></TableCell>
                <TableCell>{z.dzien}</TableCell>
                <TableCell>{z.oddzial}</TableCell>
                <TableCell>{z.typ_pojazdu || '—'}</TableCell>
                <TableCell className="text-right">{z.liczba_wz}</TableCell>
                <TableCell className="text-right">{Math.round(z.suma_kg)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function SprzedawcaDashboard() {
  const [activeId, setActiveId] = useState('nowe');

  const handleSuccess = useCallback(() => {
    setActiveId('moje');
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <div className="flex flex-1">
        <PageSidebar items={SIDEBAR_ITEMS} activeId={activeId} onSelect={setActiveId} />
        <main className="flex-1 p-6 overflow-auto">
          {activeId === 'nowe' && <NoweZlecenieForm onSuccess={handleSuccess} />}
          {activeId === 'moje' && <MojeZleceniaTab />}
        </main>
      </div>
    </div>
  );
}
