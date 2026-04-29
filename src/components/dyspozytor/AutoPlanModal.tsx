import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { geocodeAddress, NAZWA_TO_KOD, ODDZIAL_COORDS } from '@/lib/oddzialy-geo';
import { ZMIANY, ZMIANA_DEFAULT, type ZmianaKod } from '@/lib/planConfig';
import { planTras, type ZlecenieDoPlanu, type WzDoPlanu, type PojazdSlot, type KierowcaSlot, type PlanResult } from '@/lib/planTras';
import { suggestCrossBranch, type InnyOddzialFloty } from '@/lib/crossBranchSuggest';

interface Props {
  open: boolean;
  onClose: () => void;
  oddzialId: number;
  oddzialNazwa: string;
  dzien: string;
  /** Po akceptacji propozycji — refetch w Dashboardzie. */
  onPlanZapisany?: () => void;
}

type KierowcaWybor = {
  kierowca_id: string;
  imie_nazwisko: string;
  uprawnienia: string;
  zmiana: ZmianaKod | 'OFF';
};

/**
 * Modal auto-planowania tras dla dyspozytora.
 *
 * Flow:
 *   1. Open: pobierz zlecenia bez kursu + flotę + kierowców
 *   2. Dyspozytor wybiera zmianę dla każdego kierowcy (lub OFF)
 *   3. Klik "Zaplanuj" -> geocoding adresów -> planTras() + suggestCrossBranch()
 *   4. Wyniki: lista kursów + cross-branch sugestie + niezaplanowane
 *   5. (Faza 4b) akcje: akceptuj wszystko / akceptuj jeden / edytuj / odrzuć
 */
