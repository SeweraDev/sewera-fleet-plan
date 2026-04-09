import { useState, useRef, useCallback, useEffect } from 'react';
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
import { generateNumerKursu } from '@/lib/generateNumerZlecenia';
import type { Pojazd } from '@/hooks/useFlotaOddzialu';
import type { Kierowca } from '@/hooks/useKierowcyOddzialu';

/* ── Typy ── */

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
  oddzialy?: { id: number; nazwa: string }[];
  onImported: () => void;
}

/* ── Parsowanie Excel (client-side) ── */

const TYP_MAP: Record<string, string | null> = {
  A: null,
  B: 'Dostawczy 1,2t',
  C: 'Winda 1,8t',
  D: 'Winda 6,3t',
  E: 'Winda MAX 15,8t',
  F: 'HDS 12,0t',
  G: 'HDS 12,0t',
  H: 'HDS 9,0t',
  I: 'HDS 9,0t',
};

const HEADER_PATTERNS: { patterns: RegExp[]; field: string }[] = [
  { patterns: [/^kierowca$/i, /^kier$/i], field: 'kierowca' },
  { patterns: [/^kurs$/i], field: 'kurs' },
  { patterns: [/^kod$/i, /^nr\s*indeksu$/i], field: 'kod' },
  { patterns: [/^nazwa\s*kontrahenta$/i, /^kontrahent$/i], field: 'odbiorca' },
  { patterns: [/^miejscowo/i, /^miasto$/i], field: 'miasto' },
  { patterns: [/^ulica$/i, /^adres$/i], field: 'ulica' },
  { patterns: [/^nr\s*wz$/i, /^wz$/i], field: 'nr_wz' },
  { patterns: [/^masa$/i, /^waga$/i], field: 'masa' },
  { patterns: [/^typ\s*samochodu$/i, /^rodzaj\s*samochodu$/i, /^klasyfikacja$/i, /^typ$/i], field: 'typ' },
  { patterns: [/^rodzaj\s*dostawy$/i], field: 'rodzaj_dostawy' },
  { patterns: [/^uwagi/i], field: 'uwagi' },
];

function matchHeader(h: string): string | null {
  const t = (h || '').trim();
  for (const hp of HEADER_PATTERNS) {
    for (const p of hp.patterns) {
      if (p.test(t)) return hp.field;
    }
  }
  return null;
}

function extractNrRej(name: string): string | null {
  const m = name.match(/[A-Z]{2}\d{4,5}[A-Z]/);
  return m ? m[0] : null;
}

function extractKierowcaName(raw: string): string {
  let name = raw.replace(/[A-Z]{2}\d{4,5}[A-Z]?/g, '').trim();
  name = name.replace(/\d+[,.]\d+\s*T\s*(WNDA|HDS|DOST)?/gi, '').trim();
  name = name.replace(/\s+/g, ' ').trim();
  return name || 'Nieznany';
}

function mapGodzinaToSlot(timeStr: string): string | null {
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const minutes = parseInt(m[1]) * 60 + parseInt(m[2]);
  if (minutes <= 450) return 'do 8:00';
  if (minutes <= 570) return 'do 10:00';
  if (minutes <= 690) return 'do 12:00';
  if (minutes <= 810) return 'do 14:00';
  return 'do 16:00';
}

