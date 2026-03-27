import { useState, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WzInput } from '@/hooks/useCreateZlecenie';
import { supabase } from '@/integrations/supabase/client';

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
            <div><Label className="text-xs">Objętość (m³)</Label><Input className="h-8 text-sm" type="number" value={wz.objetosc_m3 || ''} onChange={e => updateWz(idx, 'objetosc_m3', Number(e.target.value))} /></div>
            <div><Label className="text-xs">Palety (szt)</Label><Input className="h-8 text-sm" type="number" min={0} placeholder="0" value={wz.ilosc_palet || ''} onChange={e => updateWz(idx, 'ilosc_palet', Number(e.target.value))} /></div>
            <div className="col-span-2"><Label className="text-xs">Uwagi</Label><Input className="h-8 text-sm" value={wz.uwagi || ''} onChange={e => updateWz(idx, 'uwagi', e.target.value)} /></div>
          </div>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={addWz}>+ Dodaj WZ</Button>
    </div>
  );
}

function WzOcrTab() {
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <div
        className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setFileName(f.name); }} />
        <p className="text-sm font-medium text-muted-foreground">📷 Wgraj zdjęcie WZ</p>
      </div>
      {fileName && (
        <div className="text-sm space-y-1">
          <p className="text-foreground">Plik: <span className="font-mono">{fileName}</span></p>
          <p className="text-muted-foreground italic">Analiza zdjęcia — funkcja OCR w przygotowaniu</p>
        </div>
      )}
    </div>
  );
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