export function AutoPlanModal({ open, onClose, oddzialId, oddzialNazwa, dzien, onPlanZapisany: _onPlanZapisany }: Props) {
  const [step, setStep] = useState<'config' | 'planning' | 'wynik'>('config');
  const [kierowcy, setKierowcy] = useState<KierowcaWybor[]>([]);
  const [loadingDane, setLoadingDane] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [progressMsg, setProgressMsg] = useState('');

  // Reset stanu po zamknieciu
  useEffect(() => {
    if (!open) {
      setStep('config');
      setPlanResult(null);
      setError(null);
      setProgressMsg('');
    }
  }, [open]);

  // Pobierz kierowcow oddzialu po otwarciu
  useEffect(() => {
    if (!open || oddzialId == null) return;
    setLoadingDane(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('kierowcy')
          .select('id, imie_nazwisko, uprawnienia, aktywny')
          .eq('oddzial_id', oddzialId)
          .eq('aktywny', true)
          .order('imie_nazwisko');
        // Sprawdz blokady na ten dzien
        const { data: blokady } = await supabase
          .from('blokady')
          .select('zasob_id, typ')
          .eq('typ', 'kierowca')
          .lte('od', dzien)
          .gte('do', dzien);
        const zablokowani = new Set((blokady || []).map((b) => b.zasob_id));
        setKierowcy(
          (data || []).map((k) => ({
            kierowca_id: k.id,
            imie_nazwisko: k.imie_nazwisko,
            uprawnienia: k.uprawnienia || '',
            zmiana: zablokowani.has(k.id) ? 'OFF' : ZMIANA_DEFAULT,
          }))
        );
      } catch (e: any) {
        setError('Błąd ładowania kierowców: ' + (e?.message || 'nieznany'));
      } finally {
        setLoadingDane(false);
      }
    })();
  }, [open, oddzialId, dzien]);

  const setZmiana = (kierowcaId: string, zmiana: ZmianaKod | 'OFF') => {
    setKierowcy((prev) => prev.map((k) => (k.kierowca_id === kierowcaId ? { ...k, zmiana } : k)));
  };

  const handleZaplanuj = async () => {
    setStep('planning');
    setError(null);
    setProgressMsg('Pobieranie zleceń...');
    try {
      // 1. Zlecenia bez kursu z tego dnia/oddzialu
      const { data: zlData } = await supabase
        .from('zlecenia')
        .select('id, numer, oddzial_id, typ_pojazdu, preferowana_godzina, kurs_id, status')
        .eq('oddzial_id', oddzialId)
        .eq('dzien', dzien)
        .is('kurs_id', null)
        .in('status', ['robocza', 'do_weryfikacji']);
      const zlecIds = (zlData || []).map((z) => z.id);
      if (zlecIds.length === 0) {
        setError('Brak niezaplanowanych zleceń na ten dzień.');
        setStep('config');
        return;
      }

      // 2. WZ dla tych zlecen
      setProgressMsg('Pobieranie WZ...');
      const { data: wzData } = await supabase
        .from('zlecenia_wz')
        .select('id, zlecenie_id, odbiorca, adres, masa_kg, objetosc_m3, ilosc_palet, klasyfikacja, uwagi')
        .in('zlecenie_id', zlecIds);

      // 3. Geocoding adresów
      setProgressMsg('Geocoding adresów...');
      const wzZGeo: Map<string, { lat: number; lng: number } | null> = new Map();
      const adresyDoGeocode = Array.from(new Set((wzData || []).map((w) => w.adres).filter(Boolean)));
      for (const adres of adresyDoGeocode) {
        const coords = await geocodeAddress(adres);
        wzZGeo.set(adres, coords);
      }
      const niezgeokod = adresyDoGeocode.filter((a) => !wzZGeo.get(a));
      if (niezgeokod.length > 0) {
        console.warn('[AutoPlan] niezlokalizowane adresy:', niezgeokod);
      }

      // 4. Buduj zlecenia do planu
      const zleceniaPlanu: ZlecenieDoPlanu[] = (zlData || []).map((z) => {
        const wzList: WzDoPlanu[] = (wzData || [])
          .filter((w) => w.zlecenie_id === z.id)
          .map((w) => {
            const geo = wzZGeo.get(w.adres) || { lat: 0, lng: 0 };
            return {
              wz_id: w.id,
              odbiorca: w.odbiorca || '',
              adres: w.adres || '',
              lat: geo?.lat ?? 0,
              lng: geo?.lng ?? 0,
              masa_kg: Number(w.masa_kg) || 0,
              objetosc_m3: w.objetosc_m3 != null ? Number(w.objetosc_m3) : null,
              ilosc_palet: w.ilosc_palet != null ? Number(w.ilosc_palet) : null,
              klasyfikacja: w.klasyfikacja,
              uwagi: w.uwagi,
            };
          })
          .filter((w) => w.lat !== 0 && w.lng !== 0); // pomin niezlokalizowane

        return {
          zlecenie_id: z.id,
          numer: z.numer,
          oddzial_id: z.oddzial_id,
          typ_pojazdu: z.typ_pojazdu,
          preferowana_godzina: z.preferowana_godzina,
          wz_list: wzList,
        };
      }).filter((z) => z.wz_list.length > 0);

      if (zleceniaPlanu.length === 0) {
        setError('Brak zleceń z prawidłowymi adresami (geocoding nie zwrócił współrzędnych).');
        setStep('config');
        return;
      }

      // 5. Pojazdy oddziału (Sewera + zewnetrzne)
      setProgressMsg('Pobieranie floty...');
      const { data: flotaData } = await supabase
        .from('flota')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet, aktywny')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true);
      const { data: flotaZewData } = await supabase
        .from('flota_zewnetrzna')
        .select('nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet, aktywny')
        .eq('oddzial_id', oddzialId)
        .eq('aktywny', true);

      const pojazdy: PojazdSlot[] = [
        ...(flotaData || []).map((f) => ({
          flota_id: f.id,
          nr_rej: f.nr_rej,
          typ: f.typ,
          ladownosc_kg: Number(f.ladownosc_kg) || 0,
          objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
          max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
          is_zewnetrzny: false,
        })),
        ...(flotaZewData || []).map((f) => ({
          flota_id: null,
          nr_rej: f.nr_rej,
          typ: f.typ,
          ladownosc_kg: Number(f.ladownosc_kg) || 0,
          objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
          max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
          is_zewnetrzny: true,
        })),
      ];

      // Sprawdz blokady pojazdow
      const { data: blokadyPoj } = await supabase
        .from('blokady')
        .select('zasob_id, typ')
        .eq('typ', 'pojazd')
        .lte('od', dzien)
        .gte('do', dzien);
      const zablokowanePojazdy = new Set((blokadyPoj || []).map((b) => b.zasob_id));
      const pojazdyDostepne = pojazdy.filter(
        (p) => !p.flota_id || !zablokowanePojazdy.has(p.flota_id)
      );

      // 6. Wybrani kierowcy (zmiana != OFF)
      const kierowcySloty: KierowcaSlot[] = kierowcy
        .filter((k) => k.zmiana !== 'OFF')
        .map((k) => ({
          kierowca_id: k.kierowca_id,
          imie_nazwisko: k.imie_nazwisko,
          zmiana: k.zmiana as ZmianaKod,
          ma_hds: /HDS|hds/.test(k.uprawnienia),
        }));

      // 7. Baza oddzialu
      const kodOddz = NAZWA_TO_KOD[oddzialNazwa];
      const baza = ODDZIAL_COORDS[kodOddz];
      if (!baza) {
        setError(`Brak współrzędnych dla oddziału ${oddzialNazwa}`);
        setStep('config');
        return;
      }

      // 8. Plan
      setProgressMsg('Planowanie tras...');
      const wynik = await planTras({
        oddzial_id: oddzialId,
        oddzial_nazwa: oddzialNazwa,
        oddzial_baza: { lat: baza.lat, lng: baza.lng },
        dzien,
        zlecenia: zleceniaPlanu,
        pojazdy: pojazdyDostepne,
        kierowcy: kierowcySloty,
      });

      // 9. Cross-branch — pobierz floty innych oddzialow ktore moga obsluzyc niezaplanowane
      setProgressMsg('Sprawdzanie cross-branch...');
      const { data: oddzialy } = await supabase.from('oddzialy').select('id, nazwa').neq('id', oddzialId);
      const innyOddzialFloty: InnyOddzialFloty[] = [];
      for (const o of oddzialy || []) {
        const kod = NAZWA_TO_KOD[o.nazwa];
        if (!kod) continue;
        const { data: fOdd } = await supabase
          .from('flota')
          .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
          .eq('oddzial_id', o.id)
          .eq('aktywny', true);
        const { data: fOddZ } = await supabase
          .from('flota_zewnetrzna')
          .select('nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
          .eq('oddzial_id', o.id)
          .eq('aktywny', true);
        innyOddzialFloty.push({
          oddzial_id: o.id,
          nazwa: o.nazwa,
          kod,
          pojazdy: [
            ...(fOdd || []).map((f) => ({
              flota_id: f.id,
              nr_rej: f.nr_rej,
              typ: f.typ,
              ladownosc_kg: Number(f.ladownosc_kg) || 0,
              objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
              max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
              is_zewnetrzny: false,
            })),
            ...(fOddZ || []).map((f) => ({
              flota_id: null,
              nr_rej: f.nr_rej,
              typ: f.typ,
              ladownosc_kg: Number(f.ladownosc_kg) || 0,
              objetosc_m3: f.objetosc_m3 != null ? Number(f.objetosc_m3) : null,
              max_palet: (f as any).max_palet != null ? Number((f as any).max_palet) : null,
              is_zewnetrzny: true,
            })),
          ],
        });
      }

      const crossBranch = suggestCrossBranch({
        niezaplanowane: wynik.niezaplanowane,
        oddzialAktualnyKod: kodOddz,
        innyOddzialFloty,
      });

      setPlanResult({
        ...wynik,
        crossBranch,
      });
      setStep('wynik');
    } catch (e: any) {
      console.error('[AutoPlan] error:', e);
      setError('Błąd planowania: ' + (e?.message || 'nieznany'));
      setStep('config');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>🤖 Auto-plan tras — {oddzialNazwa}, {dzien}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">
            ❌ {error}
          </div>
        )}

        {/* === STAGE: config === */}
        {step === 'config' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-2">Dostępność kierowców i zmiany</h3>
              {loadingDane ? (
                <p className="text-sm text-muted-foreground">Ładowanie kierowców...</p>
              ) : kierowcy.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak aktywnych kierowców w oddziale.</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {kierowcy.map((k) => (
                    <div key={k.kierowca_id} className="flex items-center justify-between gap-3 p-2 border rounded">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{k.imie_nazwisko}</div>
                        <div className="text-xs text-muted-foreground truncate">{k.uprawnienia || '—'}</div>
                      </div>
                      <Select
                        value={k.zmiana}
                        onValueChange={(v) => setZmiana(k.kierowca_id, v as ZmianaKod | 'OFF')}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ZMIANY.map((z) => (
                            <SelectItem key={z.kod} value={z.kod}>
                              {z.label}
                            </SelectItem>
                          ))}
                          <SelectItem value="OFF">Niedostępny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === STAGE: planning === */}
        {step === 'planning' && (
          <div className="py-8 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{progressMsg}</p>
          </div>
        )}

        {/* === STAGE: wynik === */}
        {step === 'wynik' && planResult && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              ✅ Zaplanowano {planResult.kursy.length} kurs(ów),
              {' '}{planResult.niezaplanowane.length} niezaplanowanych,
              {' '}{planResult.crossBranch.length} sugestii cross-branch
              {planResult.liczba_z_proxy > 0 && (
                <span className="ml-2 text-orange-600">
                  ⚠ {planResult.liczba_z_proxy} paczek bez m³/palet — szacowanie z wagi
                </span>
              )}
            </div>

            {/* Lista kursow */}
            {planResult.kursy.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">Proponowane kursy</h3>
                <div className="space-y-2">
                  {planResult.kursy.map((k, i) => (
                    <Card key={k.kurs_id_tmp} className="p-3">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            #{i + 1} • {k.pojazd.nr_rej} ({k.pojazd.typ})
                            {k.pojazd.is_zewnetrzny && <span className="ml-1 text-orange-600">[zew]</span>}
                            {' • '}{k.kierowca?.imie_nazwisko ?? '—'}
                            {' • start '}{k.start_czas}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {k.przystanki.length} przyst. • {k.km_total} km •{' '}
                            {Math.round(k.czas_total_min / 60 * 10) / 10}h •{' '}
                            {Math.round(k.suma_kg)} kg
                            {k.suma_m3 > 0 && ` • ${k.suma_m3} m³`}
                            {k.suma_palet > 0 && ` • ${k.suma_palet} pal.`}
                          </div>
                          <div className="text-xs mt-2 space-y-0.5">
                            {k.przystanki.map((p, pi) => (
                              <div key={p.klucz_adresu} className="flex gap-2">
                                <span className="text-muted-foreground">{pi + 1}.</span>
                                <span className="truncate flex-1">
                                  <b>{p.odbiorca}</b> — {p.adres}
                                  {p.wymagany_typ && <span className="ml-1 text-blue-600">[{p.wymagany_typ}]</span>}
                                  {p.ma_proxy && <span className="ml-1 text-orange-600">⚠</span>}
                                </span>
                                <span className="text-muted-foreground whitespace-nowrap">
                                  {Math.round(p.suma_kg)} kg
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Cross-branch */}
            {planResult.crossBranch.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">🔄 Sugestie cross-branch</h3>
                <div className="space-y-1">
                  {planResult.crossBranch.map((cb, i) => (
                    <div key={i} className="text-sm bg-blue-50 border border-blue-200 p-2 rounded">
                      <b>{cb.paczka.odbiorca}</b> → przekaż do <b>{cb.oddzial_nazwa}</b>
                      {' '}({cb.km_dojazdu === 0 ? 'ten sam adres bazowy' : `${cb.km_dojazdu} km`})
                      <div className="text-xs text-muted-foreground">{cb.powod}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Niezaplanowane */}
            {planResult.niezaplanowane.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">⚠ Niezaplanowane</h3>
                <div className="space-y-1">
                  {planResult.niezaplanowane
                    .filter((nz) => !planResult.crossBranch.some((cb) => cb.paczka.klucz_adresu === nz.paczka.klucz_adresu))
                    .map((nz, i) => (
                      <div key={i} className="text-sm bg-orange-50 border border-orange-200 p-2 rounded">
                        <b>{nz.paczka.odbiorca}</b> — {nz.paczka.adres}
                        <div className="text-xs text-muted-foreground">{nz.powod}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'config' && (
            <>
              <Button variant="outline" onClick={onClose}>Anuluj</Button>
              <Button
                onClick={handleZaplanuj}
                disabled={loadingDane || kierowcy.filter((k) => k.zmiana !== 'OFF').length === 0}
              >
                🤖 Zaplanuj
              </Button>
            </>
          )}
          {step === 'wynik' && (
            <>
              <Button variant="outline" onClick={() => setStep('config')}>← Wróć</Button>
              <Button variant="outline" onClick={onClose}>Zamknij</Button>
              {/* Faza 4b: przycisk "Akceptuj wszystko" + INSERT */}
              <Button disabled title="Akceptacja w Fazie 4b">
                ✅ Akceptuj wszystko (TODO)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