async function parseExcelClientSide(file: File): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) {
    return { kursy: [], liczba_kursow: 0, liczba_wz: 0, bledy: [], pewnosc: 0, error: 'Plik jest pusty' };
  }

  // Find header row
  let headerIdx = -1;
  const colMap = new Map<number, string>();

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const tempMap = new Map<number, string>();
    for (let j = 0; j < (rows[i]?.length || 0); j++) {
      const field = matchHeader(String(rows[i][j] || ''));
      if (field) tempMap.set(j, field);
    }
    if (tempMap.size >= 3) {
      headerIdx = i;
      tempMap.forEach((v, k) => colMap.set(k, v));
      break;
    }
  }

  if (headerIdx === -1) {
    return { kursy: [], liczba_kursow: 0, liczba_wz: 0, bledy: [], pewnosc: 0, error: 'Nie rozpoznano nagłówków kolumn' };
  }

  const fieldCol: Record<string, number> = {};
  colMap.forEach((field, idx) => { fieldCol[field] = idx; });

  const get = (row: any[], field: string): string => {
    const idx = fieldCol[field];
    if (idx === undefined) return '';
    return String(row[idx] ?? '').trim();
  };

  const getNum = (row: any[], field: string): number | null => {
    const v = get(row, field);
    if (!v) return null;
    const s = v.replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : Math.ceil(n);
  };

  const kursy: ParsedKurs[] = [];
  const bledy: string[] = [];
  let currentKurs: ParsedKurs | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c: any) => !c && c !== 0)) continue;

    const kursVal = get(row, 'kurs');
    const kierowcaVal = get(row, 'kierowca');
    const nrWz = get(row, 'nr_wz');
    const odbiorca = get(row, 'odbiorca');
    const masa = getNum(row, 'masa');
    const typKod = get(row, 'typ').toUpperCase().trim();

    if (!nrWz && !odbiorca && masa !== null) continue;
    if (!nrWz && !odbiorca) continue;

    const isNewKurs =
      (kursVal && kursVal !== currentKurs?.nr_kursu_w_pliku) ||
      (kierowcaVal && kierowcaVal !== currentKurs?.kierowca_nazwa);

    if (isNewKurs && (kursVal || kierowcaVal)) {
      const typCode = typKod.charAt(0);
      const mappedTyp = TYP_MAP[typCode] ?? null;

      if (typCode === 'A') {
        bledy.push(`Wiersz ${i + 1}: typ A pominięty (nieobsługiwany)`);
      }

      currentKurs = {
        nr_kursu_w_pliku: kursVal || `KURS-${kursy.length + 1}`,
        kierowca_nazwa: kierowcaVal ? extractKierowcaName(kierowcaVal) : 'Nieznany',
        kierowca_nr_rej: kierowcaVal ? extractNrRej(kierowcaVal) : null,
        typ_pojazdu_kod: typCode || null,
        typ_pojazdu: typCode === 'A' ? null : mappedTyp,
        zlecenia: [],
        suma_kg: 0,
        liczba_wz: 0,
      };
      kursy.push(currentKurs);
    }

    if (!currentKurs) {
      currentKurs = {
        nr_kursu_w_pliku: 'KURS-1',
        kierowca_nazwa: kierowcaVal ? extractKierowcaName(kierowcaVal) : 'Nieznany',
        kierowca_nr_rej: kierowcaVal ? extractNrRej(kierowcaVal) : null,
        typ_pojazdu_kod: null,
        typ_pojazdu: null,
        zlecenia: [],
        suma_kg: 0,
        liczba_wz: 0,
      };
      kursy.push(currentKurs);
    }

    const miasto = get(row, 'miasto');
    const ulica = get(row, 'ulica');
    const rodzajDostawy = get(row, 'rodzaj_dostawy');
    const uwagi = get(row, 'uwagi');

    const adresPelny = [ulica, miasto].filter(Boolean).join(', ');
    const godzinaDostawy = rodzajDostawy ? mapGodzinaToSlot(rodzajDostawy) : null;

    const zlecenie: ParsedZlecenie = {
      nr_wz: nrWz || null,
      odbiorca: odbiorca || null,
      miasto: miasto || null,
      ulica: ulica || null,
      adres_pelny: adresPelny || null,
      masa_kg: masa,
      rodzaj_dostawy: rodzajDostawy || null,
      uwagi: uwagi || null,
      godzina_dostawy: godzinaDostawy,
    };

    currentKurs.zlecenia.push(zlecenie);
    if (masa) currentKurs.suma_kg += masa;
    currentKurs.liczba_wz++;
  }

  const totalWz = kursy.reduce((s, k) => s + k.liczba_wz, 0);
  const fieldsFound = Object.keys(fieldCol).length;
  const pewnosc = Math.min(100, Math.round((fieldsFound / 11) * 50 + (totalWz > 0 ? 50 : 0)));

  return { kursy, liczba_kursow: kursy.length, liczba_wz: totalWz, bledy, pewnosc };
}

/* ── Fuzzy matching ── */

