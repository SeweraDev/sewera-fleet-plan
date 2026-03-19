import { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';
import type { Kierowca } from '@/hooks/useKierowcyOddzialu';

interface ParsedZlecenie {
  nr_wz: string | null;
  odbiorca: string | null;
  miasto: string | null;
  ulica: string | null;
  adres_pelny: string | null;
  masa_kg: number | null;
  rodzaj_dostawy: string | null;
  uwagi: string | null;
  godzina_dostawy: string | null;
}

interface ParsedKurs {
  nr_kursu_w_pliku: string;
  kierowca_nazwa: string;
  kierowca_nr_rej: string | null;
  typ_pojazdu_kod: string | null;
  typ_pojazdu: string | null;
  zlecenia: ParsedZlecenie[];
  suma_kg: number;
  liczba_wz: number;
}

interface ParseResult {
  kursy: ParsedKurs[];
  liczba_kursow: number;
  liczba_wz: number;
  bledy: string[];
  pewnosc: number;
  error?: string;
}

interface KursState {
  selected: boolean;
  kierowca_id: string;
  flota_id: string;
  kierowcaMatch: boolean;
  flotaMatch: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  oddzialId: number | null;
  dzien: string;
  flota: Pojazd[];
  kierowcy: Kierowca[];
  onImported: () => void;
}

function fuzzyMatchKierowca(name: string, kierowcy: Kierowca[]): Kierowca | null {
  const n = name.toUpperCase().trim();
  // Try exact
  const exact = kierowcy.find(k => k.imie_nazwisko.toUpperCase() === n);
  if (exact) return exact;
  // Try first name match
  const firstName = n.split(/\s+/)[0];
  if (firstName.length >= 3) {
    const match = kierowcy.find(k => k.imie_nazwisko.toUpperCase().startsWith(firstName));
    if (match) return match;
  }
  return null;
}

function matchFlota(nrRej: string | null, flota: Pojazd[]): Pojazd | null {
  if (!nrRej) return null;
  return flota.find(f => f.nr_rej.replace(/\s/g, '').toUpperCase() === nrRej.replace(/\s/g, '').toUpperCase()) || null;
}

export function ImportExcelModal({ open, onClose, oddzialId, dzien, flota, kierowcy, onImported }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [kursStates, setKursStates] = useState<KursState[]>([]);
  const [importDzien, setImportDzien] = useState(dzien);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { setError('Plik za duży (max 10 MB)'); return; }
    setParsing(true);
    setError(null);

    const fd = new FormData();
    fd.append('file', file);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-excel-plan`,
      { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` }, body: fd }
    );
    const json: ParseResult = await res.json();
    setParsing(false);

    if (json.error) { setError(json.error); return; }
    if (!json.kursy?.length) { setError('Nie znaleziono kursów w pliku'); return; }

    setResult(json);

    // Auto-match kierowcy and flota
    const states: KursState[] = json.kursy.map(k => {
      const km = fuzzyMatchKierowca(k.kierowca_nazwa, kierowcy);
      const fm = matchFlota(k.kierowca_nr_rej, flota);
      return {
        selected: true,
        kierowca_id: km?.id || '',
        flota_id: fm?.id || '',
        kierowcaMatch: !!km,
        flotaMatch: !!fm,
      };
    });
    setKursStates(states);
    setStep(2);
  }, [kierowcy, flota]);

  const updateKursState = (idx: number, patch: Partial<KursState>) => {
    setKursStates(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const selectedCount = kursStates.filter(s => s.selected).length;

  const handleImport = async () => {
    if (!result || !oddzialId || !user) return;
    setImporting(true);

    let importedKursy = 0;
    let importedZl = 0;

    for (let i = 0; i < result.kursy.length; i++) {
      const ks = kursStates[i];
      if (!ks.selected) continue;
      const kurs = result.kursy[i];

      // Get kierowca name for kurs
      const selectedKierowca = kierowcy.find(k => k.id === ks.kierowca_id);

      // Create kurs
      const { data: newKurs, error: kErr } = await supabase
        .from('kursy')
        .insert({
          oddzial_id: oddzialId,
          dzien: importDzien,
          kierowca_id: ks.kierowca_id || null,
          flota_id: ks.flota_id || null,
          kierowca_nazwa: selectedKierowca?.imie_nazwisko || kurs.kierowca_nazwa,
          numer: kurs.nr_kursu_w_pliku,
          status: 'zaplanowany',
        })
        .select('id')
        .single();

      if (kErr || !newKurs) {
        toast.error(`Błąd kursu ${kurs.nr_kursu_w_pliku}: ${kErr?.message}`);
        continue;
      }

      importedKursy++;

      // Create zlecenia for this kurs
      for (let j = 0; j < kurs.zlecenia.length; j++) {
        const zl = kurs.zlecenia[j];
        const numer = `ZL-IMP-${Date.now().toString(36).toUpperCase()}-${j}`;

        const { data: newZl, error: zlErr } = await supabase
          .from('zlecenia')
          .insert({
            numer,
            oddzial_id: oddzialId,
            typ_pojazdu: kurs.typ_pojazdu,
            dzien: importDzien,
            preferowana_godzina: zl.godzina_dostawy,
            nadawca_id: user.id,
            status: 'potwierdzona',
            kurs_id: newKurs.id,
          })
          .select('id')
          .single();

        if (zlErr || !newZl) continue;

        // Insert WZ
        await supabase.from('zlecenia_wz').insert({
          zlecenie_id: newZl.id,
          numer_wz: zl.nr_wz,
          odbiorca: zl.odbiorca,
          adres: zl.adres_pelny,
          masa_kg: zl.masa_kg || 0,
          objetosc_m3: 0,
          ilosc_palet: 0,
          uwagi: [zl.rodzaj_dostawy, zl.uwagi].filter(Boolean).join('; '),
        });

        // Insert przystanek
        await supabase.from('kurs_przystanki').insert({
          kurs_id: newKurs.id,
          zlecenie_id: newZl.id,
          kolejnosc: j + 1,
          status: 'oczekuje',
        });

        importedZl++;
      }
    }

    setImporting(false);
    toast.success(`✅ Zaimportowano ${importedKursy} kursów, ${importedZl} zleceń`);
    onImported();
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setStep(1);
    setResult(null);
    setKursStates([]);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={() => { handleReset(); onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>📊 Import planu kursów z Excela</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <p className="text-sm font-medium text-muted-foreground">📊 Przeciągnij plik Excel lub kliknij aby wybrać</p>
              <p className="text-xs text-muted-foreground mt-1">XLS, XLSX do 10 MB</p>
            </div>

            {parsing && (
              <div className="text-center py-4">
                <div className="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                <p className="text-sm text-muted-foreground mt-2">Analizuję plik...</p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === 2 && result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline">📋 {result.liczba_kursow} kursów</Badge>
              <Badge variant="outline">📦 {result.liczba_wz} WZ</Badge>
              {result.bledy.length > 0 && (
                <Badge variant="destructive">⚠️ {result.bledy.length} ostrzeżeń</Badge>
              )}
            </div>

            {/* Day picker */}
            <div className="flex items-center gap-3">
              <Label className="text-sm whitespace-nowrap">Dzień importu:</Label>
              <Input type="date" value={importDzien} onChange={e => setImportDzien(e.target.value)} className="w-44" />
            </div>

            {/* Warnings */}
            {result.bledy.length > 0 && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
                {result.bledy.map((b, i) => <p key={i}>⚠️ {b}</p>)}
              </div>
            )}

            {/* Courses */}
            <div className="space-y-3">
              {result.kursy.map((kurs, idx) => {
                const ks = kursStates[idx];
                const selectedFlota = flota.find(f => f.id === ks.flota_id);
                const overweight = selectedFlota && kurs.suma_kg > selectedFlota.ladownosc_kg;

                return (
                  <Card key={idx} className={`${!ks.selected ? 'opacity-50' : ''} ${overweight ? 'border-destructive' : ''}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Checkbox checked={ks.selected} onCheckedChange={v => updateKursState(idx, { selected: !!v })} />
                        <CardTitle className="text-sm flex items-center gap-2">
                          🚛 {kurs.nr_kursu_w_pliku}
                          {kurs.typ_pojazdu && <Badge variant="secondary" className="text-xs">{kurs.typ_pojazdu} ({kurs.typ_pojazdu_kod})</Badge>}
                        </CardTitle>
                        <span className="ml-auto text-xs text-muted-foreground">
                          ⚖️ {Math.round(kurs.suma_kg)} kg · {kurs.liczba_wz} rozładunków
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs flex items-center gap-1">
                            Kierowca
                            {ks.kierowcaMatch ? <span className="text-green-600">✓</span> : <span className="text-yellow-600">⚠️</span>}
                          </Label>
                          <Select value={ks.kierowca_id} onValueChange={v => updateKursState(idx, { kierowca_id: v, kierowcaMatch: true })}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder={kurs.kierowca_nazwa} />
                            </SelectTrigger>
                            <SelectContent>
                              {kierowcy.map(k => (
                                <SelectItem key={k.id} value={k.id} className="text-xs">{k.imie_nazwisko}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs flex items-center gap-1">
                            Pojazd {kurs.kierowca_nr_rej && <span className="font-mono text-muted-foreground">({kurs.kierowca_nr_rej})</span>}
                            {ks.flotaMatch ? <span className="text-green-600">✓</span> : <span className="text-yellow-600">⚠️</span>}
                          </Label>
                          <Select value={ks.flota_id} onValueChange={v => updateKursState(idx, { flota_id: v, flotaMatch: true })}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Wybierz pojazd" />
                            </SelectTrigger>
                            <SelectContent>
                              {flota.map(f => (
                                <SelectItem key={f.id} value={f.id} className="text-xs">{f.nr_rej} ({f.typ})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {overweight && (
                        <p className="text-xs text-destructive font-medium">
                          ❌ Suma {Math.round(kurs.suma_kg)} kg przekracza ładowność {selectedFlota!.ladownosc_kg} kg
                        </p>
                      )}

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs w-8">#</TableHead>
                            <TableHead className="text-xs">Nr WZ</TableHead>
                            <TableHead className="text-xs">Odbiorca</TableHead>
                            <TableHead className="text-xs">Adres</TableHead>
                            <TableHead className="text-xs text-right">Kg</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {kurs.zlecenia.map((zl, j) => (
                            <TableRow key={j}>
                              <TableCell className="text-xs">{j + 1}</TableCell>
                              <TableCell className="text-xs font-mono">{zl.nr_wz || '—'}</TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate">{zl.odbiorca || '—'}</TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate">{zl.adres_pelny || '—'}</TableCell>
                              <TableCell className="text-xs text-right">{zl.masa_kg ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleReset}>← Wróć</Button>
            <Button onClick={handleImport} disabled={importing || selectedCount === 0}>
              {importing ? 'Importuję...' : `✅ Importuj zaznaczone kursy (${selectedCount})`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
