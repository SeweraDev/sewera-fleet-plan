import { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';

export interface WZImportData {
  numer_wz: string | null;
  nr_zamowienia: string | null;
  odbiorca: string | null;
  adres: string | null;
  tel: string | null;
  osoba_kontaktowa: string | null;
  masa_kg: number | null;
  ilosc_palet: number | null;
  objetosc_m3: number | null;
  uwagi: string | null;
  typ_dokumentu: string | null;
  ma_adres_dostawy: boolean;
}

interface Pozycja {
  lp: number;
  kod_towaru: string;
  kod_producenta: string;
  kod_ean: string;
  nazwa_towaru: string;
  nazwa_dodatkowa: string;
  ilosc: number;
  jm: string;
}

interface ParsedPdfResult {
  nr_wz: string | null;
  nr_zamowienia: string | null;
  odbiorca_nazwa: string | null;
  odbiorca: string | null;
  odbiorca_adres_siedziby: string | null;
  adres_dostawy: string | null;
  nazwa_budowy: string | null;
  osoba_kontaktowa: string | null;
  tel: string | null;
  tel2: string | null;
  masa_kg: number | null;
  ilosc_palet: number | null;
  objetosc_m3: number | null;
  uwagi: string | null;
  uwagi_krotkie: string | null;
  data_wz: string | null;
  pozycje: Pozycja[];
  pewnosc: number;
  error?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (wzData: WZImportData[]) => void;
  hideXls?: boolean;
}

/* ─── Confidence Badge ─── */
function ConfidenceBadge({ pewnosc, totalFields }: { pewnosc: number; totalFields: number }) {
  const fieldsFound = Math.round((pewnosc / 100) * 16);
  if (pewnosc >= 80) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm font-medium">
        ✅ Odczytano {fieldsFound}/16 pól
      </div>
    );
  }
  if (pewnosc >= 50) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-sm font-medium">
        ⚠️ Odczytano częściowo — sprawdź pola
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-sm font-medium">
      ❌ Słaby odczyt — uzupełnij ręcznie
    </div>
  );
}