function fuzzyMatchKierowca(name: string, kierowcy: Kierowca[]): Kierowca | null {
  const n = name.toUpperCase().trim();
  const exact = kierowcy.find(k => k.imie_nazwisko.toUpperCase() === n);
  if (exact) return exact;
  const firstName = n.split(/\s+/)[0];
  if (firstName.length >= 3) {
    const match = kierowcy.find(k => k.imie_nazwisko.toUpperCase().startsWith(firstName));
    if (match) return match;
  }
  return null;
}

function matchFlota(nrRej: string | null, flota: Pojazd[]): Pojazd | null {
  if (!nrRej) return null;
  const clean = nrRej.replace(/\s/g, '').toUpperCase();
  return flota.find(f => {
    const fNr = f.nr_rej.replace(/\s/g, '').toUpperCase();
    const fRaw = (f.nr_rej_raw || '').replace(/\s/g, '').toUpperCase();
    return fNr === clean || fRaw === clean;
  }) || null;
}

/* ── Komponent ── */

export function ImportExcelModal({ open, onClose, oddzialId, dzien, flota, kierowcy, oddzialy, onImported }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [kursStates, setKursStates] = useState<KursState[]>([]);
  const [importDzien, setImportDzien] = useState(dzien);
  const [importOddzialId, setImportOddzialId] = useState<number | null>(oddzialId);
  const [importing, setImporting] = useState(false);

  // Synchronizuj z props gdy modal się otwiera
  useEffect(() => {
    if (open) {
      setImportOddzialId(oddzialId);
      setImportDzien(dzien);
    }
  }, [open, oddzialId, dzien]);
  const [error, setError] = useState<string | null>(null);

  const doImport = async (parseResult: ParseResult, states: KursState[], targetDzien: string) => {
    const effectiveOddzialId = importOddzialId || oddzialId;
    if (!parseResult || !effectiveOddzialId || !user) return;
    setImporting(true);

    let importedKursy = 0;
    let importedZl = 0;

    for (let i = 0; i < parseResult.kursy.length; i++) {
      const ks = states[i];
      if (!ks.selected) continue;
      const kurs = parseResult.kursy[i];

      const selectedKierowca = kierowcy.find(k => k.id === ks.kierowca_id);
      const selectedVehicle = flota.find(f => f.id === ks.flota_id);
      const isZew = selectedVehicle?.jest_zewnetrzny;

      const { data: newKurs, error: kErr } = await supabase
        .from('kursy')
        .insert({
          oddzial_id: effectiveOddzialId,
          dzien: targetDzien,
          kierowca_id: ks.kierowca_id || null,
          flota_id: isZew ? null : (ks.flota_id || null),
          nr_rej_zewn: isZew ? (selectedVehicle?.nr_rej_raw || null) : null,
          kierowca_nazwa: selectedKierowca?.imie_nazwisko || kurs.kierowca_nazwa,
          numer: kurs.nr_kursu_w_pliku || await generateNumerKursu(effectiveOddzialId),
          status: 'zaplanowany',
        })
        .select('id')
        .single();

      if (kErr || !newKurs) {
        toast.error(`Błąd kursu ${kurs.nr_kursu_w_pliku}: ${kErr?.message}`);
        continue;
      }

      importedKursy++;

      for (let j = 0; j < kurs.zlecenia.length; j++) {
        const zl = kurs.zlecenia[j];
        const { generateNumerZlecenia } = await import('@/lib/generateNumerZlecenia');
        const numer = await generateNumerZlecenia(effectiveOddzialId);

        const { data: newZl, error: zlErr } = await supabase
          .from('zlecenia')
          .insert({
            numer,
            oddzial_id: effectiveOddzialId,
            typ_pojazdu: kurs.typ_pojazdu,
            dzien: targetDzien,
            preferowana_godzina: zl.godzina_dostawy,
            nadawca_id: user.id,
            status: 'potwierdzona',
            kurs_id: newKurs.id,
          })
          .select('id')
          .single();

        if (zlErr || !newZl) continue;

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
    return { importedKursy, importedZl };
  };

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { setError('Plik za duży (max 10 MB)'); return; }
    setParsing(true);
    setError(null);

    try {
      const json = await parseExcelClientSide(file);

      if (json.error) { setError(json.error); setParsing(false); return; }
      if (!json.kursy?.length) { setError('Nie znaleziono kursów w pliku'); setParsing(false); return; }

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

      // Check match quality — auto-import if >= 80% matched
      const totalKursy = states.length;
      const matchedKursy = states.filter(s => s.kierowcaMatch || s.flotaMatch).length;
      const matchRate = totalKursy > 0 ? matchedKursy / totalKursy : 0;

      // Zawsze pokaż step 2 — dyspozytor musi mieć szansę wybrać oddział i dzień
      {
        setResult(json);
        setKursStates(states);
        setStep(2);
        setParsing(false);
        if (json.bledy.length > 0) {
          toast.warning(`${json.bledy.length} ostrzeżeń — sprawdź przed importem`);
        }
      }
    } catch (e: any) {
      setError('Błąd parsowania: ' + (e.message || 'nieznany'));
      setParsing(false);
    }
  }, [kierowcy, flota, oddzialId, user, dzien, onImported, onClose]);

  const updateKursState = (idx: number, patch: Partial<KursState>) => {
    setKursStates(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const selectedCount = kursStates.filter(s => s.selected).length;

  const handleImport = async () => {
    if (!result) return;
    const res = await doImport(result, kursStates, importDzien);
    if (res) {
      toast.success(`Zaimportowano ${res.importedKursy} kursów, ${res.importedZl} zleceń`);
    }
    onImported();
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setStep(1);
    setResult(null);
    setKursStates([]);
    setError(null);
    setImporting(false);
    setImportOddzialId(oddzialId);
    setImportDzien(dzien);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={() => { handleReset(); onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Import planu kursów z Excela</DialogTitle>
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
              <p className="text-sm font-medium text-muted-foreground">Przeciągnij plik Excel lub kliknij aby wybrać</p>
              <p className="text-xs text-muted-foreground mt-1">XLS, XLSX do 10 MB — import automatyczny</p>
            </div>

            {(parsing || importing) && (
              <div className="text-center py-4">
                <div className="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                <p className="text-sm text-muted-foreground mt-2">
                  {parsing ? 'Analizuję plik...' : 'Importuję kursy...'}
                </p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === 2 && result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline">{result.liczba_kursow} kursów</Badge>
              <Badge variant="outline">{result.liczba_wz} WZ</Badge>
              {result.bledy.length > 0 && (
                <Badge variant="destructive">{result.bledy.length} ostrzeżeń</Badge>
              )}
            </div>

            {/* Day + oddział picker */}
            <div className="flex items-center gap-3 flex-wrap">
              <Label className="text-sm whitespace-nowrap">Dzień importu:</Label>
              <Input type="date" value={importDzien} onChange={e => setImportDzien(e.target.value)} className="w-44" />
              {oddzialy && oddzialy.length > 0 && (
                <>
                  <Label className="text-sm whitespace-nowrap ml-2">Oddział:</Label>
                  <Select value={String(importOddzialId || '')} onValueChange={v => setImportOddzialId(Number(v))}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="Wybierz oddział" /></SelectTrigger>
                    <SelectContent>
                      {oddzialy.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nazwa}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {/* Warnings */}
            {result.bledy.length > 0 && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
                {result.bledy.map((b, i) => <p key={i}>{b}</p>)}
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
                          {kurs.nr_kursu_w_pliku}
                          {kurs.typ_pojazdu && <Badge variant="secondary" className="text-xs">{kurs.typ_pojazdu} ({kurs.typ_pojazdu_kod})</Badge>}
                        </CardTitle>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {Math.round(kurs.suma_kg)} kg · {kurs.liczba_wz} rozładunków
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs flex items-center gap-1">
                            Kierowca
                            {ks.kierowcaMatch ? <span className="text-green-600">OK</span> : <span className="text-yellow-600">?</span>}
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
                            {ks.flotaMatch ? <span className="text-green-600">OK</span> : <span className="text-yellow-600">?</span>}
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
                          Suma {Math.round(kurs.suma_kg)} kg przekracza ładowność {selectedFlota!.ladownosc_kg} kg
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
            <Button variant="outline" onClick={handleReset}>Wróć</Button>
            <Button onClick={handleImport} disabled={importing || selectedCount === 0}>
              {importing ? 'Importuję...' : `Importuj zaznaczone kursy (${selectedCount})`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
