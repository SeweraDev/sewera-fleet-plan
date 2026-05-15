import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { TYPY_KLIENTOW } from '@/lib/typy-klientow';
import { useWindaVsHdsCost } from '@/hooks/useWindaVsHdsCost';

const ERP_TYPES = [
  { kod: 'B', opis: 'Bez windy do 1,2t', typ: 'Dostawczy 1,2t' },
  { kod: 'C', opis: 'Winda do 1,8t', typ: 'Winda 1,8t' },
  { kod: 'D', opis: 'Winda do 6t', typ: 'Winda 6,3t' },
  { kod: 'E', opis: 'Winda duża MAX 15,8t', typ: 'Winda MAX 15,8t' },
  { kod: 'F', opis: 'HDS duży', typ: 'HDS 12,0t' },
  { kod: 'G', opis: 'HDS duży + przyczepa', typ: 'HDS 12,0t' },
  { kod: 'H', opis: 'HDS średni', typ: 'HDS 9,0t' },
  { kod: 'I', opis: 'HDS średni + przyczepa', typ: 'HDS 9,0t' },
];

interface TypPojazduStepProps {
  oddzialId: number | null;
  setOddzialId: (v: number | null) => void;
  typPojazdu: string;
  setTypPojazdu: (v: string) => void;
  /** Typ klienta — R/D/P/W/I/B. Wymagany przed przejsciem dalej. */
  typKlienta: string;
  setTypKlienta: (v: string) => void;
  oddzialy: { id: number; nazwa: string }[];
  loadingOddzialy: boolean;
  flota: { typ: string }[];
  loadingFlota: boolean;
  onNext: () => void;
  /** Opcjonalny callback wstecz — używany gdy ten krok nie jest pierwszy
   *  (po refactorze 13.05 ten krok jest Krokiem 2 — po imporcie WZ). */
  onBack?: () => void;
  /** Smart Prefill — true gdy oddział został auto-ustawiony z numeru WZ.
   *  Pomarańczowa ramka informuje sprzedawcę żeby zweryfikował. */
  oddzialAutoSet?: boolean;
  /** Smart Prefill — true gdy typ klienta został auto-wykryty (R z bazy / B2C z uwag / D z nazwy).
   *  Pomarańczowa ramka informuje sprzedawcę żeby zweryfikował. */
  typKlientaAutoSet?: boolean;
  /** ≥1 pozycja w wzList ma w bazie katalog_towarow wymaga_hds=true. Decyduje o bannerze HDS. */
  wymagaHds?: boolean;
  /** Lista dzialow ciezkich z bazy (np. ["DACHÓWKI CERAMICZNE", "KOSTKA BRUKOWA"]) — do bannera. */
  dzialyHds?: string[];
  /** Suma palet ze wszystkich WZ na zleceniu — banner aktywny tylko gdy >=2. */
  sumaPalet?: number;
  /** Adres dostawy z pierwszego WZ — do wyliczenia kosztu windy vs HDS. */
  adresDostawy?: string;
  /** Suma masy ze wszystkich WZ — do wyboru typu pojazdu (najmniejszy pasujacy). */
  sumaMasa?: number;
  /** Suma m3 ze wszystkich WZ. */
  sumaM3?: number;
}

