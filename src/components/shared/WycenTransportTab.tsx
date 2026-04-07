import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  ODDZIAL_COORDS,
  NAZWA_TO_KOD,
  geocodeAddress,
  getRouteDistance,
} from '@/lib/oddzialy-geo';
import {
  TYPY_KALKULATOR,
  obliczKosztWew,
  obliczKosztZew,
  maStawkiZew,
  findBestAvailableType,
} from '@/lib/stawki-transportowe';

interface WycenTransportTabProps {
  /** Nazwa oddziału zalogowanego usera, np. "Gliwice" */
  oddzialNazwa: string;
}

interface WynikOddzialu {
  kod: string;
  nazwa: string;
  km: number;
  kosztWew: { netto: number; brutto: number } | null;
  kosztZew: { netto: number; brutto: number } | null;
  jestMojOddzial: boolean;
  /** Typ cennikowy użyty do kalkulacji (może być fallback) */
  uzytTyp: string | null;
  /** Czy typ jest fallback (np. HDS 9t zamiast 12t) */
  isFallback: boolean;
}

const MAX_KM_INNE_ODDZIALY = 15;
const MAX_WYNIKOW = 3;

// Odwrotne mapowanie kod → nazwa
const KOD_TO_NAZWA: Record<string, string> = {};
for (const [nazwa, kod] of Object.entries(NAZWA_TO_KOD)) {
  KOD_TO_NAZWA[kod] = nazwa;
}