/* ─── Pozycje Towarowe Preview ─── */
function PozycjePreview({ pozycje }: { pozycje: Pozycja[] }) {
  const [open, setOpen] = useState(false);
  if (!pozycje.length) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground text-xs hover:text-foreground">
          {open ? '▼' : '▶'} 📦 Pozycje z WZ ({pozycje.length} pozycji)
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-40 overflow-auto border rounded-md mt-1">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Kod</th>
                <th className="px-2 py-1 text-left">Nazwa</th>
                <th className="px-2 py-1 text-right">Ilość</th>
                <th className="px-2 py-1 text-left">JM</th>
              </tr>
            </thead>
            <tbody>
              {pozycje.map((p, i) => (
                <tr key={i} className="border-t border-muted/50">
                  <td className="px-2 py-1 font-mono text-muted-foreground">{p.kod_towaru}</td>
                  <td className="px-2 py-1">{p.nazwa_towaru}</td>
                  <td className="px-2 py-1 text-right">{p.ilosc}</td>
                  <td className="px-2 py-1 text-muted-foreground">{p.jm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─── PDF Tab ─── */
function PdfTab({ onParsed, onSwitchManual }: { onParsed: (d: WZImportData) => void; onSwitchManual: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParsedPdfResult | null>(null);
  const [formData, setFormData] = useState<WZImportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
      setError('Rozpoznawanie tekstu ze zdjęć wymaga ręcznego uzupełnienia.');
      setTimeout(onSwitchManual, 2000);
      return;
    }
    if (!name.endsWith('.pdf')) {
      setError('Nieobsługiwany format. Wymagany PDF.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Plik za duży (max 10 MB)');
      return;
    }

    setParsing(true);
    setError(null);
    setResult(null);
    setFormData(null);

    const fd = new FormData();
    fd.append('file', file);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-wz-pdf`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: fd,
      }
    );
    const json: ParsedPdfResult = await res.json();
    setParsing(false);

    if (json.error) {
      setError(json.error);
      return;
    }

    setResult(json);

    console.log("EDGE FUNCTION RESPONSE:", JSON.stringify(json));
    const mapped: WZImportData = {
      numer_wz: json.nr_wz || '',
      nr_zamowienia: json.nr_zamowienia || '',
      odbiorca: json.odbiorca || '',
      adres: json.adres_dostawy || '',
      tel: json.osoba_kontaktowa || json.tel || '',
      osoba_kontaktowa: json.osoba_kontaktowa || '',
      masa_kg: json.masa_kg || 0,
      ilosc_palet: json.ilosc_palet || 0,
      objetosc_m3: json.objetosc_m3 || 0,
      uwagi: json.uwagi || '',
      typ_dokumentu: (json as any).typ_dokumentu || 'WZ',
      ma_adres_dostawy: (json as any).ma_adres_dostawy || false,
    };

    setFormData(mapped);
  }, [onSwitchManual]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const fields: { key: keyof WZImportData; label: string; type?: string }[] = [
    { key: 'numer_wz', label: 'Nr WZ' },
    { key: 'nr_zamowienia', label: 'Nr zamówienia' },
    { key: 'odbiorca', label: 'Odbiorca' },
    { key: 'adres', label: 'Adres dostawy' },
    { key: 'tel', label: 'Telefon' },
    { key: 'masa_kg', label: 'Masa kg' },
    { key: 'ilosc_palet', label: 'Ilość palet', type: 'number' },
    { key: 'objetosc_m3', label: 'Objętość m³', type: 'number' },
    { key: 'uwagi', label: 'Uwagi' },
  ];

  return (
    <div className="space-y-3">
      <div
        className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <p className="text-sm font-medium text-muted-foreground">📄 Przeciągnij PDF lub kliknij aby wybrać</p>
        <p className="text-xs text-muted-foreground mt-1">PDF do 10 MB · Zdjęcia → formularz ręczny</p>
      </div>

      {parsing && (
        <div className="text-center py-4">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground mt-2">Analizuję dokument...</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && formData && (
        <div className="space-y-3">
          <ConfidenceBadge pewnosc={result.pewnosc} totalFields={16} />

          <div className="space-y-2">
            {fields.map(f => {
              const val = formData[f.key];
              const found = val != null && val !== '' && val !== 0;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-sm w-4">{found ? '✓' : '⚠️'}</span>
                  <Label className="text-xs w-28 shrink-0">{f.label}</Label>
                  <Input
                    className="h-8 text-sm flex-1"
                    type={f.type || 'text'}
                    value={f.key === 'masa_kg' && typeof val === 'number' ? formatMasaKg(val) : (val?.toString() ?? '')}
                    onChange={e => {
                      const raw = e.target.value;
                      setFormData(prev => prev ? {
                        ...prev,
                        [f.key]: f.type === 'number'
                          ? (raw ? Number(raw) : null)
                          : f.key === 'masa_kg'
                            ? (parseFloat(raw.replace(/\s/g, '').replace(',', '.')) || 0)
                            : raw,
                      } : prev);
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Extra info from parser */}
          {(result.osoba_kontaktowa || result.tel2 || result.nazwa_budowy) && (
            <div className="text-xs text-muted-foreground space-y-0.5 p-2 bg-muted/30 rounded">
              {result.osoba_kontaktowa && <p>👤 Kontakt: {result.osoba_kontaktowa}</p>}
              {result.tel2 && <p>📞 Tel. dodatkowy: {result.tel2}</p>}
              {result.nazwa_budowy && <p>🏗️ Budowa: {result.nazwa_budowy}</p>}
              {result.data_wz && <p>📅 Data WZ: {result.data_wz}</p>}
            </div>
          )}

          <PozycjePreview pozycje={result.pozycje || []} />

          <Button onClick={() => onParsed(formData)} className="w-full">✅ Użyj tych danych</Button>
        </div>
      )}
    </div>
  );
}

/* ─── XLS Tab (uses parse-excel-plan Edge Function) ─── */
function XlsTab({ onParsed }: { onParsed: (rows: WZImportData[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<(WZImportData & { typ_pojazdu?: string })[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError('Plik za duży (max 10 MB)');
      return;
    }
    setParsing(true);
    setError(null);
    setRows([]);

    const fd = new FormData();
    fd.append('file', file);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-excel-plan`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: fd,
      }
    );
    const json = await res.json();
    setParsing(false);

    if (json.error) {
      setError(json.error);
      return;
    }

    // Flatten all zlecenia from all kursy into a flat WZ list
    const allWz: (WZImportData & { typ_pojazdu?: string })[] = [];
    for (const kurs of (json.kursy || [])) {
      for (const zl of (kurs.zlecenia || [])) {
        allWz.push({
          numer_wz: zl.nr_wz,
          nr_zamowienia: null,
          odbiorca: zl.odbiorca,
          adres: zl.adres_pelny,
          tel: null,
          osoba_kontaktowa: null,
          masa_kg: zl.masa_kg,
          ilosc_palet: null,
          objetosc_m3: null,
          uwagi: [zl.rodzaj_dostawy, zl.uwagi].filter(Boolean).join('; ') || null,
          typ_dokumentu: 'WZ',
          ma_adres_dostawy: false,
          typ_pojazdu: kurs.typ_pojazdu,
        });
      }
    }
    setRows(allWz);
    setSelected(new Set(allWz.map((_, i) => i)));
  }, []);

  const toggleRow = (i: number) => {
    const s = new Set(selected);
    s.has(i) ? s.delete(i) : s.add(i);
    setSelected(s);
  };

  return (
    <div className="space-y-3">
      <div
        className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xls,.xlsx"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <p className="text-sm font-medium text-muted-foreground">📊 Wybierz plik Excel</p>
        <p className="text-xs text-muted-foreground mt-1">XLS, XLSX do 10 MB · Plan kursów z ERP</p>
      </div>

      {parsing && (
        <div className="text-center py-4">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground mt-2">Analizuję arkusz...</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{rows.length} WZ znalezionych</p>
          <div className="max-h-60 overflow-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 w-8"></th>
                  <th className="px-2 py-1 text-left">Nr WZ</th>
                  <th className="px-2 py-1 text-left">Odbiorca</th>
                  <th className="px-2 py-1 text-left">Adres</th>
                  <th className="px-2 py-1 text-right">Kg</th>
                  <th className="px-2 py-1 text-left">Typ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className="border-t border-muted/50 cursor-pointer hover:bg-muted/30"
                    onClick={() => toggleRow(i)}
                  >
                    <td className="px-2 py-1"><Checkbox checked={selected.has(i)} /></td>
                    <td className="px-2 py-1 font-mono">{r.numer_wz || '—'}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{r.odbiorca || '—'}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{r.adres || '—'}</td>
                    <td className="px-2 py-1 text-right">{r.masa_kg ?? '—'}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.typ_pojazdu || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            onClick={() => onParsed(rows.filter((_, i) => selected.has(i)))}
            disabled={selected.size === 0}
            className="w-full"
          >
            ✅ Importuj zaznaczone ({selected.size} WZ)
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── decodePUA — dekoduje znaki PUA z PDF (generyczny: offset = Unicode codepoint) ─── */
function decodePUA(text: string): string {
  // Windows-1250 mapping for 0x80-0x9F (control chars in Unicode, useful chars in Win-1250)
  const win1250: Record<number, string> = {
    0x80:'€',0x82:'‚',0x84:'„',0x85:'…',0x86:'†',0x87:'‡',
    0x89:'‰',0x8A:'Š',0x8B:'‹',0x8C:'Ś',0x8D:'Ť',0x8E:'Ž',0x8F:'Ź',
    0x91:'\u2018',0x92:'\u2019',0x93:'\u201C',0x94:'\u201D',
    0x95:'•',0x96:'–',0x97:'—',0x99:'™',
    0x9A:'š',0x9B:'›',0x9C:'ś',0x9D:'ť',0x9E:'ž',0x9F:'ź',
  };
  const bases = [0xE000, 0xF000, 0x10000];
  return Array.from(text).map(ch => {
    const cp = ch.codePointAt(0) ?? 0;
    for (const base of bases) {
      const off = cp - base;
      if (off >= 0x20 && off <= 0x24F) {
        if (off >= 0x80 && off <= 0x9F) return win1250[off] ?? '';
        return String.fromCodePoint(off);
      }
    }
    if ((cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0x10000) return '';
    return ch;
  }).join('');
}

/* ─── cleanText — remove non-printable chars from PDF clipboard ─── */
function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u024F\u2000-\u215F\n\r\t]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\n\s*){3,}/g, '\n\n');
}

/* ─── formatMasaKg — display with Polish thousands separator ─── */
function formatMasaKg(masa: number | null | undefined): string {
  if (!masa) return '';
  return Math.ceil(masa).toLocaleString('pl-PL');
}

/* ─── parseWZText — Ekonom WZ parser v5 ─── */
function parseWZText(rawText: string): WZImportData {
  const text = cleanText(decodePUA(rawText));
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 1. nr_wz — always prefix with "WZ " if missing
  let numer_wz: string | null = null;
  const wzM = text.match(/WZ\s+([A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/);
  if (wzM) {
    numer_wz = `WZ ${wzM[1]}`;
  } else {
    const wzBare = text.match(/([A-Z]{2}\/\d{2,3}\/\d{2}\/\d{2}\/\d{5,})/);
    if (wzBare) numer_wz = `WZ ${wzBare[1]}`;
  }

  // 2. nr_zamowienia — label first, then pattern
  let nr_zamowienia: string | null = null;
  const zamLabel = text.match(/Nr\s+zam(?:ówienia)?(?:\s*\(systemowy\))?[:\s\]]+([A-Z0-9\/]+)/i);
  if (zamLabel) nr_zamowienia = zamLabel[1];
  if (!nr_zamowienia) {
    const zamPattern = text.match(/([A-Z]{1,2}\d?\/[A-Z]{2}\/\d{4}\/\d{2}\/\d+)/);
    if (zamPattern) nr_zamowienia = zamPattern[1];
  }

  // 3. odbiorca — CRITICAL: skip SEWERA block completely, find second company
  let odbiorca: string | null = null;
  const SELLER_MARKERS = /SEWERA|KOŚCIUSZKI\s*326|NR\s*BDO:\s*000044503/i;
  const SKIP_PATTERNS = [
    SELLER_MARKERS, /ODDZIAŁ/i, /^ul\./i, /^al\./i, /^os\./i, /^pl\./i,
    /NIP:/i, /NR BDO:/i, /Adres\s+dostawy/i, /Waga\s+netto/i,
    /Nr\s+zam/i, /PALETA/i, /Tel\./i, /Os\.\s*kontaktowa/i,
    /^\d{2}-\d{3}/, /Katowice,\s*\d/, /Uwagi/i, /kontaktowa/i,
    /Budowa/i, /^\d+\s+(SZT|KG|M|OP|KPL)/i, /Magazyn/i,
    /^RAZEM/i, /Wystawił/i, /Na podstawie/i, /Nr oferty/i,
  ];

  // Find SEWERA line index to skip the seller block
  let seweraIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SELLER_MARKERS.test(lines[i])) { seweraIdx = i; break; }
  }

  // Search for odbiorca starting after SEWERA block
  const searchStart = seweraIdx >= 0 ? seweraIdx + 1 : 0;
  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_PATTERNS.some(p => p.test(line))) continue;
    const hasLegalForm = /SPÓŁKA|SP\.\s*K|SP\.\s*Z|S\.A\.|S\.C\.|Sp\.\s*z\s*o\.o\./i.test(line);
    const capsWords = line.split(/\s+/).filter(w => /^[A-ZĄĆĘŁŃÓŚŹŻ\-]{2,}$/.test(w)).length;
    if (hasLegalForm || capsWords >= 3) {
      odbiorca = line;
      break;
    }
  }

  // 4. adres_dostawy
  let adres: string | null = null;
  const adresIdx = lines.findIndex(l => /Adres\s+dostawy/i.test(l));

  // Priority 1: lines AFTER "Adres dostawy" (standalone section)
  if (adresIdx >= 0) {
    const addrParts: string[] = [];
    for (let i = adresIdx + 1; i < lines.length && i <= adresIdx + 8; i++) {
      const l = lines[i];
      if (/^(Os\.\s*kontaktowa|Tel\.|Nr\s+zam|PALETA|Waga|Uwagi|Termin|Wydano)/i.test(l)) break;
      if (/^Budowa/i.test(l)) continue;
      if (/ul\.|al\.|os\.|pl\./i.test(l) || /\d{2}-\d{3}/.test(l) || addrParts.length > 0) {
        addrParts.push(l);
      }
    }
    if (addrParts.length) adres = addrParts.join(', ').replace(/,\s*,/g, ',');
  }
  // Priority 2: lines BEFORE "Adres dostawy" (PDF column layout — address above header)
  if (!adres && adresIdx >= 0) {
    const addrParts: string[] = [];
    for (let i = adresIdx - 1; i >= Math.max(0, adresIdx - 8); i--) {
      const l = lines[i];
      if (/^(Os\.\s*kontaktowa|Tel\.|^p\.)/i.test(l)) continue;
      if (/NIP:|NR BDO:|SEWERA|ODDZIAŁ|Nr\s+ewid/i.test(l)) break;
      if (/\d{2}-\d{3}/.test(l)) { addrParts.unshift(l); continue; }
      if (/ul\.|al\.|os\.|pl\./i.test(l)) { addrParts.unshift(l); break; }
    }
    if (addrParts.length) adres = addrParts.join(', ').replace(/,\s*,/g, ',');
  }
  // Priority 3: "Budowa" line as delivery location
  if (!adres) {
    const budowaIdx = lines.findIndex(l => /^Budowa/i.test(l));
    if (budowaIdx >= 0) {
      const addrParts: string[] = [];
      for (let i = budowaIdx + 1; i < Math.min(budowaIdx + 5, lines.length); i++) {
        const l = lines[i];
        if (/^(Os\.\s*kontaktowa|Tel\.|Magazyn|Termin|Nr\s+zam)/i.test(l)) break;
        if (/ul\.|al\.|os\.|pl\./i.test(l) || /\d{2}-\d{3}/.test(l) || addrParts.length > 0) {
          addrParts.push(l);
        }
      }
      if (addrParts.length) adres = addrParts.join(', ').replace(/,\s*,/g, ',');
    }
  }
  // Priority 4: address from ODBIORCA block
  if (!adres && odbiorca) {
    const odbIdx = lines.indexOf(odbiorca);
    if (odbIdx >= 0) {
      for (let i = odbIdx + 1; i < Math.min(odbIdx + 3, lines.length); i++) {
        if (/ul\.|al\.|os\.|pl\./i.test(lines[i]) || /\d{2}-\d{3}/.test(lines[i])) {
          adres = lines[i];
          break;
        }
      }
    }
  }

  // 5. tel — search near delivery section (backward + forward from Adres dostawy / Budowa)
  let tel: string | null = null;
  const wystawilIdx = lines.findIndex(l => /Wystawił/i.test(l));
  const budowaIdx = lines.findIndex(l => /^Budowa/i.test(l));
  const deliveryAnchor = Math.max(budowaIdx, adresIdx >= 0 ? adresIdx : 0);
  if (deliveryAnchor >= 0) {
    // Search backward from anchor (PDF column layout: Tel. before Adres dostawy)
    for (let i = deliveryAnchor - 1; i >= Math.max(0, deliveryAnchor - 6); i--) {
      if (/NIP:|NR BDO:|SEWERA|ODDZIAŁ|Nr\s+ewid/i.test(lines[i])) break;
      const telM = lines[i].match(/Tel\.?:?\s*([\d\s]{9,})/i);
      if (telM) { tel = telM[1].trim(); break; }
    }
    // Search forward from anchor
    if (!tel) {
      const telEndIdx = lines.findIndex((l, i) => i > deliveryAnchor && /Nr\s+zam|Uwagi|PALETA|Waga|Lp\./i.test(l));
      const effectiveEnd = Math.min(
        telEndIdx >= 0 ? telEndIdx : deliveryAnchor + 10,
        wystawilIdx >= 0 ? wystawilIdx : lines.length
      );
      for (let i = deliveryAnchor; i < effectiveEnd && i < lines.length; i++) {
        const telM = lines[i].match(/Tel\.?:?\s*([\d\s]{9,})/i);
        if (telM) { tel = telM[1].trim(); break; }
      }
    }
  }

  // 6. masa_kg — last standalone number before "RAZEM:" line
  let masa_kg = 0;
  const razemIdx = lines.findIndex(l => /^RAZEM/i.test(l));
  if (razemIdx > 0) {
    for (let i = razemIdx - 1; i >= Math.max(0, razemIdx - 5); i--) {
      const s = lines[i].replace(/\s/g, '');
      const m = s.match(/^([\d,.]+)$/);
      if (m) { masa_kg = Math.ceil(parseFloat(m[1].replace(',', '.'))); break; }
    }
  }
  // Fallback: inline after "Waga netto razem:" label
  if (masa_kg === 0) {
    const wagaM = text.match(/Waga\s+netto\s+razem[:\s]*([\d]+[\d,.]*)/i);
    if (wagaM) masa_kg = Math.ceil(parseFloat(wagaM[1].replace(',', '.')) || 0);
  }

  // 7. objetosc_m3
  let objetosc_m3 = 0;
  const objM = text.match(/([\d.,]+)\s*m[³3]/i);
  if (objM) objetosc_m3 = parseFloat(objM[1].replace(',', '.')) || 0;

  // 8. ilosc_palet
  let ilosc_palet = 0;
  for (const line of lines) {
    if (/PALETA/i.test(line)) {
      const palQty = line.match(/(\d+)\s*(?:SZT|szt)/i);
      if (palQty) { ilosc_palet = parseInt(palQty[1]); break; }
    }
  }
  if (!ilosc_palet) {
    const palPattern = text.match(/paleta\s*=\s*(\d+)\s*szt/i);
    if (palPattern) ilosc_palet = parseInt(palPattern[1]);
  }

  // 9. uwagi — text after "Uwagi:" up to "Na podstawie art."
  //    Skip "Nr zamówienia (systemowy):" and "Nr oferty:" lines
  let uwagi: string | null = null;
  const uwagiIdx = lines.findIndex(l => /^Uwagi\s*:/i.test(l));
  if (uwagiIdx >= 0) {
    const afterLines: string[] = [];
    for (let i = uwagiIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/Na\s+podstawie\s+art/i.test(l)) break;
      if (/Nr\s+zam(?:ówienia)?\s*\(systemowy\)/i.test(l)) continue;
      if (/Nr\s+oferty/i.test(l)) continue;
      if (nr_zamowienia && l.trim() === nr_zamowienia) continue;
      afterLines.push(l);
    }
    uwagi = afterLines.join('\n').trim() || null;
  }

  console.log('[parseWZText v5] result:', {
    numer_wz, nr_zamowienia, odbiorca, adres, tel, masa_kg, ilosc_palet, objetosc_m3, uwagi,
  });

  return {
    numer_wz, nr_zamowienia, odbiorca, adres, tel,
    osoba_kontaktowa: null, masa_kg, ilosc_palet, objetosc_m3, uwagi,
    typ_dokumentu: 'WZ' as string | null, ma_adres_dostawy: false,
  };
}

