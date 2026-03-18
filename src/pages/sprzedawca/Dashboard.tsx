import { useState, useCallback } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOddzialy } from '@/hooks/useOddzialy';
import { useFlotaOddzialu } from '@/hooks/useFlotaOddzialu';
import { useCreateZlecenie, type WzInput } from '@/hooks/useCreateZlecenie';
import { toast } from 'sonner';
import { TypPojazduStep } from '@/components/sprzedawca/TypPojazduStep';
import { CzasDostawyStep } from '@/components/sprzedawca/CzasDostawyStep';
import { WzFormTabs } from '@/components/sprzedawca/WzFormTabs';
import { MojeZleceniaTab } from '@/components/sprzedawca/MojeZleceniaTab';

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
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0, uwagi: '',
  }]);

  const { oddzialy, loading: loadingOddzialy } = useOddzialy();
  const { flota, loading: loadingFlota } = useFlotaOddzialu(oddzialId);
  const { create, submitting, error } = useCreateZlecenie(onSuccess);

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
      typ_pojazdu: typPojazdu === 'bez_preferencji' ? '' : typPojazdu,
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
            onSubmit={handleSubmit}
          />
        )}
      </CardContent>
    </Card>
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