// Lokalny parser dla tekstu skopiowanego z PDF — elastyczne regexy
function parseWzTextLocal(raw: string): Partial<ParsePreview> {
  // Usuń znaki PUA (te same zakresy co decodePUA w edge function)
  const text = raw
    .split('')
    .map(ch => {
      const cp = ch.codePointAt(0) ?? 0;
      return (cp >= 0xe000 && cp <= 0xf8ff) ? ' ' : ch;
    })
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\n\s*){3,}/g, '\n\n');

  const result: Partial<ParsePreview> = {};

  // Nr WZ / WZS
  const wzM = text.match(/\b(WZS?\s+[A-Z]{2,3}\/[\d\/]+)/);
  if (wzM) result.numer_wz = wzM[1].replace(/\s+/g, ' ').trim();

  // Nr PZ
  if (!result.numer_wz) {
    const pzM = text.match(/Potwierdzenie zamówienia[\s\S]{0,60}?nr:\s*([A-Z0-9\/]+)/i);
    if (pzM) result.numer_wz = pzM[1].trim();
  }

  // Nr zamówienia systemowy
  const zamM = text.match(/Nr\s+zamówienia\s*\(systemowy\)[:\s]+([A-Z0-9\/]+)/i);
  if (zamM) result.nr_zamowienia = zamM[1].trim();

  // Nr zam w nawiasie
  if (!result.nr_zamowienia) {
    const nagM = text.match(/\[Nr\s+zam[.:\s]+([A-Z0-9\/]+)\]/i);
    if (nagM) result.nr_zamowienia = nagM[1].trim();
  }

  // Numer zamówienia T7/R7/etc w tekście
  if (!result.nr_zamowienia) {
    const t7M = text.match(/\b([A-Z]\d\/[A-Z]{2}\/\d{4}\/\d{2}\/\d+)/);
    if (t7M) result.nr_zamowienia = t7M[1].trim();
  }

  // Masa — szukaj "Waga netto razem:" lub liczby z kg
  const wagaM = text.match(/Waga\s+netto\s+razem[:\s]+([\d\s.,]+)/i);
  if (wagaM) {
    const n = parseFloat(wagaM[1].replace(/\s/g, '').replace(',', '.'));
    if (n > 0) result.masa_kg = Math.ceil(n);
  }
  if (!result.masa_kg) {
    const kgM = text.match(/([\d.,]+)\s*kg/i);
    if (kgM) {
      const n = parseFloat(kgM[1].replace(',', '.'));
      if (n > 0) result.masa_kg = Math.ceil(n);
    }
  }

  // Odbiorca / Nabywca
  const nabM = text.match(/(?:Nabywca|Odbiorca)[:\s]+([^\n]{3,80})/i);
  if (nabM) result.odbiorca = nabM[1].trim();

  // Firma rozpoznana po typowych końcówkach prawnych (jeśli brak Nabywca/Odbiorca)
  if (!result.odbiorca) {
    const firmaM = text.match(/([A-ZŁŚĆĄĘÓŹŻ][^\n]{3,60}(?:Sp\.\s*z\s*o\.o\.|S\.A\.|Sp\.K\.|SPÓŁKA|Sp\. j\.))/i);
    if (firmaM) result.odbiorca = firmaM[1].trim();
  }

  // Adres — ul./al. + kod pocztowy
  const ulM = text.match(/((?:ul\.|al\.|os\.)[^\n,]{3,60})/i);
  const kodM = text.match(/(\d{2}-\d{3}\s+[A-ZŁŚĆĄ][^\n,]{2,40})/);
  if (ulM && kodM) {
    result.adres = `${ulM[1].trim()}, ${kodM[1].trim()}`;
  } else if (ulM) {
    result.adres = ulM[1].trim();
  }

  // Telefon / Osoba kontaktowa
  const kontaktM = text.match(/(?:Os\.?\s*kontaktowa|Tel\.?)[:\s]+([^\n]{3,60})/i);
  if (kontaktM) result.tel = kontaktM[1].trim();
  if (!result.tel) {
    const telM = text.match(/\b(\d{3}[\s-]\d{3}[\s-]\d{3}|\d{9,11})\b/);
    if (telM) result.tel = telM[1].trim();
  }

  // Uwagi
  const uwagiM = text.match(/Uwagi[^:\n]*:\s*\n([\s\S]{1,300}?)(?:\nNr zamówienia|$)/i);
  if (uwagiM) result.uwagi = uwagiM[1].trim();

  return result;
}


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

    // Zawsze uruchom lokalny parser jako bazę
    const local = parseWzTextLocal(text);
    const localPreview: ParsePreview = {
      numer_wz: local.numer_wz || '',
      nr_zamowienia: local.nr_zamowienia || '',
      odbiorca: local.odbiorca || '',
      adres: local.adres || '',
      tel: local.tel || '',
      masa_kg: local.masa_kg || 0,
      objetosc_m3: 0,
      ilosc_palet: local.ilosc_palet || 0,
      uwagi: local.uwagi || '',
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-wz-pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ text }),
        }
      );
      const json = await res.json();

      if (!json.error) {
        const edgePreview: ParsePreview = {
          numer_wz: json.nr_wz || '',
          nr_zamowienia: json.nr_zamowienia || '',
          odbiorca: json.odbiorca || '',
          adres: json.adres_dostawy || '',
          tel: json.osoba_kontaktowa || json.tel || '',
          masa_kg: json.masa_kg || 0,
          objetosc_m3: json.objetosc_m3 || 0,
          ilosc_palet: json.ilosc_palet || 0,
          uwagi: json.uwagi || '',
        };

        // Użyj edge jeśli dała więcej danych, w przeciwnym razie lokalny jako fallback
        const merged: ParsePreview = {
          numer_wz: edgePreview.numer_wz || localPreview.numer_wz,
          nr_zamowienia: edgePreview.nr_zamowienia || localPreview.nr_zamowienia,
          odbiorca: edgePreview.odbiorca || localPreview.odbiorca,
          adres: edgePreview.adres || localPreview.adres,
          tel: edgePreview.tel || localPreview.tel,
          masa_kg: edgePreview.masa_kg || localPreview.masa_kg,
          objetosc_m3: edgePreview.objetosc_m3 || localPreview.objetosc_m3,
          ilosc_palet: edgePreview.ilosc_palet || localPreview.ilosc_palet,
          uwagi: edgePreview.uwagi || localPreview.uwagi,
        };
        setPreview(merged);
      } else {
        // Edge function zwróciła błąd — użyj lokalnego parsera
        setPreview(localPreview);
      }
    } catch {
      // Brak połączenia — użyj lokalnego parsera
      setPreview(localPreview);
    } finally {
      setParsing(false);
    }
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
          <Button onClick={handleParse} disabled={text.length === 0 || parsing} size="sm">
            {parsing ? 'Analizuję...' : 'Importuj'}
          </Button>
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
          <TabsTrigger value="ocr" className="flex-1 text-xs">📷 Zdjęcie (OCR)</TabsTrigger>
          <TabsTrigger value="paste" className="flex-1 text-xs">📋 Wklej tekst</TabsTrigger>
          <TabsTrigger value="reczne" className="flex-1 text-xs">✏️ Ręcznie</TabsTrigger>
        </TabsList>

        <TabsContent value="ocr"><WzOcrTab /></TabsContent>
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