export function WycenTransportTab({ oddzialNazwa }: WycenTransportTabProps) {
  const [typPojazdu, setTypPojazdu] = useState('');
  const [adres, setAdres] = useState('');
  const [loading, setLoading] = useState(false);
  const [wyniki, setWyniki] = useState<WynikOddzialu[] | null>(null);
  const [error, setError] = useState('');
  const [pokazZew, setPokazZew] = useState(false);

  const mojKod = NAZWA_TO_KOD[oddzialNazwa] || '';

  const handleWylicz = useCallback(async () => {
    if (!typPojazdu) {
      setError('Wybierz typ pojazdu');
      return;
    }
    if (!adres || adres.length < 5) {
      setError('Wpisz adres dostawy');
      return;
    }

    setLoading(true);
    setError('');
    setWyniki(null);

    try {
      // 1. Geocoduj adres
      const coords = await geocodeAddress(adres);
      if (!coords) {
        setError('Nie udało się znaleźć adresu. Spróbuj podać bardziej szczegółowy adres (ulica, kod pocztowy, miasto).');
        setLoading(false);
        return;
      }

      // 2. Pobierz flotę WSZYSTKICH oddziałów (aktywne pojazdy)
      const { data: flotaData } = await supabase
        .from('flota')
        .select('typ, oddzial_id')
        .eq('aktywny', true);

      // Pobierz nazwy oddziałów → mapuj oddzial_id → kod
      const { data: oddzialyData } = await supabase
        .from('oddzialy')
        .select('id, nazwa');

      const oddzialIdToKod = new Map<number, string>();
      (oddzialyData || []).forEach(o => {
        const kod = NAZWA_TO_KOD[o.nazwa];
        if (kod) oddzialIdToKod.set(o.id, kod);
      });

      // Buduj mapę: kod oddziału → Set typów systemowych
      const flotaPerOddzial = new Map<string, Set<string>>();
      (flotaData || []).forEach(f => {
        if (!f.oddzial_id) return;
        const kod = oddzialIdToKod.get(f.oddzial_id);
        if (!kod) return;
        if (!flotaPerOddzial.has(kod)) flotaPerOddzial.set(kod, new Set());
        flotaPerOddzial.get(kod)!.add(f.typ);
      });

      // 3. Oblicz odległość od KAŻDEGO oddziału
      const oddzialy = Object.entries(ODDZIAL_COORDS);
      const oddzialyFiltered = oddzialy.filter(([kod]) => {
        if (kod === 'R' && mojKod !== 'R') return false;
        if (kod === 'KAT' && mojKod === 'R') return false;
        return true;
      });

      const results: WynikOddzialu[] = [];

      for (const [kod, dane] of oddzialyFiltered) {
        const km = await getRouteDistance(dane, coords);
        if (km === null) continue;

        // Sprawdź czy oddział ma wybrany typ lub fallback
        const flotaTypy = flotaPerOddzial.get(kod) || new Set<string>();
        const bestType = findBestAvailableType(typPojazdu, flotaTypy);

        let kosztWew: { netto: number; brutto: number } | null = null;
        let uzytTyp: string | null = null;
        let isFallback = false;

        if (bestType) {
          kosztWew = obliczKosztWew(km, bestType.typ);
          uzytTyp = bestType.typ;
          isFallback = bestType.fallback;
        }

        // Transport zew — zawsze dla wybranego typu (nie fallback)
        const kosztZew = obliczKosztZew(km, typPojazdu, kod);

        results.push({
          kod,
          nazwa: KOD_TO_NAZWA[kod] || kod,
          km,
          kosztWew,
          kosztZew,
          jestMojOddzial: kod === mojKod,
          uzytTyp,
          isFallback,
        });
      }

      // 4. Filtruj: mój oddział zawsze + inne ≤15 km (które mają auto lub zew)
      const mojOddzial = results.find(r => r.jestMojOddzial);
      const inne = results
        .filter(r => !r.jestMojOddzial && r.km <= MAX_KM_INNE_ODDZIALY && (r.kosztWew || r.kosztZew))
        .sort((a, b) => (a.kosztWew?.netto ?? a.kosztZew?.netto ?? 9999) - (b.kosztWew?.netto ?? b.kosztZew?.netto ?? 9999));

      const finalResults: WynikOddzialu[] = [];
      if (mojOddzial) finalResults.push(mojOddzial);
      for (const r of inne) {
        if (finalResults.length >= MAX_WYNIKOW) break;
        finalResults.push(r);
      }

      // Sortuj po najtańszej dostępnej cenie
      finalResults.sort((a, b) => {
        const priceA = Math.min(a.kosztWew?.netto ?? 9999, a.kosztZew?.netto ?? 9999);
        const priceB = Math.min(b.kosztWew?.netto ?? 9999, b.kosztZew?.netto ?? 9999);
        return priceA - priceB;
      });

      const jestZew = finalResults.some(r => r.kosztZew !== null);
      setPokazZew(jestZew);

      setWyniki(finalResults);
    } catch (e) {
      console.error('[WycenTransport] error:', e);
      setError('Wystąpił błąd podczas wyliczania. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }, [typPojazdu, adres, mojKod]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) handleWylicz();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">💰 Wyceń transport</CardTitle>
        <p className="text-sm text-muted-foreground">
          Wylicz koszt dostawy z oddziału do adresu budowy. Cennik od 1.04.2026.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Formularz */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Typ pojazdu</Label>
            <Select value={typPojazdu} onValueChange={setTypPojazdu}>
              <SelectTrigger><SelectValue placeholder="Wybierz typ" /></SelectTrigger>
              <SelectContent>
                {TYPY_KALKULATOR.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Adres dostawy</Label>
            <Input
              placeholder="np. al. Roździeńskiego 1a, 40-202 Katowice"
              value={adres}
              onChange={e => setAdres(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            <Button onClick={handleWylicz} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Wyliczam...
                </>
              ) : (
                '🔍 Wylicz koszt'
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        )}

        {/* Wyniki */}
        {wyniki && wyniki.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              Wyniki dla: <span className="text-primary">{typPojazdu}</span> → {adres}
            </h3>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 border-r border-gray-400" colSpan={2}></th>
                    <th className="text-center p-2 font-semibold border-b border-r border-gray-400" colSpan={2}>Sewera</th>
                    {pokazZew && (
                      <th className="text-center p-2 font-semibold border-b" colSpan={2}>Zewnętrzny</th>
                    )}
                  </tr>
                  <tr>
                    <th className="text-left p-3 font-medium">Oddział</th>
                    <th className="text-center p-3 font-medium border-r border-gray-400">km</th>
                    <th className="text-center p-3 font-medium">Netto</th>
                    <th className="text-center p-3 font-medium border-r border-gray-400">Brutto</th>
                    {pokazZew && (
                      <>
                        <th className="text-center p-3 font-medium">Netto</th>
                        <th className="text-center p-3 font-medium">Brutto</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {wyniki.map((w, idx) => {
                    const color = getRowColor(idx, wyniki.length);
                    return (
                      <tr key={w.kod} className={`${color} border-t`}>
                        <td className="p-3 font-medium">
                          {w.jestMojOddzial ? '📍 ' : ''}{w.nazwa}
                          {w.jestMojOddzial && (
                            <span className="text-xs text-muted-foreground ml-1">(Twój)</span>
                          )}
                          {w.isFallback && w.uzytTyp && (
                            <div className="text-xs text-orange-600 dark:text-orange-400">
                              ↳ auto: {w.uzytTyp}
                            </div>
                          )}
                        </td>
                        <td className="text-center p-3 tabular-nums border-r border-gray-400">{w.km} km</td>
                        <td className="text-center p-3 tabular-nums">
                          {w.kosztWew ? formatPLN(w.kosztWew.netto) : '—'}
                        </td>
                        <td className="text-center p-3 tabular-nums font-bold border-r border-gray-400">
                          {w.kosztWew ? formatPLN(w.kosztWew.brutto) : '—'}
                        </td>
                        {pokazZew && (
                          <>
                            <td className="text-center p-3 tabular-nums">
                              {w.kosztZew ? formatPLN(w.kosztZew.netto) : '—'}
                            </td>
                            <td className="text-center p-3 tabular-nums font-bold">
                              {w.kosztZew ? formatPLN(w.kosztZew.brutto) : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Ceny netto w PLN (VAT 23%). Odległość w jedną stronę (OSRM).
              Oddziały z odległością {'>'} {MAX_KM_INNE_ODDZIALY} km od budowy nie są wyświetlane (oprócz Twojego).
            </p>
          </div>
        )}

        {wyniki && wyniki.length === 0 && (
          <div className="text-sm text-muted-foreground bg-muted p-4 rounded-md text-center">
            Nie udało się wyliczyć kosztów. Sprawdź adres i spróbuj ponownie.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// HELPERS
// ============================================================

function formatPLN(amount: number): string {
  return amount.toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' zł';
}

function getRowColor(idx: number, total: number): string {
  if (total === 1) return 'bg-green-200 dark:bg-green-900/50';
  if (idx === 0) return 'bg-green-200 dark:bg-green-900/50';
  if (idx === total - 1) return 'bg-red-200 dark:bg-red-900/50';
  return 'bg-yellow-200 dark:bg-yellow-900/50';
}
