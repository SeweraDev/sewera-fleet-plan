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

// Dekoduje znaki PUA z PDF (generyczny: offset = Unicode codepoint)
function decodePUA(raw: string): string {
  const win1250: Record<number, string> = {
    0x80:'€',0x82:'‚',0x84:'„',0x85:'…',0x86:'†',0x87:'‡',
    0x89:'‰',0x8A:'Š',0x8B:'‹',0x8C:'Ś',0x8D:'Ť',0x8E:'Ž',0x8F:'Ź',
    0x91:'\u2018',0x92:'\u2019',0x93:'\u201C',0x94:'\u201D',
    0x95:'•',0x96:'–',0x97:'—',0x99:'™',
    0x9A:'š',0x9B:'›',0x9C:'ś',0x9D:'ť',0x9E:'ž',0x9F:'ź',
  };
  const bases = [0xE000, 0xF000, 0x10000];
  return Array.from(raw).map(ch => {
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

// Parser tekstu WZ v5 (identyczny z ModalImportWZ) — dla tekstu skopiowanego z PDF
function parseWzTextLocal(rawText: string): Partial<ParsePreview> {
  const text = decodePUA(rawText)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u024F\n\r\t]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\n\s*){3,}/g, '\n\n');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Nr WZ
  let numer_wz: string | undefined;
  const wzM = text.match(/WZ\s+([A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/);
  if (wzM) numer_wz = `WZ ${wzM[1]}`;
  else {
    const wzBare = text.match(/([A-Z]{2}\/\d{2,3}\/\d{2}\/\d{2}\/\d{5,})/);
    if (wzBare) numer_wz = `WZ ${wzBare[1]}`;
  }

  // Nr zamówienia
  let nr_zamowienia: string | undefined;
  const zamLabel = text.match(/Nr\s+zam(?:ówienia)?(?:\s*\(systemowy\))?[:\s\]]+([A-Z0-9\/]+)/i);
  if (zamLabel) nr_zamowienia = zamLabel[1];
  if (!nr_zamowienia) {
    const zamPattern = text.match(/([A-Z]{1,2}\d?\/[A-Z]{2}\/\d{4}\/\d{2}\/\d+)/);
    if (zamPattern) nr_zamowienia = zamPattern[1];
  }

  // Odbiorca — pomiń blok SEWERA
  let odbiorca: string | undefined;
  const SELLER_MARKERS = /SEWERA|KOŚCIUSZKI\s*326|NR\s*BDO:\s*000044503/i;
  const SKIP_PATTERNS = [
    SELLER_MARKERS, /ODDZIAŁ/i, /^ul\./i, /^al\./i, /^os\./i, /^pl\./i,
    /NIP:/i, /NR BDO:/i, /Adres\s+dostawy/i, /Waga\s+netto/i,
    /Nr\s+zam/i, /PALETA/i, /Tel\./i, /Os\.\s*kontaktowa/i,
    /^\d{2}-\d{3}/, /Katowice,\s*\d/, /Uwagi/i,
    /Budowa/i, /^\d+\s+(SZT|KG|M|OP|KPL)/i, /Magazyn/i,
    /^RAZEM/i, /Wystawił/i, /Na podstawie/i, /Nr oferty/i,
  ];
  let seweraIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SELLER_MARKERS.test(lines[i])) { seweraIdx = i; break; }
  }
  const searchStart = seweraIdx >= 0 ? seweraIdx + 1 : 0;
  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_PATTERNS.some(p => p.test(line))) continue;
    const hasLegalForm = /SPÓŁKA|SP\.\s*K|SP\.\s*Z|S\.A\.|Sp\.\s*z\s*o\.o\./i.test(line);
    const capsWords = line.split(/\s+/).filter(w => /^[A-ZĄĆĘŁŃÓŚŹŻ\-]{2,}$/.test(w)).length;
    if (hasLegalForm || capsWords >= 3) { odbiorca = line; break; }
  }

  // Adres dostawy
  let adres: string | undefined;
  const adresIdx = lines.findIndex(l => /^Adres\s+dostawy$/i.test(l));
  if (adresIdx >= 0) {
    const addrParts: string[] = [];
    for (let i = adresIdx + 1; i < lines.length && i <= adresIdx + 8; i++) {
      const l = lines[i];
      if (/^(Os\.\s*kontaktowa|Tel\.|Nr\s+zam|PALETA|Waga|Uwagi)/i.test(l)) break;
      if (/ul\.|al\.|os\.|pl\./i.test(l) || /\d{2}-\d{3}/.test(l) || addrParts.length > 0) {
        addrParts.push(l);
      }
    }
    if (addrParts.length) adres = addrParts.join(', ').replace(/,\s*,/g, ',');
  }
  if (!adres && odbiorca) {
    const odbIdx = lines.indexOf(odbiorca);
    if (odbIdx >= 0) {
      for (let i = odbIdx + 1; i < Math.min(odbIdx + 3, lines.length); i++) {
        if (/ul\.|al\.|os\.|pl\./i.test(lines[i]) || /\d{2}-\d{3}/.test(lines[i])) {
          adres = lines[i]; break;
        }
      }
    }
  }

  // Telefon
  let tel: string | undefined;
  if (adresIdx >= 0) {
    for (let i = adresIdx; i < Math.min(adresIdx + 10, lines.length); i++) {
      const telM = lines[i].match(/Tel\.?:?\s*([\d\s]{9,})/i);
      if (telM) { tel = telM[1].trim(); break; }
    }
  }

  // Masa — value after label OR on preceding line (PDF table layout)
  let masa_kg = 0;
  const wagaM = text.match(/Waga\s+netto\s+razem[:\s]*([\d\s,.]+)/i);
  if (wagaM && parseFloat(wagaM[1].replace(/\s/g, '').replace(',', '.')) > 0) {
    masa_kg = Math.ceil(parseFloat(wagaM[1].replace(/\s/g, '').replace(',', '.')) || 0);
  } else {
    const wagaIdx = lines.findIndex(l => /Waga\s+netto\s+razem/i.test(l));
    if (wagaIdx > 0) {
      const prevNum = lines[wagaIdx - 1].replace(/\s/g, '').match(/^([\d,.]+)$/);
      if (prevNum) masa_kg = Math.ceil(parseFloat(prevNum[1].replace(',', '.')) || 0);
    }
  }

  // Palety
  let ilosc_palet = 0;
  for (const line of lines) {
    if (/PALETA/i.test(line)) {
      const palQty = line.match(/(\d+)\s*(?:SZT|szt)/i);
      if (palQty) { ilosc_palet = parseInt(palQty[1]); break; }
    }
  }

  // Uwagi
  let uwagi: string | undefined;
  const uwagiIdx = lines.findIndex(l => /^Uwagi\s*:/i.test(l));
  if (uwagiIdx >= 0) {
    const afterLines: string[] = [];
    for (let i = uwagiIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/Na\s+podstawie\s+art/i.test(l)) break;
      if (/Nr\s+zam(?:ówienia)?\s*\(systemowy\)/i.test(l)) continue;
      if (/Nr\s+oferty/i.test(l)) continue;
      afterLines.push(l);
    }
    uwagi = afterLines.join('\n').trim() || undefined;
  }

  return { numer_wz, nr_zamowienia, odbiorca, adres, tel, masa_kg, ilosc_palet, uwagi };
}


function WzPasteTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [decodedPreview, setDecodedPreview] = useState<string>('');

  const hasPUA = Array.from(text).some(ch => { const cp = ch.codePointAt(0) ?? 0; return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0x10000; });

  const handleParse = async () => {
    if (text.length === 0) return;
    setParsing(true);
    setError(null);
    setPreview(null);

    const decoded = decodePUA(text);
    setDecodedPreview(decoded.slice(0, 200));
    console.log('[WzPasteTab v5] raw chars:', text.length, '| PUA:', hasPUA, '| decoded preview:', decoded.slice(0, 150));

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
          {hasPUA && (
            <p className="text-xs text-blue-600 dark:text-blue-400">🔑 Wykryto znaki PUA (font PDF) — zostaną zdekodowane</p>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={handleParse} disabled={text.length === 0 || parsing} size="sm">
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
