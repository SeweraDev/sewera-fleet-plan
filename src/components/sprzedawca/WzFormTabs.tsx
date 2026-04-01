import { useState, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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

function WzOcrTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImage = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) { setError("Plik za duży (max 15 MB)"); return; }
    setParsing(true);
    setError(null);
    setPreview(null);
    setProgress(0);
    setProgressMsg("Ładowanie modelu OCR...");

    try {
      const TesseractModule = await import("tesseract.js");
      const { data: { text: ocrText } } = await TesseractModule.default.recognize(file, "pol", {
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

      setParsing(false);
      setProgress(100);

      if (!ocrText || ocrText.trim().length < 20) {
        setError("Nie udało się rozpoznać tekstu ze zdjęcia. Spróbuj lepsze zdjęcie lub wklej tekst ręcznie.");
        return;
      }

      const cleaned = cleanOcrText(ocrText);
      console.log("[WzOcrTab] cleaned text:\n", cleaned.substring(0, 500));
      const local = parseWzTextLocal(cleaned);

      // ─── OCR-specific: ekstrakcja odbiorcy ───
      const SEWERA_BLOCK = /SEWERA|KO[SŚ]CIUSZKI\s*326|000044503|NR\s*BDO|SIEMIANOWICE/i;
      let ocrOdbiorca = local.odbiorca || '';
      // Odrzuć jeśli to dane SEWERY
      if (ocrOdbiorca && SEWERA_BLOCK.test(ocrOdbiorca)) ocrOdbiorca = '';

      // Strategia 1: szukaj "Odbiorca" w tekście → zbierz blok tekstu po nim
      if (!ocrOdbiorca) {
        const cLines = cleaned.split(/\n/).map(l => l.trim()).filter(Boolean);
        const odbLineIdx = cLines.findIndex(l => /Odbiorca/i.test(l));
        if (odbLineIdx >= 0) {
          const nameParts: string[] = [];
          for (let i = odbLineIdx + 1; i < Math.min(odbLineIdx + 8, cLines.length); i++) {
            const l = cLines[i];
            if (/^ul\.|^al\.|^os\.|^pl\.|^\d{2}-\d{3}|^Nr\s*ewid|^NIP/i.test(l)) break;
            if (SEWERA_BLOCK.test(l)) continue;
            if (l.length < 3) continue;
            nameParts.push(l);
          }
          if (nameParts.length) ocrOdbiorca = nameParts.join(' ').trim();
        }
      }

      // Strategia 2: szukaj linii z SPÓŁKA/KOMANDYTOWA (nie SEWERA)
      if (!ocrOdbiorca) {
        const cLines = cleaned.split(/\n/).map(l => l.trim()).filter(Boolean);
        for (const l of cLines) {
          if (/SPÓŁKA|SP\.\s*(?:Z|K)|KOMANDYT|S\.A\.?\s*$/i.test(l) && !SEWERA_BLOCK.test(l)) {
            ocrOdbiorca = l; break;
          }
        }
        // Jeśli znaleziono linię z formą prawną, zbierz też linię przed nią (początek nazwy)
        if (ocrOdbiorca) {
          const idx = cLines.findIndex(l => l === ocrOdbiorca);
          if (idx > 0) {
            const prev = cLines[idx - 1];
            // Dodaj poprzednią linię jeśli wygląda na nazwę firmy (nie marker)
            if (prev.length >= 3 && !/^ul\.|^al\.|^\d{2}-\d{3}|^NIP|^Nr\s*ewid|Odbiorca|Sprzedawca|Nabywca/i.test(prev) && !SEWERA_BLOCK.test(prev)) {
              ocrOdbiorca = `${prev} ${ocrOdbiorca}`;
            }
          }
        }
      }

      // Strategia 3: regex na formę prawną w ciągłym tekście (nie SEWERA)
      if (!ocrOdbiorca) {
        const firmRegex = /([A-ZĄĆĘŁŃÓŚŹŻ][A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ\s.\-&]{3,}(?:SPÓŁKA|KOMANDYT|SP\.\s*(?:Z\s*O\.O\.|K)|S\.A\.?|S\.C\.)[A-Za-ząćęłńóśźż\s]*)/gi;
        let firmM;
        while ((firmM = firmRegex.exec(cleaned)) !== null) {
          const candidate = firmM[1].trim();
          if (!SEWERA_BLOCK.test(candidate)) { ocrOdbiorca = candidate; break; }
        }
      }

      // Cleanup: usuń trailing krótkie śmieci z OCR
      if (ocrOdbiorca) {
        ocrOdbiorca = ocrOdbiorca.replace(/\s+[a-zA-Z]{1}$/,'').trim();
      }

      // Ekstrakcja os. kontaktowa z pełnego tekstu (OCR często ma to w jednej linii z adresem)
      let osKontaktowa = '';
      const kontaktM = cleaned.match(/(?:Os\.?\s*kontaktowa|kontaktowa)\s*:?\s*([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)/i);
      if (kontaktM) osKontaktowa = kontaktM[1].trim();
      // Fallback: szukaj "Imię Nazwisko tel. XXX"
      if (!osKontaktowa) {
        const nametelM = cleaned.match(/([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)\s+tel\.?\s*([\d\s\-]{9,})/i);
        if (nametelM) osKontaktowa = nametelM[1].trim();
      }

      // Lepszy tel z cleaned text jeśli parser nie znalazł
      let tel = local.tel || '';
      if (!tel) {
        const telM = cleaned.match(/tel\.?\s*:?\s*([\d][\d\s\-]{7,}[\d])/i);
        if (telM) tel = telM[1].replace(/\s+/g, '').replace(/-/g, '');
      }

      setPreview({
        numer_wz: local.numer_wz || '',
        nr_zamowienia: local.nr_zamowienia || '',
        odbiorca: ocrOdbiorca || '',
        adres: local.adres || '',
        tel: osKontaktowa ? `${osKontaktowa}, tel. ${tel}` : tel,
        masa_kg: local.masa_kg || 0,
        objetosc_m3: 0,
        ilosc_palet: local.ilosc_palet || 0,
        uwagi: local.uwagi || '',
      });
    } catch (e: any) {
      setParsing(false);
      setError("Błąd OCR: " + (e.message || "nieznany"));
    }
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
    setPreview(null);
  };

  return (
    <div className="space-y-3 pt-2">
      {!preview && !parsing && (
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
              <p className="text-xs text-muted-foreground mt-1">Aparat telefonu</p>
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
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG, HEIC</p>
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
                      setPreview(prev => prev ? { ...prev, [f.key]: f.type === 'number' ? (Number(raw) || 0) : raw } : prev);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm}>Użyj tych danych</Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>Nowe zdjęcie</Button>
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

// Dekoduje znaki PUA z PDF (generyczny: offset = Unicode codepoint)
function decodePUA(raw: string): string {
  const win1250: Record<number, string> = {
    0x80:'€',0x82:'‚',0x84:'„',0x85:'…',0x86:'†',0x87:'‡',
    0x89:'‰',0x8A:'Š',0x8B:'‹',0x8C:'Ś',0x8D:'Ť',0x8E:'Ž',0x8F:'Ź',
    0x91:'\u2018',0x92:'\u2019',0x93:'\u201C',0x94:'\u201D',
    0x95:'•',0x96:'–',0x97:'—',0x99:'™',
    0x9A:'š',0x9B:'›',0x9C:'ś',0x9D:'ť',0x9E:'ž',0x9F:'ź',
  };
  const bases = [0xE000, 0xF000, 0x10000, 0x100000];
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

  // Nr WZ — ONLY match WZ, WZS, or PZ prefixed document numbers
  let numer_wz: string | undefined;
  const wzM = text.match(/(WZS?|PZ)\s+([A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/);
  if (wzM) numer_wz = `${wzM[1]} ${wzM[2]}`;

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
    /^\d{2}-\d{3}/, /Katowice,\s*\d/, /Uwagi/i, /kontaktowa/i,
    /Budowa/i, /^\d+\s+(SZT|KG|M|OP|KPL)/i, /Magazyn/i,
    /^RAZEM/i, /Wystawił/i, /Na podstawie/i, /Nr oferty/i,
    /^\d+\.\s/, /Lp\./, /Kod\s+towaru/i, /Kod\s+EAN/i, /Nazwa\s+towaru/i,
    /Termin\s+zap/i, /Wydano\s+na/i, /Informacje/i, /^Cena\s/i, /^Netto$/i,
  ];
  let seweraIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SELLER_MARKERS.test(lines[i])) { seweraIdx = i; break; }
  }
  const searchStart = seweraIdx >= 0 ? seweraIdx + 1 : 0;
  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_PATTERNS.some(p => p.test(line))) continue;
    if (/\(.*(?:SPÓŁKA|SP\.|S\.A\.|S\.C\.)/i.test(line)) continue;
    if (/^[A-Z]{1,3}-\d/.test(line)) continue;
    const hasLegalForm = /SPÓŁKA|SP\.\s*K|SP\.\s*Z|S\.A\.?|S\.C\.|Sp\.\s*z\s*o\.o\.|KOMANDYT/i.test(line);
    const capsWords = line.split(/\s+/).filter(w => /^[A-ZĄĆĘŁŃÓŚŹŻ\-]{2,}$/.test(w)).length;
    const hasInitials = /\b[A-Z]\.[A-Z]\.?\b/.test(line);
    const allCapsName = line.split(/\s+/).filter(w => /^[A-ZĄĆĘŁŃÓŚŹŻ][A-Za-ząćęłńóśźż.\-]{1,}$/.test(w)).length >= 2;
    // OCR guard: odrzuć kandydatów z dużą ilością znaków specjalnych (garbage)
    const specialChars = (line.match(/[):;=\[\]{}|]/g) || []).length;
    if (specialChars >= 2) continue;
    // OCR guard: odrzuć jeśli >50% słów to 1-2 znaki (śmieci OCR)
    const words = line.split(/\s+/).filter(Boolean);
    const shortWords = words.filter(w => w.length <= 2 && !/^(i|w|z|o|u|sp|SA|ul|al|os|II|ZB)$/i.test(w)).length;
    if (words.length > 0 && shortWords / words.length > 0.4) continue;
    if (hasLegalForm || capsWords >= 3 || (hasInitials && allCapsName)) { odbiorca = line; break; }
  }

  // Adres dostawy
  // Adres dostawy — ONLY when document has explicit "Adres dostawy" or "Budowa" section
  let adres: string | undefined;
  const adresIdx = lines.findIndex(l => /Adres\s+dostawy/i.test(l));
  const hasBudowa = lines.some(l => /^Budowa/i.test(l));
  const hasDeliverySection = adresIdx >= 0 || hasBudowa;

  if (hasDeliverySection) {
    if (adresIdx >= 0) {
      const addrParts: string[] = [];
      for (let i = adresIdx + 1; i < lines.length && i <= adresIdx + 8; i++) {
        const l = lines[i];
        if (/^(Os\.\s*kontaktowa|Tel\.|Nr\s+zam|PALETA|Waga|Uwagi|Termin|Wydano|Lp\.)/i.test(l)) break;
        if (/^Budowa/i.test(l) || /ul\.|al\.|os\.|pl\./i.test(l) || /\d{2}-\d{3}/.test(l) || addrParts.length > 0) {
          addrParts.push(l);
        }
      }
      if (addrParts.length) adres = addrParts.join(', ').replace(/,\s*,/g, ',');
    }
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
    if (!adres && hasBudowa) {
      const budowaIdx = lines.findIndex(l => /^Budowa/i.test(l));
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
    // Guard: if adres duplicates odbiorca address, clear it
    if (adres && odbiorca && odbiorca.includes(adres)) {
      adres = undefined;
    }
  }
  // Fallback adres: szukaj wzorca "ul./al./os. + nazwa + numer ... kod-pocztowy miasto" w pełnym tekście
  if (!adres) {
    // Elastyczny regex — OCR może wstawiać śmieci między częściami adresu
    const addrRegex = /(?:ul\.|al\.|os\.|pl\.)\s*[A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s.]+?\d+[a-zA-Z]?[\s\S]{0,30}?(\d{2}-\d{3}\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)/;
    const addrM = text.match(addrRegex);
    if (addrM) {
      // Wyciągnij ul. + numer i kod + miasto osobno, połącz czysto
      const streetM = text.match(/((?:ul\.|al\.|os\.|pl\.)\s*[A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s.]+?\d+[a-zA-Z]?)/);
      const cityPart = addrM[1]; // np. "41-200 Sosnowiec"
      if (streetM) {
        adres = `${streetM[1].trim()}, ${cityPart.trim()}`;
      } else {
        adres = cityPart.trim();
      }
    }
  }
  if (adres && odbiorca && odbiorca.includes(adres)) {
    adres = undefined;
  }

  // Telefon
  let tel: string | undefined;
  const wystawilIdx = lines.findIndex(l => /Wystawił/i.test(l));
  const budowaIdx = lines.findIndex(l => /^Budowa/i.test(l));
  const deliveryAnchor = Math.max(budowaIdx, adresIdx >= 0 ? adresIdx : 0);
  if (deliveryAnchor >= 0) {
    for (let i = deliveryAnchor - 1; i >= Math.max(0, deliveryAnchor - 6); i--) {
      if (/NIP:|NR BDO:|SEWERA|ODDZIAŁ|Nr\s+ewid/i.test(lines[i])) break;
      const telM = lines[i].match(/Tel\.?:?\s*([\d\s\-]{9,})/i);
      if (telM) { tel = telM[1].trim(); break; }
    }
    if (!tel) {
      const telEndIdx = lines.findIndex((l, i) => i > deliveryAnchor && /Nr\s+zam|Uwagi|PALETA|Waga|Lp\./i.test(l));
      const effectiveEnd = Math.min(
        telEndIdx >= 0 ? telEndIdx : deliveryAnchor + 10,
        wystawilIdx >= 0 ? wystawilIdx : lines.length
      );
      for (let i = deliveryAnchor; i < effectiveEnd && i < lines.length; i++) {
        const telM = lines[i].match(/Tel\.?:?\s*([\d\s\-]{9,})/i);
        if (telM) { tel = telM[1].trim(); break; }
      }
    }
  }

  // Masa — last standalone number before "RAZEM:" line
  let masa_kg = 0;
  const razemIdx = lines.findIndex(l => /^RAZEM/i.test(l));
  if (razemIdx > 0) {
    for (let i = razemIdx - 1; i >= Math.max(0, razemIdx - 5); i--) {
      const s = lines[i].replace(/\s/g, '');
      const m = s.match(/^([\d,.]+)$/);
      if (m) { masa_kg = Math.ceil(parseFloat(m[1].replace(',', '.'))); break; }
    }
  }
  if (masa_kg === 0) {
    const wagaM = text.match(/Waga\s+netto\s+razem[:\s]*([\d]+[\d,.]*)/i);
    if (wagaM) masa_kg = Math.ceil(parseFloat(wagaM[1].replace(',', '.')) || 0);
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
  const uwagiIdx = lines.findIndex(l => /^Uwagi(?:\s+dot\.\s+wysy[łl]ki)?\s*:/i.test(l));
  if (uwagiIdx >= 0) {
    const afterLines: string[] = [];
    for (let i = uwagiIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/Na\s+podstawie\s+art|^Wystawił/i.test(l)) break;
      if (/Nr\s+zam(?:ówienia)?\s*\(systemowy\)/i.test(l)) continue;
      if (/Nr\s+oferty/i.test(l)) continue;
      afterLines.push(l);
    }
    uwagi = afterLines.join('\n').trim() || undefined;
  }

  // ─── Post-processing: obcięcie adresu z artefaktów OCR ───
  if (adres) {
    // OCR często łączy kolumny tabeli w jedną linię — obetnij przy znanych markerach
    const cutMarkers = [/kontaktowa/i, /Kod\s*towaru/i, /Nazwa\s*towaru/i, /AE\s/i, /mp\s/i, /Ilo[sś][cć]/i, /Cena/i, /Netto/i, /wz\s/i];
    for (const marker of cutMarkers) {
      const cutIdx = adres.search(marker);
      if (cutIdx > 10) { adres = adres.substring(0, cutIdx).replace(/[,\s]+$/, ''); break; }
    }
    // Usuń izolowane 1-2 znakowe artefakty OCR (zj, R, S, itp.) ale zachowaj numery i skróty adresowe
    // Wzorzec: po kodzie pocztowym i mieście obetnij resztę
    const pcMatch = adres.match(/(\d{2}-\d{3}\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźżA-Z]+)/);
    if (pcMatch) {
      const pcEnd = adres.indexOf(pcMatch[1]) + pcMatch[1].length;
      adres = adres.substring(0, pcEnd).trim();
    } else {
      // Fallback: usuń końcowe krótkie śmieci
      adres = adres.replace(/[,\s]+[a-zA-Z]{1,2}$/, '').trim();
    }
    // Usuń izolowane krótkie słowa pomiędzy częściami adresu (OCR artefakty jak "zj R")
    adres = adres.replace(/,\s*[a-zA-Z]{1,2}\s+[A-Z]{1}\s+(?=\d{2}-\d{3})/, ', ');
    adres = adres.replace(/\s+[a-z]{1,2}\s+[A-Z]{1}\s+/, ' ');
  }

  // ─── Fallback odbiorca z regex (OCR garble) ───
  if (!odbiorca) {
    // Szukaj firmy z formą prawną w pełnym tekście
    const firmM = text.match(/([A-ZĄĆĘŁŃÓŚŹŻ][A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ\s\.\-&]{3,}(?:SP\.\s*Z\s*O\.O\.|SPÓŁKA|SP\.\s*K|S\.A\.?|S\.C\.))/i);
    if (firmM) odbiorca = firmM[1].trim();
  }

  // ─── Fallback tel z pełnego tekstu ───
  if (!tel) {
    const telM = text.match(/(?:tel\.?|Tel\.?)\s*:?\s*([\d][\d\s\-]{7,}[\d])/i);
    if (telM) tel = telM[1].replace(/\s+/g, '');
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

        <TabsContent value="ocr"><WzOcrTab wzList={wzList} setWzList={setWzList} /></TabsContent>
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
