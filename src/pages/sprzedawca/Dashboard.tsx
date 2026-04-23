import { useState, useCallback } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOddzialy } from '@/hooks/useOddzialy';
import { useFlotaOddzialu } from '@/hooks/useFlotaOddzialu';
import { useCreateZlecenie, type WzInput } from '@/hooks/useCreateZlecenie';
import { toast } from 'sonner';
import { TypPojazduStep } from '@/components/sprzedawca/TypPojazduStep';
import { CzasDostawyStep } from '@/components/sprzedawca/CzasDostawyStep';
import { WzFormTabs } from '@/components/sprzedawca/WzFormTabs';
import { DostepnoscStep } from '@/components/sprzedawca/DostepnoscStep';
import { MojeZleceniaTab } from '@/components/sprzedawca/MojeZleceniaTab';
import { WycenTransportTab } from '@/components/shared/WycenTransportTab';
import { KolejkaTab } from '@/components/dyspozytor/KolejkaTab';
import { useAuth } from '@/hooks/useAuth';

const SIDEBAR_ITEMS = [
  { id: 'nowe', label: '➕ Nowe zlecenie' },
  { id: 'moje', label: '📋 Moje zlecenia' },
  { id: 'podglad', label: '🔍 Podgląd zleceń' },
  { id: 'wycen', label: '💰 Wyceń transport' },
  { id: 'mapa', label: '🗺️ Mapa dostaw', url: '/mapa' },
];

function PodgladZlecenWrapper() {
  const { oddzialy } = useOddzialy();
  const today = new Date().toISOString().split('T')[0];
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [dzien, setDzien] = useState(today);
  const [rangeMode, setRangeMode] = useState(false);
  const [dzienDo, setDzienDo] = useState(today);

  const oddzialNazwa = oddzialy.find(o => o.id === oddzialId)?.nazwa || '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">🔍 Podgląd zleceń</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <Label className="text-xs text-muted-foreground">Oddział</Label>
            <Select value={oddzialId?.toString() || ''} onValueChange={v => setOddzialId(Number(v))}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
              <SelectContent>
                {oddzialy.map(o => <SelectItem key={o.id} value={o.id.toString()}>{o.nazwa}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{rangeMode ? 'Od' : 'Dzień'}</Label>
            <Input type="date" value={dzien} onChange={e => setDzien(e.target.value)} className="w-40" />
          </div>
          {rangeMode && (
            <div>
              <Label className="text-xs text-muted-foreground">Do</Label>
              <Input type="date" value={dzienDo} onChange={e => setDzienDo(e.target.value)} className="w-40" />
            </div>
          )}
          <Button
            size="sm"
            variant={rangeMode ? 'default' : 'outline'}
            onClick={() => setRangeMode(!rangeMode)}
          >
            📅 Zakres
          </Button>
        </div>
        <KolejkaTab
          oddzialId={oddzialId}
          oddzialNazwa={oddzialNazwa}
          dzien={dzien}
          dzienDo={rangeMode ? dzienDo : undefined}
        />
      </CardContent>
    </Card>
  );
}

function NoweZlecenieForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [oddzialId, setOddzialId] = useState<number | null>(null);
  const [typPojazdu, setTypPojazdu] = useState('');
  const [dzien, setDzien] = useState('');
  const [godzina, setGodzina] = useState('');
  const [wzList, setWzList] = useState<WzInput[]>([{
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0, bez_palet: false, luzne_karton: false, uwagi: '', klasyfikacja: '',
  }]);
  const { oddzialy, loading: loadingOddzialy } = useOddzialy();
  const { flota, loading: loadingFlota } = useFlotaOddzialu(oddzialId);
  const { create, submitting, error } = useCreateZlecenie(onSuccess);

  const handleGoToCheck = () => {
    const invalid = wzList.find(w => {
      if (!w.odbiorca || !w.masa_kg) return true;
      if (!w.adres || w.adres.trim().length < 5) return true;
      if (!w.tel || w.tel.trim().length < 5) return true;
      if (!w.luzne_karton && (!w.objetosc_m3 || w.objetosc_m3 <= 0)) return true;
      if (!w.bez_palet && (!w.ilosc_palet || w.ilosc_palet <= 0)) return true;
      if (!w.klasyfikacja) return true;
      return false;
    });
    if (invalid) {
      const missing: string[] = [];
      if (!invalid.odbiorca) missing.push('odbiorca');
      if (!invalid.adres || invalid.adres.trim().length < 5) missing.push('adres dostawy');
      if (!invalid.tel || invalid.tel.trim().length < 5) missing.push('telefon kontaktowy');
      if (!invalid.masa_kg) missing.push('masa kg');
      if (!invalid.luzne_karton && (!invalid.objetosc_m3 || invalid.objetosc_m3 <= 0)) missing.push('objętość m³');
      if (!invalid.bez_palet && (!invalid.ilosc_palet || invalid.ilosc_palet <= 0)) missing.push('ilość palet');
      if (!invalid.klasyfikacja) missing.push('klasyfikacja transportu');
      toast.error(`Uzupełnij: ${missing.join(', ')}`);
      return;
    }
    setStep(4);
  };

  const handleSubmit = (forceVerify: boolean) => {
    if (!oddzialId || !dzien || !godzina) {
      toast.error('Uzupełnij wszystkie pola');
      return;
    }
    create({
      oddzial_id: oddzialId,
      typ_pojazdu: typPojazdu === 'bez_preferencji' ? '' : typPojazdu,
      dzien,
      preferowana_godzina: godzina,
      wz_list: wzList,
    }, forceVerify);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Nowe zlecenie — Krok {step}/4</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <TypPojazduStep
            oddzialId={oddzialId} setOddzialId={setOddzialId}
            typPojazdu={typPojazdu} setTypPojazdu={setTypPojazdu}
            oddzialy={oddzialy} loadingOddzialy={loadingOddzialy}
            flota={flota} loadingFlota={loadingFlota}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <CzasDostawyStep
            dzien={dzien} setDzien={setDzien}
            godzina={godzina} setGodzina={setGodzina}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <WzFormTabs
            wzList={wzList} setWzList={setWzList}
            error={error} submitting={submitting}
            onBack={() => setStep(2)}
            onSubmit={handleGoToCheck}
            typPojazdu={typPojazdu}
          />
        )}
        {step === 4 && oddzialId && (
          <DostepnoscStep
            oddzialId={oddzialId}
            typPojazdu={typPojazdu}
            dzien={dzien}
            godzina={godzina}
            wzList={wzList}
            onBack={() => setStep(3)}
            onSubmit={handleSubmit}
            submitting={submitting}
            onChangeDzien={(newDzien) => { setDzien(newDzien); setStep(2); }}
            onChangeGodzina={(newGodzina) => { setGodzina(newGodzina); setStep(2); }}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function SprzedawcaDashboard() {
  const [activeId, setActiveId] = useState('nowe');
  const { profile } = useAuth();

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
          {activeId === 'podglad' && <PodgladZlecenWrapper />}
          {activeId === 'wycen' && <WycenTransportTab oddzialNazwa={profile?.branch || 'Katowice'} />}
        </main>
      </div>
    </div>
  );
}
