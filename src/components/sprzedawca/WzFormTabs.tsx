import { useState, useRef, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { WzInput } from '@/hooks/useCreateZlecenie';

interface WzFormTabsProps {
  wzList: WzInput[];
  setWzList: (wz: WzInput[]) => void;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}


const EMPTY_WZ: WzInput = {
  numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0, uwagi: '',
};

function WzManualForm({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const addWz = () => setWzList([...wzList, { ...EMPTY_WZ }]);

  const updateWz = (idx: number, field: keyof WzInput, value: string | number) => {
    const copy = [...wzList];
    (copy[idx] as any)[field] = value;
    setWzList(copy);
  };

  const removeWz = (idx: number) => {
    if (wzList.length <= 1) return;
    setWzList(wzList.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {wzList.map((wz, idx) => (
        <Card key={idx} className="p-3 space-y-2 bg-muted/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">WZ #{idx + 1}</span>
            {wzList.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => removeWz(idx)} className="text-destructive h-6 text-xs">Usuń</Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Nr WZ</Label><Input className="h-8 text-sm" value={wz.numer_wz || ''} onChange={e => updateWz(idx, 'numer_wz', e.target.value)} /></div>
            <div><Label className="text-xs">Nr zamówienia</Label><Input className="h-8 text-sm" value={wz.nr_zamowienia || ''} onChange={e => updateWz(idx, 'nr_zamowienia', e.target.value)} /></div>
            <div><Label className="text-xs">Odbiorca *</Label><Input className="h-8 text-sm" value={wz.odbiorca} onChange={e => updateWz(idx, 'odbiorca', e.target.value)} /></div>
            <div><Label className="text-xs">Adres *</Label><Input className="h-8 text-sm" value={wz.adres} onChange={e => updateWz(idx, 'adres', e.target.value)} /></div>
            <div><Label className="text-xs">Telefon</Label><Input className="h-8 text-sm" value={wz.tel || ''} onChange={e => updateWz(idx, 'tel', e.target.value)} /></div>
            <div><Label className="text-xs">Masa (kg) *</Label><Input className="h-8 text-sm" type="number" value={wz.masa_kg || ''} onChange={e => updateWz(idx, 'masa_kg', Number(e.target.value))} /></div>
            <div>
              <Label className="text-xs">Objętość (m³) {!wz.luzne_karton && '*'}</Label>
              <Input className="h-8 text-sm" type="number" value={wz.luzne_karton ? 0 : (wz.objetosc_m3 || '')} disabled={wz.luzne_karton} onChange={e => updateWz(idx, 'objetosc_m3', Number(e.target.value))} />
              <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                <Checkbox checked={wz.luzne_karton || false} onCheckedChange={(checked) => { updateWz(idx, 'luzne_karton', !!checked); if (checked) updateWz(idx, 'objetosc_m3', 0); }} />
                <span className="text-[11px] text-muted-foreground">Luźne/karton</span>
              </label>
            </div>
            <div>
              <Label className="text-xs">Palety (szt) {!wz.bez_palet && '*'}</Label>
              <Input className="h-8 text-sm" type="number" min={0} placeholder="0" value={wz.bez_palet ? 0 : (wz.ilosc_palet || '')} disabled={wz.bez_palet} onChange={e => updateWz(idx, 'ilosc_palet', Number(e.target.value))} />
              <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                <Checkbox checked={wz.bez_palet || false} onCheckedChange={(checked) => { updateWz(idx, 'bez_palet', !!checked); if (checked) updateWz(idx, 'ilosc_palet', 0); }} />
                <span className="text-[11px] text-muted-foreground">Bez palet</span>
              </label>
            </div>
            <div className="col-span-2"><Label className="text-xs">Uwagi</Label><Input className="h-8 text-sm" value={wz.uwagi || ''} onChange={e => updateWz(idx, 'uwagi', e.target.value)} /></div>
          </div>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={addWz}>+ Dodaj WZ</Button>
    </div>
  );
}

/* ─── PDF Tab ─── */
function WzPdfTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsePreview | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.pdf')) {
      setError('Wymagany plik PDF');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Plik za duży (max 10 MB)');
      return;
    }
    setParsing(true);
    setError(null);
    setPreview(null);

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const lines: string[] = [];
        let currentLine = '';
        let lastY: number | null = null;
        for (const item of content.items as any[]) {
          if (!item.str && item.str !== '') continue;
          const y = item.transform ? item.transform[5] : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = item.str;
          } else {
            currentLine += (currentLine && item.str && !currentLine.endsWith(' ') ? ' ' : '') + item.str;
          }
          if (y !== null) lastY = y;
          if (item.hasEOL) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = '';
            lastY = null;
          }
        }
        if (currentLine.trim()) lines.push(currentLine.trim());
        pages.push(lines.join('\n'));
      }
      const rawText = pages.join('\n');

      if (!rawText || rawText.trim().length < 10) {
        setParsing(false);
        setError('Nie można odczytać PDF — plik może być zeskanowanym obrazem. Użyj zakładki OCR.');
        return;
      }

      const { parseWZText } = await import('@/components/shared/ModalImportWZ');
      const mapped = parseWZText(rawText);

      setPreview({
        numer_wz: mapped.numer_wz || '',
        nr_zamowienia: mapped.nr_zamowienia || '',
        odbiorca: mapped.odbiorca || '',
        adres: mapped.adres || '',
        tel: mapped.osoba_kontaktowa ? `${mapped.osoba_kontaktowa}${mapped.tel ? ', tel. ' + mapped.tel : ''}` : (mapped.tel || ''),
        masa_kg: mapped.masa_kg || 0,
        objetosc_m3: mapped.objetosc_m3 || 0,
        ilosc_palet: mapped.ilosc_palet || 0,
        uwagi: mapped.uwagi || '',
      });
    } catch (err) {
      setError('Błąd odczytu PDF: ' + (err as Error).message);
    }
    setParsing(false);
  }, []);

  const handleConfirm = () => {
    if (!preview) return;
    const newWz: WzInput = { ...preview };
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList([newWz]);
    } else {
      setWzList([...wzList, newWz]);
    }
    setPreview(null);
  };

  const previewFields: { key: keyof ParsePreview; label: string; type?: string }[] = [
    { key: 'numer_wz', label: 'Nr WZ' },
    { key: 'nr_zamowienia', label: 'Nr zamówienia' },
    { key: 'odbiorca', label: 'Odbiorca' },
    { key: 'adres', label: 'Adres dostawy' },
    { key: 'tel', label: 'Telefon / kontakt' },
    { key: 'masa_kg', label: 'Masa (kg)', type: 'number' },
    { key: 'objetosc_m3', label: 'Objętość (m³)', type: 'number' },
    { key: 'ilosc_palet', label: 'Palety (szt)', type: 'number' },
    { key: 'uwagi', label: 'Uwagi' },
  ];

  return (
    <div className="space-y-3 pt-2">
      {!preview && !parsing && (
        <div
          className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <div className="text-3xl mb-2">📄</div>
          <p className="text-sm font-medium text-muted-foreground">Przeciągnij PDF lub kliknij aby wybrać</p>
          <p className="text-xs text-muted-foreground mt-1">PDF do 10 MB</p>
        </div>
      )}

      {parsing && (
        <div className="text-center py-4">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground mt-2">Analizuję PDF...</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {preview && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Sprawdź i popraw dane z PDF:</p>
          <div className="space-y-2">
            {previewFields.map(f => {
              const val = preview[f.key];
              const found = val !== '' && val !== 0;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-sm w-4">{found ? '✓' : '⚠️'}</span>
                  <Label className="text-xs w-32 shrink-0">{f.label}</Label>
                  <Input
                    className="h-8 text-sm flex-1"
                    type={f.type || 'text'}
                    value={val?.toString() ?? ''}
                    onChange={e => {
                      const raw = e.target.value;
                      setPreview(prev => prev ? { ...prev, [f.key]: f.type === 'number' ? (Number(raw) || 0) : raw } : prev);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm}>Użyj tych danych</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setError(null); }}>Nowy plik</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── XLS Tab ─── */
const XLS_HEADER_PATTERNS: { patterns: RegExp[]; field: string }[] = [
  { patterns: [/^kierowca$/i, /^kier$/i], field: 'kierowca' },
  { patterns: [/^kurs$/i], field: 'kurs' },
  { patterns: [/^nazwa\s*kontrahenta$/i, /^kontrahent$/i], field: 'odbiorca' },
  { patterns: [/^miejscowo/i, /^miasto$/i], field: 'miasto' },
  { patterns: [/^ulica$/i, /^adres$/i], field: 'ulica' },
  { patterns: [/^nr\s*wz$/i, /^wz$/i], field: 'nr_wz' },
  { patterns: [/^masa$/i, /^waga$/i], field: 'masa' },
  { patterns: [/^typ\s*samochodu$/i, /^rodzaj\s*samochodu$/i, /^klasyfikacja$/i, /^typ$/i], field: 'typ' },
  { patterns: [/^rodzaj\s*dostawy$/i], field: 'rodzaj_dostawy' },
  { patterns: [/^uwagi/i], field: 'uwagi' },
];

const XLS_TYP_MAP: Record<string, string | null> = {
  A: null, B: 'Dostawczy 1,2t', C: 'Winda 1,8t', D: 'Winda 6,3t',
  E: 'Winda MAX 15,8t', F: 'HDS 12,0t', G: 'HDS 12,0t', H: 'HDS 9,0t', I: 'HDS 9,0t',
};

function matchXlsHeader(h: string): string | null {
  const t = (h || '').replace(/[\s\n\r]+/g, ' ').trim();
  for (const hp of XLS_HEADER_PATTERNS) {
    for (const p of hp.patterns) { if (p.test(t)) return hp.field; }
  }
  return null;
}

function WzXlsTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<{ numer_wz: string; odbiorca: string; adres: string; masa_kg: number; uwagi: string; typ_pojazdu: string | null }[]>([]);
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

    try {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (rawRows.length < 2) { setError('Plik jest pusty'); setParsing(false); return; }

      let headerIdx = -1;
      const colMap = new Map<number, string>();
      for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
        const tempMap = new Map<number, string>();
        for (let j = 0; j < (rawRows[i]?.length || 0); j++) {
          const field = matchXlsHeader(String(rawRows[i][j] || ''));
          if (field) tempMap.set(j, field);
        }
        if (tempMap.size >= 3) {
          headerIdx = i;
          tempMap.forEach((v, k) => colMap.set(k, v));
          break;
        }
      }

      if (headerIdx === -1) { setError('Nie rozpoznano nagłówków kolumn'); setParsing(false); return; }

      const fieldCol: Record<string, number> = {};
      colMap.forEach((field, idx) => { fieldCol[field] = idx; });
      const get = (row: any[], field: string): string => {
        const idx = fieldCol[field]; return idx !== undefined ? String(row[idx] ?? '').trim() : '';
      };
      const getNum = (row: any[], field: string): number => {
        const v = get(row, field); if (!v) return 0;
        const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
        return isNaN(n) ? 0 : Math.ceil(n);
      };

      const allWz: typeof rows = [];
      let currentTyp: string | null = null;

      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.every((c: any) => !c && c !== 0)) continue;

        const nrWz = get(row, 'nr_wz');
        const odbiorca = get(row, 'odbiorca');
        const masa = getNum(row, 'masa');
        const typKod = get(row, 'typ').toUpperCase().trim().charAt(0);

        if (!nrWz && !odbiorca && masa) continue;
        if (!nrWz && !odbiorca) continue;

        if (typKod && XLS_TYP_MAP[typKod] !== undefined) currentTyp = XLS_TYP_MAP[typKod];

        const miasto = get(row, 'miasto');
        const ulica = get(row, 'ulica');
        const rodzajDostawy = get(row, 'rodzaj_dostawy');
        const uwagi = get(row, 'uwagi');

        allWz.push({
          numer_wz: nrWz,
          odbiorca,
          adres: [ulica, miasto].filter(Boolean).join(', '),
          masa_kg: masa,
          uwagi: [rodzajDostawy, uwagi].filter(Boolean).join('; '),
          typ_pojazdu: currentTyp,
        });
      }

      setRows(allWz);
      setSelected(new Set(allWz.map((_, i) => i)));
    } catch (err) {
      setError('Błąd odczytu pliku: ' + (err as Error).message);
    }
    setParsing(false);
  }, []);

  const toggleRow = (i: number) => {
    const s = new Set(selected);
    s.has(i) ? s.delete(i) : s.add(i);
    setSelected(s);
  };

  const handleImport = () => {
    const selectedRows = rows.filter((_, i) => selected.has(i));
    const newWzList: WzInput[] = selectedRows.map(r => ({
      numer_wz: r.numer_wz || '', nr_zamowienia: '', odbiorca: r.odbiorca || '',
      adres: r.adres || '', tel: '', masa_kg: r.masa_kg || 0,
      objetosc_m3: 0, ilosc_palet: 0, uwagi: r.uwagi || '',
    }));
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList(newWzList);
    } else {
      setWzList([...wzList, ...newWzList]);
    }
    setRows([]);
    setSelected(new Set());
  };

  return (
    <div className="space-y-3 pt-2">
      {rows.length === 0 && !parsing && (
        <div
          className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <div className="text-3xl mb-2">📊</div>
          <p className="text-sm font-medium text-muted-foreground">Wybierz plik Excel</p>
          <p className="text-xs text-muted-foreground mt-1">XLS, XLSX do 10 MB</p>
        </div>
      )}

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
                  <tr key={i} className="border-t border-muted/50 cursor-pointer hover:bg-muted/30"
                    onClick={() => toggleRow(i)}>
                    <td className="px-2 py-1"><Checkbox checked={selected.has(i)} /></td>
                    <td className="px-2 py-1 font-mono">{r.numer_wz || '—'}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{r.odbiorca || '—'}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{r.adres || '—'}</td>
                    <td className="px-2 py-1 text-right">{r.masa_kg || '—'}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.typ_pojazdu || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleImport} disabled={selected.size === 0}>
              Importuj zaznaczone ({selected.size} WZ)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setRows([]); setSelected(new Set()); }}>
              Nowy plik
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── OCR Tab ─── */
function WzOcrTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'text' | 'preview'>('upload');
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImage = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) { setError("Plik za duży (max 15 MB)"); return; }
    setParsing(true);
    setError(null);
    setProgress(0);
    setProgressMsg("Ładowanie modelu OCR...");

    try {
      const TesseractModule = await import("tesseract.js");
      // PSM 4 = kolumnowe rozpoznawanie — lepiej rozdziela kolumny tabel
      const worker = await TesseractModule.default.createWorker("pol", undefined, {
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            const pct = Math.round((m.progress || 0) * 100);
            setProgress(pct);
            setProgressMsg(`Rozpoznawanie tekstu: ${pct}%`);
          } else if (m.status === "loading language traineddata") {
            setProgressMsg("Pobieranie modelu języka polskiego...");
            setProgress(10);
          }
        },
      });
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      setParsing(false);
      const cleaned = cleanOcrText(text || "");
      setOcrText(cleaned);

      if (cleaned.trim().length < 10) {
        setError("Nie udało się rozpoznać tekstu. Spróbuj lepsze zdjęcie.");
        return;
      }
      setStep('text');
    } catch (e: any) {
      setParsing(false);
      setError("Błąd OCR: " + (e.message || "nieznany"));
    }
  };

  const handleParse = async () => {
    const { parseWZText } = await import("@/components/shared/ModalImportWZ");
    const mapped = parseWZText(ocrText);
    setPreview({
      numer_wz: mapped.numer_wz || '',
      nr_zamowienia: mapped.nr_zamowienia || '',
      odbiorca: mapped.odbiorca || '',
      adres: mapped.adres || '',
      tel: mapped.osoba_kontaktowa ? `${mapped.osoba_kontaktowa}${mapped.tel ? ', tel. ' + mapped.tel : ''}` : (mapped.tel || ''),
      masa_kg: mapped.masa_kg || 0,
      objetosc_m3: mapped.objetosc_m3 || 0,
      ilosc_palet: mapped.ilosc_palet || 0,
      uwagi: mapped.uwagi || '',
    });
    setStep('preview');
  };

  const previewFields: { key: keyof ParsePreview; label: string; type?: string }[] = [
    { key: 'numer_wz', label: 'Nr WZ' },
    { key: 'nr_zamowienia', label: 'Nr zamówienia' },
    { key: 'odbiorca', label: 'Odbiorca' },
    { key: 'adres', label: 'Adres dostawy' },
    { key: 'tel', label: 'Telefon / kontakt' },
    { key: 'masa_kg', label: 'Masa (kg)', type: 'number' },
    { key: 'objetosc_m3', label: 'Objętość (m³)', type: 'number' },
    { key: 'ilosc_palet', label: 'Palety (szt)', type: 'number' },
    { key: 'uwagi', label: 'Uwagi' },
  ];

  const handleConfirm = () => {
    if (!preview) return;
    const newWz: WzInput = { ...preview };
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList([newWz]);
    } else {
      setWzList([...wzList, newWz]);
    }
    setStep('upload');
    setPreview(null);
    setOcrText("");
  };

  return (
    <div className="space-y-3 pt-2">
      {step === 'upload' && !parsing && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => cameraRef.current?.click()}
            >
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); }} />
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm font-medium text-muted-foreground">Zrób zdjęcie</p>
            </div>
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImage(f); }}
            >
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/heic,image/webp" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); }} />
              <div className="text-3xl mb-2">🖼️</div>
              <p className="text-sm font-medium text-muted-foreground">Wybierz plik</p>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}

      {parsing && (
        <div className="space-y-2 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{progressMsg}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div className="bg-primary h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {step === 'text' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">OCR rozpoznał tekst. Popraw błędy i kliknij Parsuj:</p>
          <textarea
            className="w-full min-h-[180px] font-mono text-xs border rounded-md p-2 bg-background"
            value={ocrText}
            onChange={e => setOcrText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleParse}>Parsuj dane</Button>
            <Button size="sm" variant="outline" onClick={() => { setStep('upload'); setOcrText(""); }}>Nowe zdjęcie</Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Sprawdź i popraw dane:</p>
          <div className="space-y-2">
            {previewFields.map(f => {
              const val = preview[f.key];
              const found = val !== '' && val !== 0;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-sm w-4">{found ? '✓' : '⚠️'}</span>
                  <Label className="text-xs w-32 shrink-0">{f.label}</Label>
                  <Input
                    className="h-8 text-sm flex-1"
                    type={f.type || 'text'}
                    value={val?.toString() ?? ''}
                    onChange={e => {
                      const raw = e.target.value;
                      setPreview(prev => prev ? { ...prev, [f.key]: f.type === 'number' ? (Number(raw) || 0) : raw } : prev);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm}>Użyj tych danych</Button>
            <Button size="sm" variant="outline" onClick={() => setStep('text')}>Popraw tekst</Button>
            <Button size="sm" variant="ghost" onClick={() => { setStep('upload'); setPreview(null); setOcrText(""); }}>Nowe zdjęcie</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Czyści tekst z OCR — usuwa artefakty tabel (|, =, ramki), normalizuje whitespace
function cleanOcrText(raw: string): string {
  let t = raw;
  // Usuń pipe chars (ramki tabel) i zastąp spacją
  t = t.replace(/\|/g, ' ');
  // Usuń linie składające się tylko z = - _ + (separatory tabel)
  t = t.replace(/^[\s=\-_+]{3,}$/gm, '');
  // Usuń powtarzające się = - (artefakty tabel inline)
  t = t.replace(/[=\-]{3,}/g, ' ');
  // Normalizuj wielokrotne spacje
  t = t.replace(/[ \t]{2,}/g, ' ');
  // Normalizuj wielokrotne puste linie
  t = t.replace(/(\n\s*){3,}/g, '\n\n');
  return t.trim();
}

type ParsePreview = {
  numer_wz: string;
  nr_zamowienia: string;
  odbiorca: string;
  adres: string;
  tel: string;
  masa_kg: number;
  objetosc_m3: number;
  ilosc_palet: number;
  uwagi: string;
};

function WzPasteTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const handleParse = async () => {
    if (text.length === 0) return;
    setParsing(true);
    setError(null);
    setPreview(null);

    // Single source of truth — parseWZText z ModalImportWZ (bez edge function)
    const { parseWZText } = await import("@/components/shared/ModalImportWZ");
    const mapped = parseWZText(text);
    setPreview({
      numer_wz: mapped.numer_wz || '',
      nr_zamowienia: mapped.nr_zamowienia || '',
      odbiorca: mapped.odbiorca || '',
      adres: mapped.adres || '',
      tel: mapped.osoba_kontaktowa ? `${mapped.osoba_kontaktowa}${mapped.tel ? ', tel. ' + mapped.tel : ''}` : (mapped.tel || ''),
      masa_kg: mapped.masa_kg || 0,
      objetosc_m3: mapped.objetosc_m3 || 0,
      ilosc_palet: mapped.ilosc_palet || 0,
      uwagi: mapped.uwagi || '',
    });
    setParsing(false);
  };

  const handleConfirm = () => {
    if (!preview) return;
    const newWz: WzInput = { ...preview };
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList([newWz]);
    } else {
      setWzList([...wzList, newWz]);
    }
    setText('');
    setPreview(null);
  };

  const previewFields: { key: keyof ParsePreview; label: string; type?: string }[] = [
    { key: 'numer_wz', label: 'Nr WZ' },
    { key: 'nr_zamowienia', label: 'Nr zamówienia' },
    { key: 'odbiorca', label: 'Odbiorca' },
    { key: 'adres', label: 'Adres dostawy' },
    { key: 'tel', label: 'Telefon / kontakt' },
    { key: 'masa_kg', label: 'Masa (kg)', type: 'number' },
    { key: 'objetosc_m3', label: 'Objętość (m³)', type: 'number' },
    { key: 'ilosc_palet', label: 'Palety (szt)', type: 'number' },
    { key: 'uwagi', label: 'Uwagi' },
  ];

  return (
    <div className="space-y-3">
      {!preview && (
        <>
          <Textarea
            className="min-h-[120px] font-mono text-xs"
            placeholder="Wklej tekst z dokumentu WZ (z PDF, e-maila itp.) — system wyciągnie dane automatycznie"
            value={text}
            onChange={e => { setText(e.target.value); setError(null); }}
          />
          <div className="flex items-center gap-2">
            <Button onClick={handleParse} disabled={text.length === 0 || parsing} size="sm">
              {parsing ? 'Analizuję...' : 'Parsuj tekst'}
            </Button>
          </div>
          {parsing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
              Analizuję dokument...
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}

      {preview && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Sprawdź i popraw odczytane dane:</p>
          <div className="space-y-2">
            {previewFields.map(f => {
              const val = preview[f.key];
              const found = val !== '' && val !== 0;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-sm w-4">{found ? '✓' : '⚠️'}</span>
                  <Label className="text-xs w-32 shrink-0">{f.label}</Label>
                  <Input
                    className="h-8 text-sm flex-1"
                    type={f.type || 'text'}
                    value={val?.toString() ?? ''}
                    onChange={e => {
                      const raw = e.target.value;
                      setPreview(prev => prev ? {
                        ...prev,
                        [f.key]: f.type === 'number' ? (Number(raw) || 0) : raw,
                      } : prev);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm}>✅ Użyj tych danych</Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>← Wróć do tekstu</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WzFormTabs({ wzList, setWzList, error, submitting, onBack, onSubmit }: WzFormTabsProps) {
  return (
    <div className="space-y-4">
      

      <Tabs defaultValue="reczne">
        <TabsList className="w-full">
          <TabsTrigger value="pdf" className="flex-1 text-xs">PDF</TabsTrigger>
          <TabsTrigger value="ocr" className="flex-1 text-xs">OCR</TabsTrigger>
          <TabsTrigger value="xls" className="flex-1 text-xs">XLS</TabsTrigger>
          <TabsTrigger value="paste" className="flex-1 text-xs">Wklej</TabsTrigger>
          <TabsTrigger value="reczne" className="flex-1 text-xs">Ręcznie</TabsTrigger>
        </TabsList>

        <TabsContent value="pdf"><WzPdfTab wzList={wzList} setWzList={setWzList} /></TabsContent>
        <TabsContent value="ocr"><WzOcrTab wzList={wzList} setWzList={setWzList} /></TabsContent>
        <TabsContent value="xls"><WzXlsTab wzList={wzList} setWzList={setWzList} /></TabsContent>
        <TabsContent value="paste"><WzPasteTab wzList={wzList} setWzList={setWzList} /></TabsContent>
        <TabsContent value="reczne"><WzManualForm wzList={wzList} setWzList={setWzList} /></TabsContent>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>← Wstecz</Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? 'Wysyłanie...' : 'Sprawdź dostępność →'}
        </Button>
      </div>
    </div>
  );
}
