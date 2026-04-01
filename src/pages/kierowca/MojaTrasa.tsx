import { useState, useCallback } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useMojeKursyDzis } from '@/hooks/useMojeKursyDzis';
import { useKursActions } from '@/hooks/useKursActions';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ModalImportWZ, type WZImportData } from '@/components/shared/ModalImportWZ';
import { toast } from 'sonner';

function formatDate() {
  const d = new Date();
  const days = ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${day} ${dd}.${mm}`;
}

export default function KierowcaMojaTrasa() {
  const { user } = useAuth();
  const { kursy, loading, refetch } = useMojeKursyDzis();
  const { handleStart, handleStop, handlePrzystanek, acting } = useKursActions(refetch);
  const [showImport, setShowImport] = useState(false);
  const [domowienieKursId, setDomowienieKursId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDomowienie = useCallback((kursId: string) => {
    setDomowienieKursId(kursId);
    setShowImport(true);
  }, []);

  const handleImport = useCallback(async (data: WZImportData[]) => {
    if (!user || !domowienieKursId || data.length === 0) return;

    // Find the kurs to get oddzial_id and typ_pojazdu
    const kurs = kursy.find(k => k.id === domowienieKursId);
    if (!kurs) return;

    setSubmitting(true);

    const { data: numerData } = await supabase.rpc('generuj_numer_zlecenia', { p_oddzial_id: kurs.oddzial_id });
    const numer = (numerData as string) || `ZL-DOM-${Date.now().toString(36).toUpperCase()}`;
    const d = data[0];

    const { data: zlecenie, error: err1 } = await supabase
      .from('zlecenia')
      .insert({
        numer,
        oddzial_id: kurs.oddzial_id,
        typ_pojazdu: kurs.typ_pojazdu || null,
        dzien: new Date().toISOString().split('T')[0],
        preferowana_godzina: 'dowolna',
        nadawca_id: user.id,
        status: 'do_weryfikacji',
      })
      .select('id')
      .single();

    if (err1 || !zlecenie) {
      toast.error('Błąd zgłoszenia domówienia: ' + (err1?.message || ''));
      setSubmitting(false);
      return;
    }

    const { error: err2 } = await supabase.from('zlecenia_wz').insert({
      zlecenie_id: zlecenie.id,
      numer_wz: d.numer_wz,
      odbiorca: d.odbiorca || '',
      adres: d.adres || '',
      tel: d.tel,
      masa_kg: d.masa_kg || 0,
      objetosc_m3: 0,
      ilosc_palet: 0,
      uwagi: d.uwagi,
      nr_zamowienia: d.nr_zamowienia,
    });

    if (err2) {
      toast.error('Błąd zapisu WZ: ' + err2.message);
    } else {
      toast.success('✅ Domówienie zgłoszone — dyspozytor musi zatwierdzić');
    }

    setSubmitting(false);
    setShowImport(false);
    setDomowienieKursId(null);
    refetch();
  }, [user, domowienieKursId, kursy, refetch]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <main className="flex-1 w-full max-w-[480px] mx-auto px-5 py-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-foreground">🚛 Moje kursy</h1>
          <span className="text-sm text-muted-foreground">{formatDate()}</span>
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Ładowanie...</p>
        ) : kursy.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              Brak kursów na dziś
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {kursy.map(kurs => {
              const allDone = kurs.przystanki.length > 0 && kurs.przystanki.every(p => p.status === 'dostarczone' || p.status === 'nieudane');
              const done = kurs.przystanki.filter(p => p.status === 'dostarczone').length;

              return (
                <Card key={kurs.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <span className="font-mono">{kurs.nr_rej}</span>
                        <StatusBadge status={kurs.status} />
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">{done}/{kurs.przystanki.length} rozładunków</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {kurs.status === 'zaplanowany' && (
                        <Button size="sm" className="w-full" onClick={() => handleStart(kurs.id)} disabled={acting}>
                          🚀 Wyjeżdżam
                        </Button>
                      )}
                      {kurs.status === 'aktywny' && allDone && (
                        <Button size="sm" variant="secondary" className="w-full" onClick={() => handleStop(kurs.id)} disabled={acting}>
                          🏁 Wróciłem
                        </Button>
                      )}
                    </div>

                    {/* Przystanki */}
                    {kurs.przystanki.map(p => (
                      <div
                        key={p.id}
                        className={`p-3 rounded-lg border text-sm ${
                          p.status === 'dostarczone' ? 'bg-muted/50 opacity-60' : 'bg-card'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-0.5 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {p.status === 'dostarczone' ? '✅' : `📍 ${p.kolejnosc}.`} {p.odbiorca}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{p.adres}</p>
                            {p.tel && <p className="text-xs text-muted-foreground">📞 {p.tel}</p>}
                            <p className="text-xs">
                              {p.masa_kg} kg
                              {p.ilosc_palet > 0 && <> · 📦 {p.ilosc_palet} pal</>}
                              {p.nr_wz ? ` · WZ: ${p.nr_wz}` : ''}
                            </p>
                            {p.uwagi && <p className="text-xs text-warning">⚠️ {p.uwagi}</p>}
                          </div>
                          {p.status === 'oczekuje' && kurs.status === 'aktywny' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrzystanek(p.id)}
                              disabled={acting}
                              className="shrink-0"
                            >
                              ✓ Dostarczyłem
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Domówienie button - only for active courses */}
                    {kurs.status === 'aktywny' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-600 dark:text-orange-400 dark:hover:bg-orange-950"
                        onClick={() => handleDomowienie(kurs.id)}
                        disabled={submitting}
                      >
                        ➕ Domówienie
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <ModalImportWZ
        isOpen={showImport}
        onClose={() => { setShowImport(false); setDomowienieKursId(null); }}
        onImport={handleImport}
        hideXls
      />
    </div>
  );
}