export function TypPojazduStep({
  oddzialId, setOddzialId,
  typPojazdu, setTypPojazdu,
  typKlienta, setTypKlienta,
  oddzialy, loadingOddzialy,
  flota, loadingFlota,
  onNext,
  onBack,
  oddzialAutoSet,
  typKlientaAutoSet,
  wymagaHds,
  dzialyHds,
  sumaPalet,
  adresDostawy,
  sumaMasa,
  sumaM3,
}: TypPojazduStepProps) {
  // Banner HDS: ≥1 pozycja z katalogu wymaga HDS + suma palet >= 2 + klient nie-R.
  // Decyzja 15.05.2026: materialy konstrukcyjne (cegly, dachowki, kostka) nie powinny
  // jechac winda — dluzszy czas i wieksze koszty kierowcy, choc klient placi mniej.
  const pokazBannerHds = !!wymagaHds && (sumaPalet ?? 0) >= 2 && typKlienta !== 'R';
  // Wybrany typ to winda? (B/C/D/E = pojazdy z winda, F/G/H/I = HDS)
  const wybranoWinde = /winda/i.test(typPojazdu) || typPojazdu === 'Dostawczy 1,2t';
  const uniqueTypes = [...new Set(flota.map(f => f.typ))];
  const [tab, setTab] = useState('pojazd');

  // Koszty windy vs HDS dla wybranego oddzialu — tylko gdy banner HDS aktywny
  const oddzialNazwa = oddzialy.find(o => o.id === oddzialId)?.nazwa;
  const kosztyComparison = useWindaVsHdsCost(
    pokazBannerHds ? oddzialNazwa : undefined,
    pokazBannerHds ? adresDostawy : undefined,
    sumaMasa ?? 0,
    sumaM3 ?? 0,
    sumaPalet ?? 0,
  );

  // Pobierz typy aut zewnętrznych dla wybranego oddziału
  const [zewTypy, setZewTypy] = useState<string[]>([]);
  useEffect(() => {
    if (!oddzialId) { setZewTypy([]); return; }
    supabase
      .from('flota_zewnetrzna')
      .select('typ')
      .eq('oddzial_id', oddzialId)
      .eq('aktywny', true)
      .then(({ data }) => {
        const typy = [...new Set((data || []).map(f => f.typ))];
        setZewTypy(typy);
      });
  }, [oddzialId]);

  return (
    <div className="space-y-4">
      {pokazBannerHds && (
        <div className={cn(
          'rounded-lg border-2 p-3 text-sm',
          wybranoWinde
            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
            : 'border-green-500 bg-green-50 dark:bg-green-950/30'
        )}>
          <div className="flex items-start gap-2">
            <span className="text-xl shrink-0">{wybranoWinde ? '⚠️' : '🚛'}</span>
            <div className="space-y-1">
              <div className="font-semibold text-foreground">
                {wybranoWinde ? 'Wykryto materiały konstrukcyjne — sugerowany HDS' : 'Materiały konstrukcyjne — HDS to dobry wybór'}
              </div>
              <div className="text-xs text-muted-foreground">
                Ładunek <strong>{sumaPalet ?? '?'} palet</strong>
                {dzialyHds && dzialyHds.length > 0 && (
                  <> z działu <strong>{dzialyHds.slice(0, 2).map(d => d.split('\\').pop()?.trim()).filter(Boolean).join(', ')}</strong></>
                )}.
              </div>
              {/* Tabela kosztów: winda vs HDS dla wybranego oddziału (wew + zew) */}
              {(kosztyComparison.winda || kosztyComparison.hds) && (
                <div className="mt-2 rounded-md bg-white/60 dark:bg-black/20 border border-current/10 p-2 text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="text-left font-medium">Typ</th>
                        <th className="text-right font-medium">Sewera</th>
                        <th className="text-right font-medium">Zewn.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kosztyComparison.winda && (
                        <tr>
                          <td className="text-foreground">{kosztyComparison.winda.typ}</td>
                          <td className="text-right text-foreground">
                            {kosztyComparison.winda.kosztWew
                              ? `${Math.round(kosztyComparison.winda.kosztWew.netto)} zł`
                              : '—'}
                          </td>
                          <td className="text-right text-foreground">
                            {kosztyComparison.winda.kosztyZew.length > 0
                              ? `${Math.round(kosztyComparison.winda.kosztyZew[0].netto)} zł`
                              : '—'}
                          </td>
                        </tr>
                      )}
                      {kosztyComparison.hds && (
                        <tr>
                          <td className="text-foreground">{kosztyComparison.hds.typ}</td>
                          <td className="text-right text-foreground">
                            {kosztyComparison.hds.kosztWew
                              ? `${Math.round(kosztyComparison.hds.kosztWew.netto)} zł`
                              : '—'}
                          </td>
                          <td className="text-right text-foreground">
                            {kosztyComparison.hds.kosztyZew.length > 0
                              ? `${Math.round(kosztyComparison.hds.kosztyZew[0].netto)} zł`
                              : '—'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {kosztyComparison.winda?.minNetto != null && kosztyComparison.hds?.minNetto != null && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Różnica: <strong>HDS {kosztyComparison.hds.minNetto > kosztyComparison.winda.minNetto ? '+' : ''}{Math.round(kosztyComparison.hds.minNetto - kosztyComparison.winda.minNetto)} zł</strong> (netto, najtańsza opcja)
                    </div>
                  )}
                </div>
              )}
              {kosztyComparison.loading && (
                <div className="mt-2 text-[11px] text-muted-foreground italic">Wyliczam koszty...</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <Label>Oddział{oddzialAutoSet && <span className="ml-2 text-[11px] text-orange-700 dark:text-orange-400 font-normal">🟠 auto z numeru WZ — sprawdź</span>}</Label>
        <Select onValueChange={v => setOddzialId(Number(v))} value={oddzialId?.toString() || ''}>
          <SelectTrigger className={cn(oddzialAutoSet && 'border-orange-400 bg-orange-50 dark:bg-orange-950/20 focus:ring-orange-400')}>
            <SelectValue placeholder={loadingOddzialy ? 'Ładowanie...' : 'Wybierz oddział'} />
          </SelectTrigger>
          <SelectContent>
            {oddzialy.map(o => <SelectItem key={o.id} value={o.id.toString()}>{o.nazwa}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Typ klienta *{typKlientaAutoSet && <span className="ml-2 text-[11px] text-orange-700 dark:text-orange-400 font-normal">🟠 auto z WZ — sprawdź</span>}</Label>
        <Select onValueChange={setTypKlienta} value={typKlienta}>
          <SelectTrigger className={cn(typKlientaAutoSet && 'border-orange-400 bg-orange-50 dark:bg-orange-950/20 focus:ring-orange-400')}>
            <SelectValue placeholder="Wybierz typ klienta" />
          </SelectTrigger>
          <SelectContent>
            {TYPY_KLIENTOW.map(t => (
              <SelectItem key={t.kod} value={t.kod}>
                <span className="font-mono font-bold mr-2">{t.kod}</span>
                — {t.opis}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Typ pojazdu</Label>
        <Tabs value={tab} onValueChange={setTab} className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="pojazd" className="flex-1 text-xs">🚛 Wybierz pojazd</TabsTrigger>
            <TabsTrigger value="kod" className="flex-1 text-xs">📋 Kod A-I</TabsTrigger>
          </TabsList>

          <TabsContent value="pojazd">
            {loadingFlota ? (
              <p className="text-sm text-muted-foreground py-2">Ładowanie floty...</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setTypPojazdu('bez_preferencji')}
                  className={cn(
                    'col-span-2 flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-left transition-colors',
                    typPojazdu === 'bez_preferencji'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-muted-foreground/30 hover:border-muted-foreground/50'
                  )}
                >
                  <span className="text-xl">🔀</span>
                  <div>
                    <div className="font-medium text-sm">Bez preferencji</div>
                    <div className="text-xs text-muted-foreground">Dyspozytor dobierze auto</div>
                  </div>
                </button>

                {uniqueTypes.map(typ => (
                  <button
                    key={typ}
                    type="button"
                    onClick={() => setTypPojazdu(typ)}
                    className={cn(
                      'rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors',
                      typPojazdu === typ
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-muted-foreground/50'
                    )}
                  >
                    {typ}
                  </button>
                ))}

                {zewTypy.length > 0 ? (
                  zewTypy.map(typ => (
                    <button
                      key={`zew-${typ}`}
                      type="button"
                      onClick={() => setTypPojazdu(`zew:${typ}`)}
                      className={cn(
                        'rounded-lg border-2 px-4 py-3 text-left transition-colors',
                        typPojazdu === `zew:${typ}`
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-muted-foreground/50'
                      )}
                    >
                      <div className="text-sm font-medium">Zew. {typ}</div>
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    onClick={() => setTypPojazdu('zewnetrzny')}
                    className={cn(
                      'rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors',
                      typPojazdu === 'zewnetrzny'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-muted-foreground/50'
                    )}
                  >
                    Zewnętrzny
                  </button>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="kod">
            <div className="space-y-1 mt-2">
              {ERP_TYPES.map(e => (
                <button
                  key={e.kod}
                  type="button"
                  onClick={() => setTypPojazdu(e.typ)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition-colors',
                    typPojazdu === e.typ
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <span className={cn(
                    'w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold',
                    typPojazdu === e.typ ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}>
                    {e.kod}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{e.opis}</div>
                    <div className="text-xs text-muted-foreground">{e.typ}</div>
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex gap-2">
        {onBack && <Button variant="outline" onClick={onBack}>← Wstecz</Button>}
        <Button onClick={onNext} disabled={!oddzialId || !typPojazdu || !typKlienta}>Dalej →</Button>
      </div>
    </div>
  );
}
