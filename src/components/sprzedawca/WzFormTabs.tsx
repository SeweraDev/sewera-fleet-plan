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

function WzPasteTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsePreview | null>(null);

  const handleParse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    setError(null);
    setPreview(null);

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
      if (json.error) {
        setError(json.error);
        return;
      }
      setPreview({
        numer_wz: json.nr_wz || '',
        nr_zamowienia: json.nr_zamowienia || '',
        odbiorca: json.odbiorca || '',
        adres: json.adres_dostawy || '',
        tel: json.osoba_kontaktowa || json.tel || '',
        masa_kg: json.masa_kg || 0,
        objetosc_m3: json.objetosc_m3 || 0,
        ilosc_palet: json.ilosc_palet || 0,
        uwagi: json.uwagi || '',
      });
    } catch (e) {
      setError('Błąd połączenia z serwerem parsowania.');
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
          <Button onClick={handleParse} disabled={!text.trim() || parsing} size="sm">
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
