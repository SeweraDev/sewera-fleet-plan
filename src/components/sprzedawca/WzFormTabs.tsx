import { useState, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WzInput } from '@/hooks/useCreateZlecenie';

interface WzFormTabsProps {
  wzList: WzInput[];
  setWzList: (wz: WzInput[]) => void;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

function parseWzText(text: string): Partial<WzInput> {
  const result: Partial<WzInput> = {};

  // nr WZ
  const wzMatch = text.match(/(?:WZ[:\s]*)([\w\-\/]+)/i);
  if (wzMatch) result.numer_wz = wzMatch[1].trim();

  // nr zamówienia
  const zamMatch = text.match(/(?:T7[\/:]\s*\S+|ZAM[:\s]*)([\w\-\/]+)/i);
  if (zamMatch) result.nr_zamowienia = zamMatch[1].trim();
  if (!zamMatch) {
    const t7Match = text.match(/(T7\/[\w\-\/]+)/i);
    if (t7Match) result.nr_zamowienia = t7Match[1].trim();
  }

  // masa
  const masaMatch = text.match(/([\d.,]+)\s*kg/i);
  if (masaMatch) result.masa_kg = parseFloat(masaMatch[1].replace(',', '.'));

  // adres
  const adresMatch = text.match(/(?:ul\.|al\.|os\.)\s*(.+?)(?:\n|$)/i);
  if (adresMatch) result.adres = adresMatch[0].trim();

  // odbiorca
  const odbMatch = text.match(/(?:Odbiorca|Nabywca)[:\s]+(.+?)(?:\n|$)/i);
  if (odbMatch) result.odbiorca = odbMatch[1].trim();

  return result;
}

function WzManualForm({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const addWz = () => setWzList([...wzList, {
    numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, uwagi: '',
  }]);

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
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) setFileName(f.name);
          }}
        />
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

function WzPasteTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const [text, setText] = useState('');

  const handleImport = () => {
    if (!text.trim()) return;
    const parsed = parseWzText(text);
    const newWz: WzInput = {
      numer_wz: parsed.numer_wz || '',
      nr_zamowienia: parsed.nr_zamowienia || '',
      odbiorca: parsed.odbiorca || '',
      adres: parsed.adres || '',
      tel: '',
      masa_kg: parsed.masa_kg || 0,
      objetosc_m3: 0,
      uwagi: '',
    };
    // Replace first empty WZ or append
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList([newWz]);
    } else {
      setWzList([...wzList, newWz]);
    }
    setText('');
  };

  return (
    <div className="space-y-3">
      <Textarea
        className="min-h-[120px]"
        placeholder="Wklej tekst z dokumentu WZ — system wyciągnie nr WZ, odbiorcę, masę, adres"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <Button onClick={handleImport} disabled={!text.trim()} size="sm">Importuj</Button>
    </div>
  );
}

export function WzFormTabs({ wzList, setWzList, error, submitting, onBack, onSubmit }: WzFormTabsProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-foreground">Pozycje WZ ({wzList.length})</h3>

      <Tabs defaultValue="reczne">
        <TabsList className="w-full">
          <TabsTrigger value="ocr" className="flex-1 text-xs">📷 Zdjęcie (OCR)</TabsTrigger>
          <TabsTrigger value="paste" className="flex-1 text-xs">📋 Wklej tekst</TabsTrigger>
          <TabsTrigger value="reczne" className="flex-1 text-xs">✏️ Ręcznie</TabsTrigger>
        </TabsList>

        <TabsContent value="ocr">
          <WzOcrTab />
        </TabsContent>

        <TabsContent value="paste">
          <WzPasteTab wzList={wzList} setWzList={setWzList} />
        </TabsContent>

        <TabsContent value="reczne">
          <WzManualForm wzList={wzList} setWzList={setWzList} />
        </TabsContent>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>← Wstecz</Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? 'Wysyłanie...' : 'Złóż zlecenie'}
        </Button>
      </div>
    </div>
  );
}
