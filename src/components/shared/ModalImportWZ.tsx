import { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

export interface WZImportData {
  numer_wz: string | null;
  nr_zamowienia: string | null;
  odbiorca: string | null;
  adres: string | null;
  tel: string | null;
  masa_kg: number | null;
  uwagi: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (wzData: WZImportData[]) => void;
  hideXls?: boolean; // hide XLS tab for mobile/kierowca
}

/* ─── PDF Tab ─── */
function PdfTab({ onParsed, onSwitchManual }: { onParsed: (d: WZImportData) => void; onSwitchManual: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<(WZImportData & { pewnosc: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
      setError('Rozpoznawanie tekstu ze zdjęć wymaga ręcznego uzupełnienia. Dane z obrazu nie mogą być automatycznie odczytane.');
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

    const formData = new FormData();
    formData.append('file', file);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-wz-pdf`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: formData,
      }
    );
    const json = await res.json();
    setParsing(false);

    if (json.error) {
      setError(json.error);
      return;
    }

    setResult({
      numer_wz: json.nr_wz,
      nr_zamowienia: json.nr_zamowienia,
      odbiorca: json.odbiorca,
      adres: json.adres_dostawy,
      tel: json.tel,
      masa_kg: json.masa_kg,
      uwagi: json.uwagi,
      pewnosc: json.pewnosc,
    });
  }, [onSwitchManual]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const fields: { key: keyof WZImportData; label: string }[] = [
    { key: 'numer_wz', label: 'Nr WZ' },
    { key: 'nr_zamowienia', label: 'Nr zamówienia' },
    { key: 'odbiorca', label: 'Odbiorca' },
    { key: 'adres', label: 'Adres dostawy' },
    { key: 'tel', label: 'Telefon' },
    { key: 'masa_kg', label: 'Masa kg' },
    { key: 'uwagi', label: 'Uwagi' },
  ];

  const foundCount = result ? fields.filter(f => result[f.key] != null && result[f.key] !== '').length : 0;

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

      {result && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Odczytano {foundCount}/7 pól</p>
          <div className="space-y-2">
            {fields.map(f => {
              const val = result[f.key];
              const found = val != null && val !== '';
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-sm w-4">{found ? '✓' : '⚠️'}</span>
                  <Label className="text-xs w-28 shrink-0">{f.label}</Label>
                  <Input
                    className="h-8 text-sm flex-1"
                    type={f.key === 'masa_kg' ? 'number' : 'text'}
                    value={val?.toString() ?? ''}
                    onChange={e => {
                      setResult(prev => prev ? {
                        ...prev,
                        [f.key]: f.key === 'masa_kg' ? Number(e.target.value) : e.target.value,
                      } : prev);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <Button onClick={() => onParsed(result)} className="w-full">✅ Użyj tych danych</Button>
        </div>
      )}
    </div>
  );
}

/* ─── XLS Tab ─── */
function XlsTab({ onParsed }: { onParsed: (rows: WZImportData[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<WZImportData[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError('Plik za duży (max 5 MB)');
      return;
    }
    setParsing(true);
    setError(null);
    setRows([]);

    const formData = new FormData();
    formData.append('file', file);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-wz-xls`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: formData,
      }
    );
    const json = await res.json();
    setParsing(false);

    if (json.error) {
      setError(json.error);
      return;
    }

    const mapped: WZImportData[] = (json.wiersze || []).map((w: any) => ({
      numer_wz: w.nr_wz,
      nr_zamowienia: w.nr_zamowienia,
      odbiorca: w.odbiorca,
      adres: w.adres_dostawy,
      tel: w.tel,
      masa_kg: w.masa_kg,
      uwagi: w.uwagi,
    }));
    setRows(mapped);
    setSelected(new Set(mapped.map((_, i) => i)));
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
          accept=".xls,.xlsx,.csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <p className="text-sm font-medium text-muted-foreground">📊 Wybierz plik Excel / CSV</p>
        <p className="text-xs text-muted-foreground mt-1">XLS, XLSX, CSV do 5 MB</p>
      </div>

      {parsing && (
        <div className="text-center py-4">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground mt-2">Wczytuję arkusz...</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{rows.length} wierszy znalezionych</p>
          <div className="max-h-60 overflow-auto space-y-1">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:bg-muted/50"
                onClick={() => toggleRow(i)}
              >
                <Checkbox checked={selected.has(i)} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono">{r.numer_wz || '—'}</span>
                  <span className="text-xs text-muted-foreground mx-2">{r.odbiorca || '—'}</span>
                  <span className="text-xs">{r.masa_kg ? `${r.masa_kg} kg` : ''}</span>
                </div>
              </div>
            ))}
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

/* ─── Paste Tab ─── */
function PasteTab({ onParsed }: { onParsed: (d: WZImportData) => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<WZImportData | null>(null);

  const parse = () => {
    if (!text.trim()) return;
    const r: WZImportData = {
      numer_wz: null, nr_zamowienia: null, odbiorca: null,
      adres: null, tel: null, masa_kg: null, uwagi: null,
    };

    const wzM = text.match(/WZ\s+[A-Z]{2}\/[\d\/]+/);
    if (wzM) r.numer_wz = wzM[0].replace(/^WZ\s+/, '');

    const zamM = text.match(/T7\/[A-Z]{2}\/[\d\/]+/i);
    if (zamM) r.nr_zamowienia = zamM[0];

    const odbM = text.match(/Odbiorca[:\s]+(.+?)(?:\n|$)/i);
    if (odbM) r.odbiorca = odbM[1].trim();

    const adrM = text.match(/ul\.\s*.+\d{2}-\d{3}\s*\w+/i);
    if (adrM) r.adres = adrM[0].trim();

    const telM = text.match(/Tel\.?:?\s*([\d\s]{9,})/i);
    if (telM) r.tel = telM[1].trim();

    // Last kg match
    const kgMatches = [...text.matchAll(/([\d.,]+)\s*kg/gi)];
    if (kgMatches.length > 0) {
      r.masa_kg = parseFloat(kgMatches[kgMatches.length - 1][1].replace(',', '.'));
    }

    setResult(r);
  };

  return (
    <div className="space-y-3">
      <Textarea
        className="min-h-[120px]"
        placeholder="Wklej tekst z dokumentu WZ — system wyciągnie nr WZ, odbiorcę, masę, adres..."
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <Button onClick={parse} disabled={!text.trim()} size="sm">Parsuj tekst</Button>

      {result && (
        <div className="space-y-2 pt-2 border-t">
          {([
            ['Nr WZ', result.numer_wz],
            ['Nr zamówienia', result.nr_zamowienia],
            ['Odbiorca', result.odbiorca],
            ['Adres', result.adres],
            ['Telefon', result.tel],
            ['Masa kg', result.masa_kg?.toString()],
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
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, uwagi: '',
  });

  const update = (field: keyof WZImportData, val: string | number) =>
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
