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
import { wyciagnijOddzialZNumeru, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';
import { wyciagnijDateZUwag, wyciagnijGodzineZUwag, domyslnyDzienDostawy, getMaxWymiarMm } from '@/lib/wzAutoFill';
import { detektujTypKlienta } from '@/lib/detekcjaTypuKlienta';
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
  const [oddzialId, setOddzialIdRaw] = useState<number | null>(null);
  const [typPojazdu, setTypPojazdu] = useState('');
  const [typKlienta, setTypKlienta] = useState('');
  const [dzien, setDzienRaw] = useState(domyslnyDzienDostawy());
  const [godzina, setGodzinaRaw] = useState('dowolna');
  // Flagi Smart Prefill — pomarańczowa ramka w UI gdy wartość pochodzi z auto-importu
  // (zniknie po ręcznej zmianie przez sprzedawcę = potwierdzenie weryfikacji).
  const [oddzialAutoSet, setOddzialAutoSet] = useState(false);
  const [dzienAutoSet, setDzienAutoSet] = useState(false);
  const [godzinaAutoSet, setGodzinaAutoSet] = useState(false);
  const [typKlientaAutoSet, setTypKlientaAutoSet] = useState(false);
  // Wrappery które resetują flagę gdy user manualnie zmieni wartość
  const setOddzialId = useCallback((v: number | null) => { setOddzialIdRaw(v); setOddzialAutoSet(false); }, []);
  const setDzien = useCallback((v: string) => { setDzienRaw(v); setDzienAutoSet(false); }, []);
  const setGodzina = useCallback((v: string) => { setGodzinaRaw(v); setGodzinaAutoSet(false); }, []);
  const setTypKlientaWrap = useCallback((v: string) => { setTypKlienta(v); setTypKlientaAutoSet(false); }, []);
  const [wzList, setWzList] = useState<WzInput[]>([{
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0, bez_palet: false, luzne_karton: false, uwagi: '', klasyfikacja: '', wartosc_netto: null,
  }]);
  const { oddzialy, loading: loadingOddzialy } = useOddzialy();
  const { flota, loading: loadingFlota } = useFlotaOddzialu(oddzialId);
  const { create, submitting, error } = useCreateZlecenie(onSuccess);
  // Drugi instans hooka dla trybu bulk — bez per-call onSuccess (sami wywolamy po petli)
  const { create: createBulkOne, submitting: bulkSubmitting } = useCreateZlecenie();

  const handleBulkSubmit = useCallback(async (wzListPerZlecenie: WzInput[][]) => {
    if (!oddzialId || !dzien || !godzina) {
      toast.error('Wroc do wczesniejszych krokow i uzupelnij oddzial / dzien / godzine');
      return;
    }
    let okCount = 0;
    let failCount = 0;
    for (const wzList of wzListPerZlecenie) {
      try {
        await createBulkOne({
          oddzial_id: oddzialId,
          typ_pojazdu: typPojazdu === 'bez_preferencji' ? '' : typPojazdu,
          typ_klienta: typKlienta,
          dzien,
          preferowana_godzina: godzina,
          wz_list: wzList,
        }, false);
        okCount++;
      } catch {
        failCount++;
      }
    }
    if (okCount > 0) {
      toast.success(`✅ Utworzono ${okCount} ${okCount === 1 ? 'zlecenie' : okCount < 5 ? 'zlecenia' : 'zlecen'}${failCount > 0 ? ` (${failCount} bledow)` : ''}`);
      onSuccess();
    } else {
      toast.error('Nie udalo sie utworzyc zadnego zlecenia');
    }
  }, [oddzialId, dzien, godzina, typPojazdu, typKlienta, createBulkOne, onSuccess]);

  // Walidacja WZ (kompletność pól) + przejście do kolejnego kroku.
  // Po refactorze 13.05.2026: import WZ jest Krokiem 1, więc po walidacji
  // przechodzimy do Kroku 2 (TypPojazduStep). Klasyfikacja zostaje opcjonalna —
  // jeśli typ pojazdu zostanie wybrany w Kroku 2, klasyfikacja auto-uzupełni się.
  const handleZatwierdzWZ = () => {
    const invalid = wzList.find(w => {
      if (!w.odbiorca || !w.masa_kg) return true;
      if (!w.adres || w.adres.trim().length < 5) return true;
      if (!w.tel || w.tel.trim().length < 5) return true;
      if (!w.luzne_karton && (!w.objetosc_m3 || w.objetosc_m3 <= 0)) return true;
      if (!w.bez_palet && (!w.ilosc_palet || w.ilosc_palet <= 0)) return true;
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
      toast.error(`Uzupełnij: ${missing.join(', ')}`);
      return;
    }
    setStep(2);
  };

  const handleSubmit = (forceVerify: boolean, pominietaOszczednosc?: number | null) => {
    if (!oddzialId || !dzien || !godzina) {
      toast.error('Uzupełnij wszystkie pola');
      return;
    }
    create({
      oddzial_id: oddzialId,
      typ_pojazdu: typPojazdu === 'bez_preferencji' ? '' : typPojazdu,
      typ_klienta: typKlienta,
      dzien,
      preferowana_godzina: godzina,
      wz_list: wzList,
      pominieta_oszczednosc_pln: pominietaOszczednosc ?? null,
    }, forceVerify);
  };

  // Po imporcie WZ z PDF/OCR/Paste — smart prefill (sesja 13.05.2026):
  //  1. Wykryj oddział z prefiksu numeru WZ/zamówienia (KK→KAT, RE→R, SO→SOS,
  //     OM→OS, GL/TG/CH/DG identyczne). Toast z akcją zmiany gdy różny.
  //  2. Wyciągnij datę dostawy z uwag ("transport DD.MM.YYYY") → setDzien.
  //  Nieznany prefix → user uzupełnia ręcznie (decyzja 3.C).
  const handleWzImported = useCallback((wz: WzInput) => {
    // 1. Detekcja oddziału — AUTO-SET z pomarańczową flagą (do weryfikacji).
    // Używamy raw setterów (setOddzialIdRaw/setDzienRaw) żeby NIE wyzerować flagi
    // która jest ustawiana zaraz potem przez setOddzialAutoSet(true).
    const detectedKod = wyciagnijOddzialZNumeru(wz.numer_wz, wz.nr_zamowienia);
    if (detectedKod) {
      const detectedOddzial = oddzialy.find(o => NAZWA_TO_KOD[o.nazwa] === detectedKod);
      if (detectedOddzial && detectedOddzial.id !== oddzialId) {
        setOddzialIdRaw(detectedOddzial.id);
        setOddzialAutoSet(true);
        toast.info(`📍 Oddział: ${detectedOddzial.nazwa} (z numeru WZ — sprawdź)`, { duration: 5000 });
      }
    }
    // 2. Data dostawy z uwag — AUTO-SET z pomarańczową flagą
    const dataZUwag = wyciagnijDateZUwag(wz.uwagi);
    if (dataZUwag && dataZUwag !== dzien) {
      setDzienRaw(dataZUwag);
      setDzienAutoSet(true);
      toast.info(`📅 Data dostawy: ${dataZUwag} (z uwag WZ — sprawdź)`, { duration: 5000 });
    }
    // 2b. Godzina z uwag — AUTO-SET z pomarańczową flagą
    const godzinaZUwag = wyciagnijGodzineZUwag(wz.uwagi);
    if (godzinaZUwag && godzinaZUwag !== godzina) {
      setGodzinaRaw(godzinaZUwag);
      setGodzinaAutoSet(true);
      toast.info(`🕗 Godzina: ${godzinaZUwag} (z uwag WZ — sprawdź)`, { duration: 5000 });
    }
    // 3. Typ klienta — AUTO-DETEKCJA z kodu klienta (R), uwag (B2C), nazwy (D), fallback W.
    // Async bo R wymaga query do tabeli klienci_redystrybucja.
    detektujTypKlienta({
      kodKlienta: wz._kod_klienta,
      odbiorca: wz.odbiorca,
      uwagi: wz.uwagi,
    }).then((typ) => {
      if (typ && typ !== typKlienta) {
        setTypKlienta(typ);
        setTypKlientaAutoSet(true);
        const labelMap: Record<string, string> = { R: 'Redystrybucyjny', B: 'B2C', D: 'Detaliczny', W: 'Wykonawca' };
        const why: Record<string, string> = {
          R: 'kod klienta w bazie redystrybucji',
          B: 'B2C w uwagach',
          D: 'osoba fizyczna (imię + nazwisko)',
          W: 'default (brak innego dopasowania)',
        };
        toast.info(`👤 Typ klienta: ${labelMap[typ] || typ} (${why[typ] || 'auto'} — sprawdź)`, { duration: 5000 });
      }
    }).catch((err) => console.warn('[Dashboard] detektujTypKlienta failed:', err));
  }, [oddzialId, oddzialy, dzien, godzina, typKlienta]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Nowe zlecenie — Krok {step}/4</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Krok 1: Import dokumentu WZ (refactor 13.05.2026 — zaczynamy od WZ
            zamiast od oddziału/typu, bo z dokumentu auto-wypełnimy większość pól) */}
        {step === 1 && (
          <WzFormTabs
            wzList={wzList} setWzList={setWzList}
            error={error} submitting={submitting}
            onSubmit={handleZatwierdzWZ}
            typPojazdu={typPojazdu}
            onBulkSubmit={handleBulkSubmit}
            bulkSubmitting={bulkSubmitting}
            onWzImported={handleWzImported}
          />
        )}
        {/* Krok 2: Oddział + typ pojazdu + typ klienta (pre-wypełniony z WZ) */}
        {step === 2 && (
          <TypPojazduStep
            oddzialId={oddzialId} setOddzialId={setOddzialId}
            typPojazdu={typPojazdu} setTypPojazdu={setTypPojazdu}
            typKlienta={typKlienta} setTypKlienta={setTypKlientaWrap}
            oddzialy={oddzialy} loadingOddzialy={loadingOddzialy}
            flota={flota} loadingFlota={loadingFlota}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            oddzialAutoSet={oddzialAutoSet}
            typKlientaAutoSet={typKlientaAutoSet}
            wymagaHds={wzList.some(w => w._wymaga_hds)}
            dzialyHds={[...new Set(wzList.flatMap(w => w._dzialy_hds || []))]}
            sumaPalet={wzList.reduce((s, w) => s + (w.ilosc_palet || 0), 0)}
            paletyGips={wzList.reduce((s, w) => s + (w._palety_gips || 0), 0)}
            paletyInneHds={wzList.reduce((s, w) => s + (w._palety_inne_hds || 0), 0)}
            adresDostawy={wzList[0]?.adres}
            sumaMasa={wzList.reduce((s, w) => s + (w.masa_kg || 0), 0)}
            sumaM3={wzList.reduce((s, w) => s + (w.objetosc_m3 || 0), 0)}
            maxWymiarMm={wzList
              .flatMap(w => w.pozycje || [])
              .reduce((m, p) => Math.max(m, getMaxWymiarMm(p)), 0)}
          />
        )}
        {/* Krok 3: Dzień + godzina (pre-wypełniony z uwag WZ lub default) */}
        {step === 3 && (
          <CzasDostawyStep
            dzien={dzien} setDzien={setDzien}
            godzina={godzina} setGodzina={setGodzina}
            oddzialId={oddzialId}
            typPojazdu={typPojazdu}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            dzienAutoSet={dzienAutoSet}
            godzinaAutoSet={godzinaAutoSet}
          />
        )}
        {/* Krok 4: Sprawdzenie dostępności + banner kosztów + złóż zlecenie */}
        {step === 4 && oddzialId && (
          <DostepnoscStep
            oddzialId={oddzialId}
            oddzialNazwa={oddzialy.find(o => o.id === oddzialId)?.nazwa || ''}
            typPojazdu={typPojazdu}
            dzien={dzien}
            godzina={godzina}
            wzList={wzList}
            oddzialy={oddzialy}
            onBack={() => setStep(3)}
            onSubmit={handleSubmit}
            submitting={submitting}
            onChangeDzien={(newDzien) => { setDzien(newDzien); setStep(3); }}
            onChangeGodzina={(newGodzina) => { setGodzina(newGodzina); setStep(3); }}
            onChangeOddzial={(newOddzialId) => { setOddzialId(newOddzialId); setStep(2); }}
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