/* ─── Paste Tab ─── */
function PasteTab({ onParsed }: { onParsed: (d: WZImportData) => void }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<WZImportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodedPreview, setDecodedPreview] = useState<string>('');

  const hasPUA = Array.from(text).some(ch => { const cp = ch.codePointAt(0) ?? 0; return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0x10000; });

  const parse = async () => {
    if (text.length === 0) return;
    setParsing(true);
    setError(null);
    setResult(null);

    // Lokalny parser jako baza (działa zawsze, niezależnie od edge function)
    const decoded = decodePUA(text);
    setDecodedPreview(decoded.slice(0, 200));
    console.log('[PasteTab v5] raw chars:', text.length, '| PUA:', hasPUA, '| decoded preview:', decoded.slice(0, 150));
    const local = parseWZText(text);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-wz-pdf`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        }
      );
      const json: ParsedPdfResult = await res.json();

      if (!json.error) {
        // Merge: edge function uzupełnia to czego lokalny parser nie znalazł
        setResult({
          numer_wz: json.nr_wz || local.numer_wz,
          nr_zamowienia: json.nr_zamowienia || local.nr_zamowienia,
          odbiorca: json.odbiorca || local.odbiorca,
          adres: json.adres_dostawy || local.adres,
          tel: json.osoba_kontaktowa || json.tel || local.tel,
          osoba_kontaktowa: json.osoba_kontaktowa || null,
          masa_kg: json.masa_kg || local.masa_kg,
          ilosc_palet: json.ilosc_palet || local.ilosc_palet,
          objetosc_m3: json.objetosc_m3 || local.objetosc_m3,
          uwagi: json.uwagi || local.uwagi,
          typ_dokumentu: (json as any).typ_dokumentu || 'WZ',
          ma_adres_dostawy: (json as any).ma_adres_dostawy ?? false,
        });
      } else {
        setResult(local);
      }
    } catch {
      // Brak połączenia — użyj lokalnego parsera
      setResult(local);
    }
    setParsing(false);
  };

  return (
    <div className="space-y-3">
      <Textarea
        className="min-h-[120px]"
        placeholder="Wklej tekst z dokumentu WZ — system wyciągnie nr WZ, odbiorcę, masę, adres..."
        value={text}
        onChange={e => setText(e.target.value)}
      />
      {hasPUA && (
        <p className="text-xs text-blue-600 dark:text-blue-400">🔑 Wykryto znaki PUA (font PDF) — zostaną zdekodowane</p>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={parse} disabled={text.length === 0 || parsing} size="sm">
          {parsing ? 'Analizuję...' : 'Parsuj tekst'}
        </Button>
        <span className="text-xs text-muted-foreground">parser v5</span>
      </div>
      {decodedPreview && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Podgląd zdekodowanego tekstu</summary>
          <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded max-h-28 overflow-auto mt-1">{decodedPreview}</pre>
        </details>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2 pt-2 border-t">
          {([
            ['Nr WZ', result.numer_wz],
            ['Nr zamówienia', result.nr_zamowienia],
            ['Odbiorca', result.odbiorca],
            ['Adres', result.adres],
            ['Telefon', result.tel],
            ['Masa kg', formatMasaKg(result.masa_kg)],
            ['Ilość palet', result.ilosc_palet?.toString()],
            ['Objętość m³', result.objetosc_m3?.toString()],
          ] as [string, string | undefined | null][]).map(([label, val]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span className="w-4">{val ? '✓' : '⚠️'}</span>
              <span className="text-muted-foreground w-28">{label}</span>
              <span className="font-medium">{val || '—'}</span>
            </div>
          ))}
          <Button onClick={() => onParsed(result)} className="w-full mt-2">✅ Użyj tych danych</Button>
        </div>
      )}
    </div>
  );
}

/* ─── Manual Tab ─── */
function ManualTab({ onParsed }: { onParsed: (d: WZImportData) => void }) {
  const [form, setForm] = useState<WZImportData>({
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', osoba_kontaktowa: null,
    masa_kg: 0, ilosc_palet: null, objetosc_m3: null, uwagi: '', typ_dokumentu: 'WZ', ma_adres_dostawy: false,
  });

  const update = (field: keyof WZImportData, val: string | number | null) =>
    setForm(prev => ({ ...prev, [field]: val }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Nr WZ</Label><Input className="h-8 text-sm" value={form.numer_wz ?? ''} onChange={e => update('numer_wz', e.target.value)} /></div>
        <div><Label className="text-xs">Nr zamówienia</Label><Input className="h-8 text-sm" value={form.nr_zamowienia ?? ''} onChange={e => update('nr_zamowienia', e.target.value)} /></div>
        <div><Label className="text-xs">Odbiorca *</Label><Input className="h-8 text-sm" value={form.odbiorca ?? ''} onChange={e => update('odbiorca', e.target.value)} /></div>
        <div><Label className="text-xs">Adres *</Label><Input className="h-8 text-sm" value={form.adres ?? ''} onChange={e => update('adres', e.target.value)} /></div>
        <div><Label className="text-xs">Telefon</Label><Input className="h-8 text-sm" value={form.tel ?? ''} onChange={e => update('tel', e.target.value)} /></div>
        <div><Label className="text-xs">Masa kg *</Label><Input className="h-8 text-sm" type="number" value={form.masa_kg ?? ''} onChange={e => update('masa_kg', Number(e.target.value))} /></div>
        <div>
          <Label className="text-xs">Ilość palet</Label>
          <Input className="h-8 text-sm" type="number" value={form.ilosc_palet ?? ''} onChange={e => update('ilosc_palet', e.target.value ? Number(e.target.value) : 0)} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Uzupełnij jeśli brak na dokumencie</p>
        </div>
        <div>
          <Label className="text-xs">Objętość m³</Label>
          <Input className="h-8 text-sm" type="number" value={form.objetosc_m3 ?? ''} onChange={e => update('objetosc_m3', e.target.value ? Number(e.target.value) : 0)} />
          <p className="text-[10px] text-muted-foreground mt-0.5">Uzupełnij jeśli brak na dokumencie</p>
        </div>
        <div className="col-span-2"><Label className="text-xs">Uwagi</Label><Input className="h-8 text-sm" value={form.uwagi ?? ''} onChange={e => update('uwagi', e.target.value)} /></div>
      </div>
      <Button onClick={() => onParsed(form)} disabled={!form.odbiorca && !form.adres} className="w-full">
        ✅ Użyj tych danych
      </Button>
    </div>
  );
}

/* ─── Main Modal ─── */
export function ModalImportWZ({ isOpen, onClose, onImport, hideXls }: Props) {
  const [activeTab, setActiveTab] = useState('pdf');

  const handleSingle = useCallback((d: WZImportData) => {
    onImport([d]);
    onClose();
  }, [onImport, onClose]);

  const handleMulti = useCallback((data: WZImportData[]) => {
    onImport(data);
    onClose();
  }, [onImport, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>📥 Import WZ</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="pdf" className="flex-1 text-xs">📄 PDF / Skan</TabsTrigger>
            {!hideXls && <TabsTrigger value="xls" className="flex-1 text-xs">📊 XLS/XLSX</TabsTrigger>}
            <TabsTrigger value="paste" className="flex-1 text-xs">📋 Wklej tekst</TabsTrigger>
            <TabsTrigger value="manual" className="flex-1 text-xs">✏️ Ręcznie</TabsTrigger>
          </TabsList>

          <TabsContent value="pdf">
            <PdfTab onParsed={handleSingle} onSwitchManual={() => setActiveTab('manual')} />
          </TabsContent>
          {!hideXls && (
            <TabsContent value="xls">
              <XlsTab onParsed={handleMulti} />
            </TabsContent>
          )}
          <TabsContent value="paste">
            <PasteTab onParsed={handleSingle} />
          </TabsContent>
          <TabsContent value="manual">
            <ManualTab onParsed={handleSingle} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
// v6
