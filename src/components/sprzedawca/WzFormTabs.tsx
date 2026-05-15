import { useState, useRef, useCallback, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { WzInput } from '@/hooks/useCreateZlecenie';
import { KLASYFIKACJE, klasyfikacjaZTypu, formatKlasyfikacjaLong, sugerujKlasyfikacjeWg } from '@/lib/klasyfikacje';
import { cn } from '@/lib/utils';
import { SnipLiveOverlay } from '@/components/shared/SnipLiveOverlay';
import { wyliczObjetoscZPozycji, klasyfikujWZAsync } from '@/lib/wzAutoFill';

interface WzFormTabsProps {
  wzList: WzInput[];
  setWzList: (wz: WzInput[]) => void;
  error: string | null;
  submitting: boolean;
  /** Opcjonalne — gdy ten widok jest pierwszym krokiem (po refactorze 13.05),
   *  przycisk "Wstecz" jest ukryty. */
  onBack?: () => void;
  onSubmit: () => void;
  /** Typ pojazdu wybrany w kroku 2 (TypPojazduStep). Gdy konkretny typ —
   *  klasyfikacja jest auto-ustawiana z tego typu i ukrywana w UI.
   *  Gdy 'bez_preferencji' lub puste — klasyfikacja wymagana ręcznie. */
  typPojazdu?: string;
  /** Tryb bulk: każdy PDF = osobne zlecenie (pomija krok 4 dostępności).
   *  Zdefiniowane → tab "Wiele PDF" jest dostępny. */
  onBulkSubmit?: (wzListPerZlecenie: WzInput[][]) => Promise<void>;
  bulkSubmitting?: boolean;
  /** Callback wywoływany po imporcie z PDF/OCR/Paste — przekazuje pierwsze
   *  zaimportowane WZ. Parent używa do:
   *   - detekcji oddziału (wyciagnijOddzialZNumeru z numer_wz/nr_zamowienia)
   *   - wyciągania daty dostawy z uwag ("transport DD.MM.YYYY")
   *  Sesja 13.05.2026 — Smart Prefill faza 1. */
  onWzImported?: (wz: WzInput) => void;
}


/**
 * Łączy osobę kontaktową z numerem(-ami) telefonu, deduplikując numery które
 * już występują w stringu osoby (osoba_kontaktowa parser zwraca format
 * "Adrian Mróz tel. 697 002 147" — tel parser zwraca "697 002 147" — bez
 * dedupu wychodzi "Adrian Mróz tel. 697 002 147, tel. 697 002 147").
 *
 * Porównanie po samych cyfrach (różne formatowania tego samego numeru).
 */
function combineKontaktTel(osoba: string | null | undefined, tel: string | null | undefined): string {
  const o = (osoba || '').trim();
  const t = (tel || '').trim();
  if (!o) return t;
  if (!t) return o;
  // Wyciągnij cyfry obecne w osoba_kontaktowa (znormalizowane)
  const osobaDigits = o.replace(/[^\d]/g, '');
  // Rozdziel kandydatów telefonu po przecinku/średniku/spacji
  const candidates = t.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const newOnes: string[] = [];
  for (const cand of candidates) {
    const digits = cand.replace(/[^\d]/g, '');
    if (digits.length < 7) continue; // za krótkie żeby było telefonem
    if (osobaDigits.includes(digits)) continue; // już obecny w osoba
    newOnes.push(cand);
  }
  if (newOnes.length === 0) return o;
  return `${o}, tel. ${newOnes.join(', ')}`;
}

const EMPTY_WZ: WzInput = {
  numer_wz: '', nr_zamowienia: '', odbiorca: '', adres: '', tel: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0, bez_palet: false, luzne_karton: false, uwagi: '', klasyfikacja: '', wartosc_netto: null,
};

function WzManualForm({ wzList, setWzList, autoKlasyfikacja }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void; autoKlasyfikacja?: string | null }) {
  const addWz = () => setWzList([...wzList, { ...EMPTY_WZ }]);

  // Pola dotknięte przez user'a (per WZ) — pomarańczowa ramka znika po edycji.
  // Klucz: `${idx}:${field}` (np. "0:odbiorca"). Jeśli pole jest zawarte → user dotknął.
  // Pola w wzList które są NIE-puste i NIE-dotknięte = pre-fill z importu → pomarańczowa ramka.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const markTouched = (idx: number, field: string) => {
    const key = `${idx}:${field}`;
    setTouched(prev => prev.has(key) ? prev : new Set(prev).add(key));
  };
  // Sprawdź czy formularz wyświetla dane "z importu" (heurystyka: pierwszy WZ ma odbiorcę = pewnie po imporcie)
  const isPreFilled = wzList.length > 0 && !!wzList[0].odbiorca;

  const updateWz = (idx: number, field: keyof WzInput, value: string | number | boolean) => {
    const copy = [...wzList];
    (copy[idx] as any)[field] = value;
    setWzList(copy);
    markTouched(idx, field);
  };

  // Pomocnik: zwraca klasę CSS dla pola — pomarańczowy jeśli pre-fill i nie-dotknięty
  const fieldClass = (idx: number, field: string, hasValue: boolean): string => {
    if (!isPreFilled || !hasValue || touched.has(`${idx}:${field}`)) return '';
    return 'border-orange-400 bg-orange-50 dark:bg-orange-950/20 focus-visible:ring-orange-400';
  };

  const removeWz = (idx: number) => {
    if (wzList.length <= 1) return;
    setWzList(wzList.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {isPreFilled && (
        <div className="rounded-md border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-3 py-2 text-xs text-orange-900 dark:text-orange-100">
          🟠 Dane wstępnie wypełnione z importu — <strong>zweryfikuj każde pole</strong> przed zatwierdzeniem. Pomarańczowa ramka znika po edycji.
        </div>
      )}
      {wzList.map((wz, idx) => (
        <Card key={idx} className="p-3 space-y-2 bg-muted/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">WZ #{idx + 1}</span>
            {wzList.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => removeWz(idx)} className="text-destructive h-6 text-xs">Usuń</Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Nr WZ</Label><Input className={cn('h-8 text-sm', fieldClass(idx, 'numer_wz', !!wz.numer_wz))} value={wz.numer_wz || ''} onChange={e => updateWz(idx, 'numer_wz', e.target.value)} /></div>
            <div><Label className="text-xs">Nr zamówienia</Label><Input className={cn('h-8 text-sm', fieldClass(idx, 'nr_zamowienia', !!wz.nr_zamowienia))} value={wz.nr_zamowienia || ''} onChange={e => updateWz(idx, 'nr_zamowienia', e.target.value)} /></div>
            <div><Label className="text-xs">Odbiorca *</Label><Input className={cn('h-8 text-sm', fieldClass(idx, 'odbiorca', !!wz.odbiorca))} value={wz.odbiorca} onChange={e => updateWz(idx, 'odbiorca', e.target.value)} /></div>
            <div><Label className="text-xs">Adres *</Label><Input className={cn('h-8 text-sm', fieldClass(idx, 'adres', !!wz.adres))} value={wz.adres} onChange={e => updateWz(idx, 'adres', e.target.value)} /></div>
            <div><Label className="text-xs">Telefon</Label><Input className={cn('h-8 text-sm', fieldClass(idx, 'tel', !!wz.tel))} value={wz.tel || ''} onChange={e => updateWz(idx, 'tel', e.target.value)} /></div>
            <div><Label className="text-xs">Masa (kg) *</Label><Input className={cn('h-8 text-sm', fieldClass(idx, 'masa_kg', !!wz.masa_kg))} type="number" value={wz.masa_kg || ''} onChange={e => updateWz(idx, 'masa_kg', Number(e.target.value))} /></div>
            <div>
              <Label className="text-xs">Objętość (m³) {!wz.luzne_karton && '*'}</Label>
              <Input className={cn('h-8 text-sm', fieldClass(idx, 'objetosc_m3', !!wz.objetosc_m3))} type="number" value={wz.luzne_karton ? 0 : (wz.objetosc_m3 || '')} disabled={wz.luzne_karton} onChange={e => updateWz(idx, 'objetosc_m3', Number(e.target.value))} />
              <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                <Checkbox checked={wz.luzne_karton || false} onCheckedChange={(checked) => { updateWz(idx, 'luzne_karton', !!checked); if (checked) updateWz(idx, 'objetosc_m3', 0); }} />
                <span className="text-[11px] text-muted-foreground">Luźne/karton</span>
              </label>
            </div>
            <div>
              <Label className="text-xs">Palety (szt) {!wz.bez_palet && '*'}</Label>
              <Input className={cn('h-8 text-sm', fieldClass(idx, 'ilosc_palet', !!wz.ilosc_palet))} type="number" min={0} placeholder="0" value={wz.bez_palet ? 0 : (wz.ilosc_palet || '')} disabled={wz.bez_palet} onChange={e => updateWz(idx, 'ilosc_palet', Number(e.target.value))} />
              <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                <Checkbox checked={wz.bez_palet || false} onCheckedChange={(checked) => { updateWz(idx, 'bez_palet', !!checked); if (checked) updateWz(idx, 'ilosc_palet', 0); }} />
                <span className="text-[11px] text-muted-foreground">Bez palet</span>
              </label>
            </div>
            <div>
              <Label className="text-xs">Wartość netto (zł)</Label>
              <Input className={cn('h-8 text-sm', fieldClass(idx, 'wartosc_netto', wz.wartosc_netto != null))} type="number" step="0.01" min={0} placeholder="opcjonalnie"
                value={wz.wartosc_netto ?? ''}
                onChange={e => updateWz(idx, 'wartosc_netto' as keyof WzInput, e.target.value === '' ? (null as any) : Number(e.target.value))} />
            </div>
            <div></div>
            <div className="col-span-2">
              {autoKlasyfikacja ? (
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs flex items-center gap-2">
                  <span className="text-muted-foreground">Klasyfikacja transportu:</span>
                  <span className="font-medium">{formatKlasyfikacjaLong(autoKlasyfikacja)}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">automatycznie z typu pojazdu</span>
                </div>
              ) : (
                <>
                  <Label className="text-xs">Klasyfikacja transportu</Label>
                  <Select value={wz.klasyfikacja || ''} onValueChange={(v) => updateWz(idx, 'klasyfikacja', v)}>
                    <SelectTrigger className={cn('h-8 text-sm', fieldClass(idx, 'klasyfikacja', !!wz.klasyfikacja))}>
                      <SelectValue placeholder="Wybierz klasyfikację…" />
                    </SelectTrigger>
                    <SelectContent>
                      {KLASYFIKACJE.map(k => (
                        <SelectItem key={k.kod} value={k.kod}>{k.kod} — {k.opis}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            <div className="col-span-2"><Label className="text-xs">Uwagi</Label><Input className={cn('h-8 text-sm', fieldClass(idx, 'uwagi', !!wz.uwagi))} value={wz.uwagi || ''} onChange={e => updateWz(idx, 'uwagi', e.target.value)} /></div>
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
  // Typ dokumentu (auto-wykryty lub wymuszony przez usera) + rawText do re-parse'u
  const [docType, setDocType] = useState<'wz' | 'zamowienie' | null>(null);
  const [docAutoDetected, setDocAutoDetected] = useState(true);
  const rawTextRef = useRef<string | null>(null);
  // Plik PDF zachowujemy do archiwum (po zatwierdzeniu WZ — upload JPEG do Storage)
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  // Podglad WSZYSTKICH stron PDF — MINIATURY (low-res, scale ~0.8). Skalowalne na
  // dowolnie wieloostronne PDF (renderujemy maly canvas zeby uniknac OOM/canvas limit).
  const [pdfPreviewUrls, setPdfPreviewUrls] = useState<string[]>([]);
  // Cache renderow HIGH-RES (scale 2.0) dla modala — renderujemy on-demand po klikniciu
  // miniatury, cache'ujemy zeby ponowne otwarcie tej samej strony bylo natychmiastowe.
  // Klucz = index strony (0-based), wartosc = data URL JPEG.
  const [pdfHighResCache, setPdfHighResCache] = useState<Map<number, string>>(new Map());
  // Loading flag dla high-res render (pokazujemy spinner w modalu)
  const [zoomLoading, setZoomLoading] = useState(false);
  // Reference do pdfDoc — trzymamy zeby moc renderowac high-res strony on-demand.
  // Resetujemy przy "Nowy plik" / unmount (pdfDoc.destroy()).
  const pdfDocRef = useRef<any>(null);
  // Object URL do pelnego PDF (otwierany w nowej karcie po kliknieciu "Otworz pelny PDF").
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  // Index strony pokazywanej w modalu powiekszenia (null = modal zamkniety)
  const [zoomedPageIdx, setZoomedPageIdx] = useState<number | null>(null);

  // Cleanup pdfDoc przy unmount
  useEffect(() => {
    return () => {
      if (pdfDocRef.current) {
        try { pdfDocRef.current.destroy(); } catch { /* ignore */ }
        pdfDocRef.current = null;
      }
    };
  }, []);

  // Lazy render high-res strony gdy user kliknie miniature (otwarcie modala).
  // Cache'ujemy w pdfHighResCache zeby ponowne otwarcie tej samej strony bylo natychmiastowe.
  useEffect(() => {
    if (zoomedPageIdx === null) return;
    if (pdfHighResCache.has(zoomedPageIdx)) return; // juz wyrenderowane
    if (!pdfDocRef.current) return;

    let cancelled = false;
    setZoomLoading(true);
    (async () => {
      try {
        const pageNum = zoomedPageIdx + 1; // pdfjs jest 1-indexed
        const page = await pdfDocRef.current.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setPdfHighResCache(prev => {
          const next = new Map(prev);
          next.set(zoomedPageIdx, dataUrl);
          return next;
        });
      } catch (err) {
        console.warn(`[WzPdfTab] hi-res render strony ${zoomedPageIdx + 1} failed:`, err);
      } finally {
        if (!cancelled) setZoomLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [zoomedPageIdx, pdfHighResCache]);
  // Zwalnianie blob URL przy zmianie pliku / unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

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
    setDocType(null);
    setDocAutoDetected(true);
    rawTextRef.current = null;
    setPdfFile(file);
    // Reset podgladow z poprzedniego pliku
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPdfPreviewUrls([]);
    setPdfHighResCache(new Map());
    setZoomedPageIdx(null);
    // Zwolnij poprzedni pdfDoc jesli byl
    if (pdfDocRef.current) {
      try { pdfDocRef.current.destroy(); } catch { /* ignore */ }
      pdfDocRef.current = null;
    }

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

      const arrayBuffer = await file.arrayBuffer();
      // Object URL do otwarcia w nowej karcie po kliknieciu podgladu
      setPdfBlobUrl(URL.createObjectURL(file));

      const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      // Trzymamy ref do pdfDoc zeby renderowac high-res on-demand po klikniciu miniatury
      pdfDocRef.current = pdfDoc;

      // Render WSZYSTKICH stron jako MINIATURY (scale 0.8 — niska rozdzielczosc, oszczedne
      // pamieciowo, skalowalne na 10+ stron). High-res rendering odbywa sie ON-DEMAND
      // gdy user kliknie miniature (modal powiekszenia) — patrz useEffect ponizej.
      // Pierwsza strona renderowana natychmiast (zeby user widzial cos szybko), pozostale
      // zbieramy do array i ustawiamy hurtem (mniej re-renderow Reacta).
      const previewUrls: string[] = [];
      const pages: string[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);

        // 1) Render miniatury (scale 0.8 — A4 daje canvas ~660x935, ~620 KB jpeg w pamieci
        // przy 80% quality). Dla 20-stronnego PDF zsumowanie miniatur < 15 MB w state.
        try {
          const viewport = page.getViewport({ scale: 0.8 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
            previewUrls.push(dataUrl);
            // Po pierwszej stronie pokaz juz cos userowi — kolejne dolaczymy w pelni na koncu
            if (i === 1) setPdfPreviewUrls([dataUrl]);
          }
        } catch (renderErr) {
          console.warn(`[WzPdfTab] render miniatury strony ${i} failed:`, renderErr);
        }

        // 2) Tekst do parsowania
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
      // Po petli — ustaw KOMPLETNA liste podgladow (jesli bylo > 1 strona)
      if (previewUrls.length > 1) setPdfPreviewUrls(previewUrls);
      const rawText = pages.join('\n');

      if (!rawText || rawText.trim().length < 10) {
        setParsing(false);
        setError('Nie można odczytać PDF — plik może być zeskanowanym obrazem. Użyj zakładki OCR.');
        return;
      }

      // Wspolny dispatch: auto-detekcja WZ vs Zamowienie + odpowiedni parser
      const { parseDocument } = await import('@/lib/parsers');
      const { type, data: mapped, autoDetected } = await parseDocument(rawText);
      rawTextRef.current = rawText;
      setDocType(type === 'unknown' ? 'wz' : type);
      setDocAutoDetected(autoDetected);

      // Klasyfikacja ladunku: priorytet 1) baza katalog_towarow, 2) regex opisu,
      // 3) fallback do wartosci z PDF/zamowienia, 4) auto-drobnica (masa <=100 kg).
      // Decyzja 15.05.2026 — baza katalogu wzbogaca pozycje o m3/HDS/dzial.
      const klas = await klasyfikujWZAsync(
        mapped.pozycje,
        mapped.masa_kg || 0,
        mapped.objetosc_m3 || 0,
        mapped.ilosc_palet || 0,
      );

      setPreview({
        numer_wz: mapped.numer_wz || '',
        nr_zamowienia: mapped.nr_zamowienia || '',
        odbiorca: mapped.odbiorca || '',
        adres: mapped.adres || '',
        tel: combineKontaktTel(mapped.osoba_kontaktowa, mapped.tel),
        masa_kg: mapped.masa_kg || 0,
        objetosc_m3: klas.objetosc_m3,
        ilosc_palet: klas.ilosc_palet,
        bez_palet: klas.bez_palet,
        luzne_karton: klas.luzne_karton,
        uwagi: mapped.uwagi || '',
        kod_klienta: mapped.kod_klienta || null,
        wymaga_hds: klas.wymaga_hds,
        dzialy_hds: klas.dzialy_hds,
      });
    } catch (err) {
      setError('Błąd odczytu PDF: ' + (err as Error).message);
    }
    setParsing(false);
  }, []);

  // Manualne wymuszenie typu dokumentu (gdy auto-detekcja sie pomyli) — re-parsuje rawText
  const switchDocType = useCallback(async (newType: 'wz' | 'zamowienie') => {
    if (!rawTextRef.current) return;
    const { parseDocument } = await import('@/lib/parsers');
    const { data: mapped } = await parseDocument(rawTextRef.current, { forceType: newType });
    setDocType(newType);
    setDocAutoDetected(false);
    const klas = await klasyfikujWZAsync(
      mapped.pozycje,
      mapped.masa_kg || 0,
      mapped.objetosc_m3 || 0,
      mapped.ilosc_palet || 0,
    );
    setPreview({
      numer_wz: mapped.numer_wz || '',
      nr_zamowienia: mapped.nr_zamowienia || '',
      odbiorca: mapped.odbiorca || '',
      adres: mapped.adres || '',
      tel: combineKontaktTel(mapped.osoba_kontaktowa, mapped.tel),
      masa_kg: mapped.masa_kg || 0,
      objetosc_m3: klas.objetosc_m3,
      ilosc_palet: klas.ilosc_palet,
      bez_palet: klas.bez_palet,
      luzne_karton: klas.luzne_karton,
      uwagi: mapped.uwagi || '',
      kod_klienta: mapped.kod_klienta || null,
      wymaga_hds: klas.wymaga_hds,
      dzialy_hds: klas.dzialy_hds,
    });
  }, []);

  const handleConfirm = () => {
    if (!preview) return;
    // _pdfFile = oryginalny PDF do archiwum (transient, useCreateZlecenie zarchiwizuje go po INSERT WZ)
    const newWz: WzInput = { ...preview, klasyfikacja: '', wartosc_netto: null, _pdfFile: pdfFile, _kod_klienta: preview.kod_klienta, _wymaga_hds: preview.wymaga_hds, _dzialy_hds: preview.dzialy_hds };
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList([newWz]);
    } else {
      setWzList([...wzList, newWz]);
    }
    setPreview(null);
    setDocType(null);
    setDocAutoDetected(true);
    rawTextRef.current = null;
    setPdfFile(null);
    setPdfPreviewUrls([]);
    setPdfHighResCache(new Map());
    setZoomedPageIdx(null);
    if (pdfDocRef.current) { try { pdfDocRef.current.destroy(); } catch { /* ignore */ } pdfDocRef.current = null; }
    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }
  };

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
          {/* Badge typu dokumentu + manual toggle (gdy auto-detekcja sie pomyli) */}
          {docType && (
            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${docType === 'zamowienie' ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}`}>
              <span className={`font-medium ${docType === 'zamowienie' ? 'text-blue-900 dark:text-blue-100' : 'text-green-900 dark:text-green-100'}`}>
                {docType === 'zamowienie' ? '📋 Wykryto: Zamówienie' : '📄 Wykryto: WZ (Dokument wydania)'}
                {!docAutoDetected && <span className="ml-1 text-[10px] opacity-70">(wybór ręczny)</span>}
              </span>
              <button
                type="button"
                onClick={() => switchDocType(docType === 'wz' ? 'zamowienie' : 'wz')}
                className="ml-auto text-[11px] underline opacity-80 hover:opacity-100"
                title="Wymuś inny typ parsera (np. gdy auto-detekcja się pomyliła)"
              >
                Źle? Przełącz na {docType === 'wz' ? 'Zamówienie' : 'WZ'} →
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Sprawdź i popraw dane (oryginał obok dla porównania):</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <PreviewFields preview={preview} setPreview={setPreview} />
            </div>
            {pdfPreviewUrls.length > 0 && (
              <div className="border rounded-md p-2 bg-muted/20 sticky top-2 self-start max-h-[70vh] overflow-auto space-y-2">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-xs text-muted-foreground">
                    📄 Oryginał {pdfPreviewUrls.length > 1 ? `(${pdfPreviewUrls.length} stron)` : ''} — kliknij aby powiększyć
                  </p>
                  {pdfBlobUrl && (
                    <a
                      href={pdfBlobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary hover:underline shrink-0"
                    >
                      Otwórz PDF ↗
                    </a>
                  )}
                </div>
                {pdfPreviewUrls.map((url, idx) => (
                  <div key={idx} className="space-y-0.5">
                    {pdfPreviewUrls.length > 1 && (
                      <p className="text-[10px] text-muted-foreground font-medium">Strona {idx + 1} / {pdfPreviewUrls.length}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => setZoomedPageIdx(idx)}
                      className="block w-full cursor-zoom-in"
                      title={`Powiększ stronę ${idx + 1}`}
                    >
                      <img
                        src={url}
                        alt={`Oryginał WZ — strona ${idx + 1}`}
                        className="w-full h-auto rounded shadow-sm hover:shadow-md hover:ring-2 hover:ring-primary/40 transition-all"
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Modal powiekszenia strony PDF — klik na miniature otwiera ten dialog */}
            <Dialog
              open={zoomedPageIdx !== null}
              onOpenChange={(o) => { if (!o) setZoomedPageIdx(null); }}
            >
              <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto p-2 overflow-auto">
                {zoomedPageIdx !== null && pdfPreviewUrls[zoomedPageIdx] && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 px-2">
                      <p className="text-sm font-medium flex items-center gap-2">
                        Strona {zoomedPageIdx + 1} {pdfPreviewUrls.length > 1 && `/ ${pdfPreviewUrls.length}`}
                        {zoomLoading && (
                          <span className="text-xs text-muted-foreground">
                            <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin mr-1 align-middle" />
                            ładuję wysoką rozdzielczość…
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2">
                        {pdfPreviewUrls.length > 1 && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={zoomedPageIdx === 0}
                              onClick={() => setZoomedPageIdx(i => i !== null && i > 0 ? i - 1 : i)}
                            >
                              ← Poprzednia
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={zoomedPageIdx === pdfPreviewUrls.length - 1}
                              onClick={() => setZoomedPageIdx(i => i !== null && i < pdfPreviewUrls.length - 1 ? i + 1 : i)}
                            >
                              Następna →
                            </Button>
                          </>
                        )}
                        {pdfBlobUrl && (
                          <a
                            href={pdfBlobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            Otwórz pełny PDF ↗
                          </a>
                        )}
                      </div>
                    </div>
                    {/* Pokaz hi-res z cache jesli jest, inaczej miniature jako placeholder */}
                    <img
                      src={pdfHighResCache.get(zoomedPageIdx) || pdfPreviewUrls[zoomedPageIdx]}
                      alt={`Oryginał WZ — strona ${zoomedPageIdx + 1} (powiększenie)`}
                      className="w-full h-auto rounded"
                    />
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm}>Użyj tych danych</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              setPreview(null);
              setDocType(null);
              setDocAutoDetected(true);
              rawTextRef.current = null;
              setError(null);
              setPdfPreviewUrls([]);
              setPdfHighResCache(new Map());
              setZoomedPageIdx(null);
              if (pdfDocRef.current) { try { pdfDocRef.current.destroy(); } catch { /* ignore */ } pdfDocRef.current = null; }
              if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }
            }}>Nowy plik</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Multi-PDF Bulk Tab ───
 * Multi-file picker — kazdy PDF parsowany sekwencyjnie i tworzony jako OSOBNE
 * zlecenie (1 WZ per zlecenie). Pomija krok 4 (sprawdzanie dostepnosci) — wszystkie
 * zlecenia uzywaja tych samych parametrow z krokow 1-2 (oddzial, typ pojazdu, dzien,
 * godzina). Dyspozytor moze pozniej polaczyc kursy z tych zlecen.
 */
type BulkRow = {
  file: File;
  status: 'pending' | 'parsing' | 'ok' | 'error';
  preview: ParsePreview | null;
  errorMsg: string | null;
  /** Wykryty typ dokumentu (WZ vs Zamowienie). Pomocne dla user'a zeby zweryfikowac. */
  docType: 'wz' | 'zamowienie' | null;
};

function WzPdfBulkTab({
  onBulkSubmit,
  bulkSubmitting,
  autoKlasyfikacja,
}: {
  onBulkSubmit: (wzListPerZlecenie: WzInput[][]) => Promise<void>;
  bulkSubmitting: boolean;
  autoKlasyfikacja?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [parsing, setParsing] = useState(false);

  const parseOne = useCallback(async (file: File): Promise<{ preview: ParsePreview | null; error: string | null; docType: 'wz' | 'zamowienie' | null }> => {
    try {
      if (!file.name.toLowerCase().endsWith('.pdf')) return { preview: null, error: 'Nie PDF', docType: null };
      if (file.size > 10 * 1024 * 1024) return { preview: null, error: 'Plik za duzy (>10 MB)', docType: null };

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
      try { pdfDoc.destroy(); } catch { /* ignore */ }

      const rawText = pages.join('\n');
      if (!rawText || rawText.trim().length < 10) {
        return { preview: null, error: 'Pusty PDF (zeskanowany?). Uzyj OCR.', docType: null };
      }

      // Auto-detekcja: WZ vs Zamowienie (wybor parsera)
      const { parseDocument } = await import('@/lib/parsers');
      const { type, data: mapped } = await parseDocument(rawText);
      const docType: 'wz' | 'zamowienie' = type === 'unknown' ? 'wz' : type;

      // Klasyfikacja z baza katalog_towarow (priorytet) + parser opisu (fallback).
      const klas = await klasyfikujWZAsync(
        mapped.pozycje,
        mapped.masa_kg || 0,
        mapped.objetosc_m3 || 0,
        mapped.ilosc_palet || 0,
      );

      return {
        preview: {
          numer_wz: mapped.numer_wz || '',
          nr_zamowienia: mapped.nr_zamowienia || '',
          odbiorca: mapped.odbiorca || '',
          adres: mapped.adres || '',
          tel: combineKontaktTel(mapped.osoba_kontaktowa, mapped.tel),
          masa_kg: mapped.masa_kg || 0,
          objetosc_m3: klas.objetosc_m3,
          ilosc_palet: klas.ilosc_palet,
          bez_palet: klas.bez_palet,
          luzne_karton: klas.luzne_karton,
          uwagi: mapped.uwagi || '',
          kod_klienta: mapped.kod_klienta || null,
          wymaga_hds: klas.wymaga_hds,
          dzialy_hds: klas.dzialy_hds,
        },
        error: null,
        docType,
      };
    } catch (err) {
      return { preview: null, error: 'Blad odczytu: ' + (err as Error).message, docType: null };
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (arr.length === 0) {
      toast.error('Wybierz pliki PDF');
      return;
    }
    // Inicjalnie dodaj wszystkie ze statusem parsing
    const initialRows: BulkRow[] = arr.map(f => ({ file: f, status: 'parsing', preview: null, errorMsg: null, docType: null }));
    setRows(prev => [...prev, ...initialRows]);
    setParsing(true);

    // Parsuj sekwencyjnie (zeby nie zarznac CPU/pamieci dla wielu plikow rownoczesnie)
    const startIdx = rows.length;
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      const result = await parseOne(file);
      const rowIdx = startIdx + i;
      setRows(prev => {
        const next = [...prev];
        if (next[rowIdx] && next[rowIdx].file === file) {
          next[rowIdx] = {
            ...next[rowIdx],
            status: result.preview ? 'ok' : 'error',
            preview: result.preview,
            errorMsg: result.error,
            docType: result.docType,
          };
        }
        return next;
      });
    }
    setParsing(false);
  }, [parseOne, rows.length]);

  const updateRowField = (idx: number, field: keyof ParsePreview, value: string | number | boolean) => {
    setRows(prev => {
      const next = [...prev];
      if (!next[idx] || !next[idx].preview) return prev;
      next[idx] = { ...next[idx], preview: { ...next[idx].preview!, [field]: value } as ParsePreview };
      return next;
    });
  };

  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const okRows = rows.filter(r => r.status === 'ok' && r.preview);
  const errorRows = rows.filter(r => r.status === 'error');
  const parsingRows = rows.filter(r => r.status === 'parsing');

  // Walidacja: kazdy ok-row musi miec odbiorca, adres, tel, masa, palety/objetosc
  const invalidRows = okRows.filter(r => {
    const p = r.preview!;
    if (!p.odbiorca || !p.adres || p.adres.trim().length < 5) return true;
    if (!p.tel || p.tel.trim().length < 5) return true;
    if (!p.masa_kg || p.masa_kg <= 0) return true;
    if (!p.luzne_karton && (!p.objetosc_m3 || p.objetosc_m3 <= 0)) return true;
    if (!p.bez_palet && (!p.ilosc_palet || p.ilosc_palet <= 0)) return true;
    return false;
  });

  const handleSubmitAll = async () => {
    if (okRows.length === 0) {
      toast.error('Brak poprawnie sparsowanych PDF');
      return;
    }
    if (invalidRows.length > 0) {
      toast.error(`${invalidRows.length} zlecen ma braki — uzupelnij wymagane pola`);
      return;
    }
    // Konwersja kazdego ok-row do WzInput[] (1 WZ per zlecenie)
    const wzListPerZlecenie: WzInput[][] = okRows.map(r => {
      const p = r.preview!;
      return [{
        numer_wz: p.numer_wz || null,
        nr_zamowienia: p.nr_zamowienia || null,
        odbiorca: p.odbiorca,
        adres: p.adres,
        tel: p.tel || null,
        masa_kg: p.masa_kg,
        objetosc_m3: p.objetosc_m3 || 0,
        ilosc_palet: p.ilosc_palet || 0,
        bez_palet: p.bez_palet,
        luzne_karton: p.luzne_karton,
        uwagi: p.uwagi || null,
        klasyfikacja: autoKlasyfikacja || '',
        wartosc_netto: null,
        _pdfFile: r.file,
      }];
    });
    await onBulkSubmit(wzListPerZlecenie);
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs">
        <p className="font-medium text-blue-900 dark:text-blue-100">📚 Tryb wielu PDF</p>
        <p className="text-blue-700 dark:text-blue-300 mt-1">
          Kazdy PDF zostanie utworzony jako <strong>osobne zlecenie</strong> (1 WZ per zlecenie).
          Wszystkie uzyja tego samego oddzialu, typu pojazdu, dnia i godziny z poprzednich krokow.
          Krok sprawdzania dostepnosci jest pomijany — dyspozytor zobaczy zlecenia w kolejce i moze polaczyc je w kursy.
        </p>
      </div>

      <div
        className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files?.length) { handleFiles(e.target.files); e.target.value = ''; } }}
        />
        <div className="text-3xl mb-2">📚</div>
        <p className="text-sm font-medium text-muted-foreground">Przeciagnij PDF-y lub kliknij aby wybrac kilka plikow</p>
        <p className="text-xs text-muted-foreground mt-1">Multi-select (Ctrl/Shift+klik). Kazdy PDF do 10 MB.</p>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {rows.length} plikow:
              {' '}<span className="text-green-600 font-medium">✓ {okRows.length}</span>
              {parsingRows.length > 0 && <> · <span className="text-blue-600">⏳ {parsingRows.length}</span></>}
              {errorRows.length > 0 && <> · <span className="text-red-600">✕ {errorRows.length}</span></>}
              {invalidRows.length > 0 && <> · <span className="text-amber-600">⚠ {invalidRows.length} braki</span></>}
              {(() => {
                const wzCount = okRows.filter(r => r.docType === 'wz').length;
                const zamCount = okRows.filter(r => r.docType === 'zamowienie').length;
                if (wzCount === 0 && zamCount === 0) return null;
                return (
                  <>
                    {' · '}
                    {wzCount > 0 && <span className="text-green-700">📄 {wzCount} WZ</span>}
                    {wzCount > 0 && zamCount > 0 && ' '}
                    {zamCount > 0 && <span className="text-blue-700">📋 {zamCount} Zam</span>}
                  </>
                );
              })()}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setRows([])} disabled={parsing || bulkSubmitting} className="h-7 text-xs">
              Wyczysc liste
            </Button>
          </div>

          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 w-8">#</th>
                  <th className="text-left p-2">Plik / Status</th>
                  <th className="text-left p-2">Odbiorca *</th>
                  <th className="text-left p-2">Adres *</th>
                  <th className="text-left p-2">Telefon *</th>
                  <th className="text-left p-2 w-28">Masa kg *</th>
                  <th className="text-left p-2 w-24">Palety</th>
                  <th className="text-left p-2 w-24">Obj. m³</th>
                  <th className="text-left p-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const p = r.preview;
                  const isInvalid = r.status === 'ok' && p && (
                    !p.odbiorca || !p.adres || p.adres.trim().length < 5 ||
                    !p.tel || p.tel.trim().length < 5 ||
                    !p.masa_kg || p.masa_kg <= 0 ||
                    (!p.luzne_karton && (!p.objetosc_m3 || p.objetosc_m3 <= 0)) ||
                    (!p.bez_palet && (!p.ilosc_palet || p.ilosc_palet <= 0))
                  );
                  return (
                    <tr key={idx} className={`border-t ${r.status === 'error' ? 'bg-red-50 dark:bg-red-950/20' : isInvalid ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                      <td className="p-2 text-muted-foreground">{idx + 1}</td>
                      <td className="p-2">
                        <div className="font-medium truncate max-w-[200px]" title={r.file.name}>{r.file.name}</div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 flex-wrap">
                          {r.status === 'parsing' && <span className="text-blue-600">⏳ analizuje...</span>}
                          {r.status === 'ok' && <span className="text-green-600">✓ sparsowane{p?.numer_wz && ` · ${p.numer_wz}`}{p?.nr_zamowienia && !p?.numer_wz && ` · ${p.nr_zamowienia}`}</span>}
                          {r.status === 'error' && <span className="text-red-600" title={r.errorMsg || ''}>✕ {r.errorMsg}</span>}
                          {r.docType === 'wz' && <span className="text-[9px] px-1 py-0 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-700">📄 WZ</span>}
                          {r.docType === 'zamowienie' && <span className="text-[9px] px-1 py-0 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700">📋 Zam</span>}
                        </div>
                      </td>
                      {p ? (
                        <>
                          <td className="p-1"><Input className="h-7 text-xs" value={p.odbiorca} onChange={e => updateRowField(idx, 'odbiorca', e.target.value)} /></td>
                          <td className="p-1"><Input className="h-7 text-xs" value={p.adres} onChange={e => updateRowField(idx, 'adres', e.target.value)} /></td>
                          <td className="p-1"><Input className="h-7 text-xs" value={p.tel} onChange={e => updateRowField(idx, 'tel', e.target.value)} /></td>
                          <td className="p-1"><Input className="h-7 text-xs" type="number" value={p.masa_kg || ''} onChange={e => updateRowField(idx, 'masa_kg', Number(e.target.value))} /></td>
                          <td className="p-1">
                            <Input className="h-7 text-xs" type="number" min={0} value={p.bez_palet ? 0 : (p.ilosc_palet || '')} disabled={p.bez_palet} onChange={e => updateRowField(idx, 'ilosc_palet', Number(e.target.value))} />
                            <label className="flex items-center gap-1 mt-0.5 cursor-pointer">
                              <Checkbox checked={p.bez_palet} onCheckedChange={(c) => { updateRowField(idx, 'bez_palet', !!c); if (c) updateRowField(idx, 'ilosc_palet', 0); }} />
                              <span className="text-[9px] text-muted-foreground">bez</span>
                            </label>
                          </td>
                          <td className="p-1">
                            <Input className="h-7 text-xs" type="number" min={0} step="0.1" value={p.luzne_karton ? 0 : (p.objetosc_m3 || '')} disabled={p.luzne_karton} onChange={e => updateRowField(idx, 'objetosc_m3', Number(e.target.value))} />
                            <label className="flex items-center gap-1 mt-0.5 cursor-pointer">
                              <Checkbox checked={p.luzne_karton} onCheckedChange={(c) => { updateRowField(idx, 'luzne_karton', !!c); if (c) updateRowField(idx, 'objetosc_m3', 0); }} />
                              <span className="text-[9px] text-muted-foreground">luzne</span>
                            </label>
                          </td>
                        </>
                      ) : (
                        <td className="p-1 text-muted-foreground italic" colSpan={6}>{r.status === 'parsing' ? 'analizuje...' : '—'}</td>
                      )}
                      <td className="p-1">
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          disabled={bulkSubmitting}
                          className="text-red-600 hover:text-red-800 px-1 disabled:opacity-50"
                          title="Usun z listy"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="text-xs text-muted-foreground">
              {okRows.length > 0 && invalidRows.length === 0 && (
                <span className="text-green-700 dark:text-green-400 font-medium">
                  Gotowe do utworzenia {okRows.length} {okRows.length === 1 ? 'zlecenia' : 'zlecen'}
                </span>
              )}
              {invalidRows.length > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  Uzupelnij wymagane pola w {invalidRows.length} {invalidRows.length === 1 ? 'wierszu' : 'wierszach'} (zaznaczone na zolto)
                </span>
              )}
            </div>
            <Button
              onClick={handleSubmitAll}
              disabled={bulkSubmitting || parsing || okRows.length === 0 || invalidRows.length > 0}
            >
              {bulkSubmitting ? 'Tworze zlecenia...' : `🚀 Utworz ${okRows.length} ${okRows.length === 1 ? 'zlecenie' : okRows.length < 5 ? 'zlecenia' : 'zlecen'}`}
            </Button>
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
      objetosc_m3: 0, ilosc_palet: 0, bez_palet: false, luzne_karton: false, uwagi: r.uwagi || '',
      klasyfikacja: '', wartosc_netto: null,
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
  const [pasteFlash, setPasteFlash] = useState(false);
  // Auto-detekcja typu dokumentu (WZ vs Zamowienie)
  const [docType, setDocType] = useState<'wz' | 'zamowienie' | null>(null);
  const [docAutoDetected, setDocAutoDetected] = useState(true);
  // Strony dokumentu — wielostronicowe WZ wymagaja sklejenia przed OCR.
  // Pierwszy paste/upload tworzy strone 1, kolejne dodaja strony 2, 3, ...
  const [pages, setPages] = useState<(File | Blob)[]>([]);
  // Snip — modal z live preview ekranu (otwiera getDisplayMedia, user zaznacza fragment)
  const [snipOpen, setSnipOpen] = useState(false);
  // Obraz zrodlowy zachowujemy do archiwum (po accept — kompresja JPEG + upload do Storage)
  const [imageBlob, setImageBlob] = useState<File | Blob | null>(null);
  // Object URL do podgladu obok formularza w step 'preview' (sprzedawca widzi oryginal
  // przy poprawianiu pol — kluczowe gdy OCR pomyli sie z 'B'/'8', diakrytyki, cudzyslowy)
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageBlob) { setImageUrl(null); return; }
    const url = URL.createObjectURL(imageBlob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageBlob]);

  // Dodanie strony do kolejki (paste / upload / kamera). NIE uruchamia OCR od razu —
  // user moze dodac kolejne strony i potem kliknac "Rozpocznij OCR".
  const handleImage = (file: File | Blob) => {
    const size = (file as File).size ?? (file as Blob).size ?? 0;
    if (size > 15 * 1024 * 1024) { setError("Plik za duży (max 15 MB)"); return; }
    setError(null);
    setPages((prev) => [...prev, file]);
  };

  // Usuwanie strony z kolejki
  const removePage = (idx: number) => {
    setPages((prev) => prev.filter((_, i) => i !== idx));
  };

  // Otwarcie live snip modal — modal sam wywoluje getDisplayMedia, pokazuje
  // live preview, user zaznacza fragment. Po accept dostajemy gotowy blob.
  const handleSnip = () => {
    setError(null);
    setSnipOpen(true);
  };

  const handleSnipCapture = (blob: Blob) => {
    setSnipOpen(false);
    handleImage(blob);
  };

  const handleSnipCancel = () => {
    setSnipOpen(false);
  };

  // Uruchomienie OCR: scal strony pionowo, preprocess, Tesseract → text
  const startOCR = async () => {
    if (pages.length === 0) return;
    setParsing(true);
    setError(null);
    setProgress(0);

    try {
      // Sklej strony pionowo (lub zwroc 1 strone jako jest)
      const { mergePagesVertically, preprocessForOCR } = await import("@/lib/ocrPreprocess");
      let combined: File | Blob | null;
      if (pages.length === 1) {
        combined = pages[0];
      } else {
        setProgressMsg(`Sklejanie ${pages.length} stron...`);
        combined = await mergePagesVertically(pages);
      }
      if (!combined) {
        setParsing(false);
        setError("Nie udało się sklejić stron");
        return;
      }
      // ORYGINAL (sklejony) do archiwum
      setImageBlob(combined);

      setProgressMsg("Przygotowanie obrazu...");
      const preprocessed = await preprocessForOCR(combined);
      const ocrInput: File | Blob = preprocessed || combined;

      setProgressMsg("Ładowanie modelu OCR...");
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
      await worker.setParameters({ tessedit_pageseg_mode: '6' as any });
      const { data: { text } } = await worker.recognize(ocrInput as any);
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

  const handleParse = async (forceType?: 'wz' | 'zamowienie') => {
    const { parseDocument } = await import('@/lib/parsers');
    const { type, data: mapped, autoDetected } = await parseDocument(ocrText, forceType ? { forceType } : {});
    setDocType(type === 'unknown' ? 'wz' : type);
    setDocAutoDetected(autoDetected);
    const klas = await klasyfikujWZAsync(
      mapped.pozycje,
      mapped.masa_kg || 0,
      mapped.objetosc_m3 || 0,
      mapped.ilosc_palet || 0,
    );
    setPreview({
      numer_wz: mapped.numer_wz || '',
      nr_zamowienia: mapped.nr_zamowienia || '',
      odbiorca: mapped.odbiorca || '',
      adres: mapped.adres || '',
      tel: combineKontaktTel(mapped.osoba_kontaktowa, mapped.tel),
      masa_kg: mapped.masa_kg || 0,
      objetosc_m3: klas.objetosc_m3,
      ilosc_palet: klas.ilosc_palet,
      bez_palet: klas.bez_palet,
      luzne_karton: klas.luzne_karton,
      uwagi: mapped.uwagi || '',
      kod_klienta: mapped.kod_klienta || null,
      wymaga_hds: klas.wymaga_hds,
      dzialy_hds: klas.dzialy_hds,
    });
    setStep('preview');
  };

  const handleConfirm = () => {
    if (!preview) return;
    // _imageBlob = oryginalny obraz do archiwum (transient, useCreateZlecenie po INSERT zarchiwizuje)
    const newWz: WzInput = { ...preview, klasyfikacja: '', wartosc_netto: null, _imageBlob: imageBlob, _kod_klienta: preview.kod_klienta, _wymaga_hds: preview.wymaga_hds, _dzialy_hds: preview.dzialy_hds };
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList([newWz]);
    } else {
      setWzList([...wzList, newWz]);
    }
    setStep('upload');
    setPreview(null);
    setOcrText("");
    setImageBlob(null);
    setPages([]);
  };

  // Paste ze schowka (Ctrl+V po Narzędziu do wycinania Windows) — aktywny tylko
  // na kroku 'upload', żeby nie przechwytywać Ctrl+V w textarea kroku 'text'.
  useEffect(() => {
    if (step !== 'upload') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            setPasteFlash(true);
            setTimeout(() => setPasteFlash(false), 600);
            handleImage(file);
            return;
          }
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [step]);

  return (
    <div className="space-y-3 pt-2">
      {step === 'upload' && !parsing && (
        <>
          <div className={`text-xs text-center p-2 rounded-md border border-dashed transition-colors ${pasteFlash ? 'bg-green-100 border-green-500 text-green-900' : 'bg-muted/40 border-muted-foreground/30 text-muted-foreground'}`}>
            {pasteFlash ? `✅ Strona ${pages.length} dodana` : pages.length > 0
              ? `📄 ${pages.length} ${pages.length === 1 ? 'strona dodana' : 'strony dodane'} — możesz dodać kolejną lub kliknąć "Rozpocznij OCR"`
              : '📋 Wklej zrzut ekranu ze schowka — Ctrl+V (np. po użyciu Win+Shift+S)'}
          </div>
          {pages.length === 0 && (
            <div className="text-[11px] text-center text-muted-foreground/80 px-2">
              💡 Dokument wielostronicowy? Wklej kolejne strony jedna po drugiej — aplikacja sama je sklei.
            </div>
          )}

          {/* Lista dodanych stron */}
          {pages.length > 0 && (
            <div className="space-y-2">
              <div className="space-y-1">
                {pages.map((page, idx) => (
                  <PageThumb key={idx} blob={page} idx={idx} onRemove={() => removePage(idx)} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={startOCR} className="flex-1 min-w-[150px]">
                  ▶ Rozpocznij OCR ({pages.length} {pages.length === 1 ? 'strona' : 'strony'})
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPages([])}>
                  Wyczyść
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={handleSnip}
            >
              <div className="text-3xl mb-2">✂️</div>
              <p className="text-sm font-medium text-muted-foreground">Wytnij z ekranu</p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">Wybierz <b>Cały ekran</b>, nie okno apki</p>
            </div>
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => cameraRef.current?.click()}
            >
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); }} />
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm font-medium text-muted-foreground">{pages.length > 0 ? 'Dodaj zdjęcie' : 'Zrób zdjęcie'}</p>
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
              <p className="text-sm font-medium text-muted-foreground">{pages.length > 0 ? 'Dodaj plik' : 'Wybierz plik'}</p>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}

      {/* SnipLiveOverlay — modal z live preview ekranu + zaznaczanie fragmentu */}
      {snipOpen && (
        <SnipLiveOverlay onCapture={handleSnipCapture} onCancel={handleSnipCancel} />
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
            <Button size="sm" onClick={() => handleParse()}>Parsuj dane</Button>
            <Button size="sm" variant="outline" onClick={() => { setStep('upload'); setOcrText(""); setImageBlob(null); setPages([]); }}>Nowe zdjęcie</Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-3">
          {/* Badge typu dokumentu + manual toggle (gdy auto-detekcja sie pomyli) */}
          {docType && (
            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${docType === 'zamowienie' ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}`}>
              <span className={`font-medium ${docType === 'zamowienie' ? 'text-blue-900 dark:text-blue-100' : 'text-green-900 dark:text-green-100'}`}>
                {docType === 'zamowienie' ? '📋 Wykryto: Zamówienie' : '📄 Wykryto: WZ (Dokument wydania)'}
                {!docAutoDetected && <span className="ml-1 text-[10px] opacity-70">(wybór ręczny)</span>}
              </span>
              <button
                type="button"
                onClick={() => handleParse(docType === 'wz' ? 'zamowienie' : 'wz')}
                className="ml-auto text-[11px] underline opacity-80 hover:opacity-100"
                title="Wymuś inny typ parsera (np. gdy auto-detekcja się pomyliła)"
              >
                Źle? Przełącz na {docType === 'wz' ? 'Zamówienie' : 'WZ'} →
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Sprawdź i popraw dane (oryginał obok dla porównania):</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <PreviewFields preview={preview} setPreview={setPreview} />
            </div>
            {imageUrl && (
              <div className="border rounded-md p-2 bg-muted/20 sticky top-2 self-start max-h-[70vh] overflow-auto">
                <p className="text-xs text-muted-foreground mb-1.5">📄 Oryginał (kliknij aby powiększyć):</p>
                <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={imageUrl}
                    alt="Oryginał WZ"
                    className="w-full h-auto rounded shadow-sm hover:shadow-md transition-shadow"
                  />
                </a>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm}>Użyj tych danych</Button>
            <Button size="sm" variant="outline" onClick={() => setStep('text')}>Popraw tekst</Button>
            <Button size="sm" variant="ghost" onClick={() => { setStep('upload'); setPreview(null); setOcrText(""); setImageBlob(null); setPages([]); setDocType(null); setDocAutoDetected(true); }}>Nowe zdjęcie</Button>
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
  bez_palet: boolean;
  luzne_karton: boolean;
  uwagi: string;
  /** Kod klienta z PDF (Nr ewid.) - do auto-detekcji typu klienta R. Transient. */
  kod_klienta?: string | null;
  /** ≥1 pozycja WZ ma w bazie katalog_towarow wymaga_hds=true (transient). */
  wymaga_hds?: boolean;
  /** Lista dzialow ciezkich z bazy (transient, do bannera Krok 2). */
  dzialy_hds?: string[];
};

const PREVIEW_FIELDS: { key: keyof ParsePreview; label: string; type?: string }[] = [
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

/* ─── PageThumb — miniaturka strony w kolejce OCR (z przyciskiem usun) ─── */
function PageThumb({ blob, idx, onRemove }: { blob: File | Blob; idx: number; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/20">
      {url && <img src={url} alt={`Strona ${idx + 1}`} className="h-12 w-12 object-cover rounded" />}
      <span className="text-xs flex-1">Strona {idx + 1}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-xs text-red-600 hover:text-red-800 px-2"
        title="Usuń stronę"
      >
        ✕
      </button>
    </div>
  );
}

function PreviewFields({ preview, setPreview }: { preview: ParsePreview; setPreview: (fn: (p: ParsePreview | null) => ParsePreview | null) => void }) {
  // Walidacja adresu (geocoding) — kluczowe dla wyliczen kosztow i linii prostej.
  // Status: idle = jeszcze nie sprawdzono, checking = w trakcie, ok = znaleziona ulica,
  // approximate = znaleziono tylko miasto (OCR pewnie zniszczyl ulice — wymaga korekty),
  // fail = w ogole nie znaleziono.
  type AdresStatus = 'idle' | 'checking' | 'ok' | 'approximate' | 'fail';
  const [adresStatus, setAdresStatus] = useState<AdresStatus>('idle');

  // Pola dotknięte przez usera — pomarańczowa ramka znika po pierwszej edycji
  // (potwierdzenie że user świadomie zweryfikował wartość auto-uzupełnioną z PDF/OCR).
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  const sprawdzAdres = useCallback(async (adres: string) => {
    if (!adres || adres.trim().length < 5) {
      setAdresStatus('idle');
      return;
    }
    setAdresStatus('checking');
    const { geocodeAddressWithFallback } = await import('@/lib/oddzialy-geo');
    const r = await geocodeAddressWithFallback(adres);
    if (!r) setAdresStatus('fail');
    else if (r.exact) setAdresStatus('ok');
    else setAdresStatus('approximate');
  }, []);

  // Auto-walidacja gdy preview sie zaladuje (po OCR/parsowaniu) — uruchamiamy raz
  // dla aktualnej wartosci adresu przy pierwszym renderze tego komponentu
  useEffect(() => {
    sprawdzAdres(preview.adres);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-3 py-2 text-xs text-orange-900 dark:text-orange-100">
        🟠 Dane wstępnie wypełnione z dokumentu — <strong>zweryfikuj każde pole</strong> przed zatwierdzeniem. Pomarańczowa ramka znika po edycji (potwierdzenie weryfikacji).
      </div>
      {PREVIEW_FIELDS.map(f => {
        const val = preview[f.key];
        const isM3 = f.key === 'objetosc_m3';
        const isPal = f.key === 'ilosc_palet';
        const isAdres = f.key === 'adres';
        const disabled = (isM3 && preview.luzne_karton) || (isPal && preview.bez_palet);
        const found = val !== '' && val !== 0 && !disabled;
        // Adres ma wlasna walidacje przez geocoding — nadpisuje found
        const adresFail = isAdres && adresStatus === 'fail';
        const adresApprox = isAdres && adresStatus === 'approximate';
        // Pomarańczowa ramka dla pól auto-uzupełnionych z importu — sygnał "sprawdź".
        // Znika gdy: user edytował pole (touched), pole jest puste (warning ⚠️ wystarczy),
        // pole jest disabled (luzne_karton / bez_palet), lub adres ma już swoją ramkę (red/yellow).
        const needsReview = !touchedFields.has(f.key) && found && !disabled && !adresFail && !adresApprox;
        return (
          <div key={f.key}>
            <div className="flex items-center gap-2">
              <span className="text-sm w-4">
                {isAdres ? (
                  adresStatus === 'ok' ? '✓' :
                  adresStatus === 'checking' ? '⏳' :
                  adresStatus === 'fail' ? '❌' :
                  adresStatus === 'approximate' ? '⚠️' :
                  (found ? '✓' : '⚠️')
                ) : (found ? '✓' : '⚠️')}
              </span>
              <Label className="text-xs w-32 shrink-0">{f.label}{isM3 && !preview.luzne_karton ? ' *' : ''}{isPal && !preview.bez_palet ? ' *' : ''}</Label>
              <Input
                className={`h-8 text-sm flex-1 ${adresFail ? 'border-red-500 focus-visible:ring-red-500' : adresApprox ? 'border-yellow-500 focus-visible:ring-yellow-500' : needsReview ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20 focus-visible:ring-orange-400' : ''}`}
                type={f.type || 'text'}
                disabled={disabled}
                value={disabled ? '0' : (val?.toString() ?? '')}
                onChange={e => {
                  const raw = e.target.value;
                  setPreview(prev => prev ? { ...prev, [f.key]: f.type === 'number' ? (Number(raw) || 0) : raw } : prev);
                  if (isAdres && adresStatus !== 'idle') setAdresStatus('idle');
                  setTouchedFields(prev => {
                    if (prev.has(f.key)) return prev;
                    const next = new Set(prev);
                    next.add(f.key);
                    return next;
                  });
                }}
                onBlur={isAdres ? () => sprawdzAdres(val?.toString() || '') : undefined}
              />
            </div>
            {isAdres && adresStatus === 'fail' && (
              <p className="ml-10 mt-0.5 text-[11px] text-red-600">
                ❌ Adres nie znaleziony — popraw ulicę/kod/miasto (sprawdź oryginał obok)
              </p>
            )}
            {isAdres && adresStatus === 'approximate' && (
              <p className="ml-10 mt-0.5 text-[11px] text-yellow-700">
                ⚠️ Znaleziono tylko miasto — popraw nazwę ulicy dla dokładnej odległości i kosztów
              </p>
            )}
            {isM3 && (
              <div className="ml-10 mt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={preview.luzne_karton} onCheckedChange={(checked) => {
                    setPreview(prev => prev ? { ...prev, luzne_karton: !!checked, objetosc_m3: checked ? 0 : prev.objetosc_m3 } : prev);
                  }} />
                  <span className="text-[11px] text-muted-foreground">Luźne/karton (bez m³)</span>
                </label>
              </div>
            )}
            {isPal && (
              <div className="ml-10 mt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox checked={preview.bez_palet} onCheckedChange={(checked) => {
                    setPreview(prev => prev ? { ...prev, bez_palet: !!checked, ilosc_palet: checked ? 0 : prev.ilosc_palet } : prev);
                  }} />
                  <span className="text-[11px] text-muted-foreground">Bez palet</span>
                </label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WzPasteTab({ wzList, setWzList }: { wzList: WzInput[]; setWzList: (wz: WzInput[]) => void }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  // Auto-detekcja typu dokumentu (WZ vs Zamowienie)
  const [docType, setDocType] = useState<'wz' | 'zamowienie' | null>(null);
  const [docAutoDetected, setDocAutoDetected] = useState(true);

  const handleParse = async (forceType?: 'wz' | 'zamowienie') => {
    if (text.length === 0) return;
    setParsing(true);
    setError(null);
    setPreview(null);

    // Wspolny dispatch: auto-detekcja WZ vs Zamowienie + odpowiedni parser
    const { parseDocument } = await import('@/lib/parsers');
    const { type, data: mapped, autoDetected } = await parseDocument(text, forceType ? { forceType } : {});
    setDocType(type === 'unknown' ? 'wz' : type);
    setDocAutoDetected(autoDetected);
    const klas = await klasyfikujWZAsync(
      mapped.pozycje,
      mapped.masa_kg || 0,
      mapped.objetosc_m3 || 0,
      mapped.ilosc_palet || 0,
    );
    setPreview({
      numer_wz: mapped.numer_wz || '',
      nr_zamowienia: mapped.nr_zamowienia || '',
      odbiorca: mapped.odbiorca || '',
      adres: mapped.adres || '',
      tel: combineKontaktTel(mapped.osoba_kontaktowa, mapped.tel),
      masa_kg: mapped.masa_kg || 0,
      objetosc_m3: klas.objetosc_m3,
      ilosc_palet: klas.ilosc_palet,
      bez_palet: klas.bez_palet,
      luzne_karton: klas.luzne_karton,
      uwagi: mapped.uwagi || '',
      kod_klienta: mapped.kod_klienta || null,
      wymaga_hds: klas.wymaga_hds,
      dzialy_hds: klas.dzialy_hds,
    });
    setParsing(false);
  };

  const handleConfirm = () => {
    if (!preview) return;
    const newWz: WzInput = { ...preview, klasyfikacja: '', wartosc_netto: null, _kod_klienta: preview.kod_klienta, _wymaga_hds: preview.wymaga_hds, _dzialy_hds: preview.dzialy_hds };
    if (wzList.length === 1 && !wzList[0].odbiorca && !wzList[0].adres) {
      setWzList([newWz]);
    } else {
      setWzList([...wzList, newWz]);
    }
    setText('');
    setPreview(null);
    setDocType(null);
    setDocAutoDetected(true);
  };

  return (
    <div className="space-y-3">
      {!preview && (
        <>
          <Textarea
            className="min-h-[120px] font-mono text-xs"
            placeholder="Wklej tekst z dokumentu WZ lub Potwierdzenia zamówienia (z PDF, e-maila itp.) — system rozpozna typ i wyciągnie dane"
            value={text}
            onChange={e => { setText(e.target.value); setError(null); }}
          />
          <div className="flex items-center gap-2">
            <Button onClick={() => handleParse()} disabled={text.length === 0 || parsing} size="sm">
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
          {/* Badge typu dokumentu + manual toggle (gdy auto-detekcja sie pomyli) */}
          {docType && (
            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${docType === 'zamowienie' ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800' : 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'}`}>
              <span className={`font-medium ${docType === 'zamowienie' ? 'text-blue-900 dark:text-blue-100' : 'text-green-900 dark:text-green-100'}`}>
                {docType === 'zamowienie' ? '📋 Wykryto: Zamówienie' : '📄 Wykryto: WZ (Dokument wydania)'}
                {!docAutoDetected && <span className="ml-1 text-[10px] opacity-70">(wybór ręczny)</span>}
              </span>
              <button
                type="button"
                onClick={() => handleParse(docType === 'wz' ? 'zamowienie' : 'wz')}
                className="ml-auto text-[11px] underline opacity-80 hover:opacity-100"
                title="Wymuś inny typ parsera (np. gdy auto-detekcja się pomyliła)"
              >
                Źle? Przełącz na {docType === 'wz' ? 'Zamówienie' : 'WZ'} →
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Sprawdź i popraw odczytane dane:</p>
          <PreviewFields preview={preview} setPreview={setPreview} />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm}>Użyj tych danych</Button>
            <Button size="sm" variant="outline" onClick={() => { setPreview(null); setDocType(null); setDocAutoDetected(true); }}>Wróć do tekstu</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WzFormTabs({ wzList, setWzList, error, submitting, onBack, onSubmit, typPojazdu, onBulkSubmit, bulkSubmitting, onWzImported }: WzFormTabsProps) {
  // Default tab: PDF — najczęstszy use case (po refactorze 13.05 ten widok jest
  // Krokiem 1, czyli pierwszą rzeczą którą user widzi przy nowym zleceniu).
  const [activeTab, setActiveTab] = useState<string>('pdf');

  // Auto-klasyfikacja z typu pojazdu — gdy user wybrał konkretny typ (nie 'bez_preferencji'),
  // klasyfikacja jest jednoznacznie wyprowadzana i nie trzeba jej wpisywać ręcznie.
  const autoKlas = klasyfikacjaZTypu(typPojazdu);
  useEffect(() => {
    if (!autoKlas || wzList.length === 0) return;
    // Sprawdź czy jakieś WZ ma inną/brakującą klasyfikację — tylko wtedy aktualizuj
    const needsUpdate = wzList.some(w => (w.klasyfikacja || '') !== autoKlas);
    if (!needsUpdate) return;
    setWzList(wzList.map(w => ({ ...w, klasyfikacja: autoKlas })));
  }, [autoKlas, wzList, setWzList]);

  // Wrapper dla zakładek importu: po dodaniu WZ automatycznie przełącz na
  // zakładkę 'Ręcznie' (gdzie user widzi swoje dodane WZ) + toast potwierdzający.
  // Dzięki temu po kliknięciu 'Użyj tych danych' user NIE zostaje zagubiony
  // na pustym ekranie uploadu OCR/PDF — widzi od razu że dane zostały zapisane.
  // Plus notyfikacja parent (Dashboard) o numerach dokumentu — żeby mógł
  // wykryć oddział wystawiający i zaproponować zmianę gdy różny od wybranego.
  const setWzListFromImport = useCallback((next: WzInput[]) => {
    // Klasyfikacja transportu — kolejność priorytetów:
    //  1. autoKlas (z typu pojazdu wybranego w Kroku 2) — najsilniejszy, user explicit wskazał
    //  2. Wartość z parsera/usera już ustawiona na WZ
    //  3. Sugestia na bazie wagi/m³/palet (najmniejszy pojazd który zmiesci ladunek)
    //     — używane gdy Krok 2 jeszcze nie odbyl sie a chcemy zasugerowac wstepnie.
    console.log('[setWzListFromImport] next=', next.map(w => ({ masa: w.masa_kg, m3: w.objetosc_m3, palet: w.ilosc_palet, _wymaga_hds: w._wymaga_hds, klasyfikacja: w.klasyfikacja })), 'autoKlas=', autoKlas);
    const final = next.map(w => {
      if (autoKlas) return { ...w, klasyfikacja: autoKlas };
      if (w.klasyfikacja) return w;
      const sugerowana = sugerujKlasyfikacjeWg(w.masa_kg || 0, w.objetosc_m3 || 0, w.ilosc_palet || 0, w._wymaga_hds || false);
      console.log('[setWzListFromImport] sugerowana=', sugerowana, 'dla masa=', w.masa_kg, 'palet=', w.ilosc_palet, '_wymaga_hds=', w._wymaga_hds);
      return sugerowana ? { ...w, klasyfikacja: sugerowana } : w;
    });
    setWzList(final);
    setActiveTab('reczne');
    toast.success('✅ WZ dodane do listy — sprawdź w zakładce Ręcznie');
    if (onWzImported && final.length > 0) {
      onWzImported(final[0]);
    }
  }, [setWzList, autoKlas, onWzImported]);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="pdf" className="flex-1 text-xs">PDF</TabsTrigger>
          {onBulkSubmit && (
            <TabsTrigger value="pdf-bulk" className="flex-1 text-xs">📚 Wiele PDF</TabsTrigger>
          )}
          <TabsTrigger value="ocr" className="flex-1 text-xs">OCR</TabsTrigger>
          <TabsTrigger value="xls" className="flex-1 text-xs">XLS</TabsTrigger>
          <TabsTrigger value="paste" className="flex-1 text-xs">Wklej</TabsTrigger>
          <TabsTrigger value="reczne" className="flex-1 text-xs">Ręcznie</TabsTrigger>
        </TabsList>

        <TabsContent value="pdf"><WzPdfTab wzList={wzList} setWzList={setWzListFromImport} /></TabsContent>
        {onBulkSubmit && (
          <TabsContent value="pdf-bulk">
            <WzPdfBulkTab onBulkSubmit={onBulkSubmit} bulkSubmitting={!!bulkSubmitting} autoKlasyfikacja={autoKlas} />
          </TabsContent>
        )}
        <TabsContent value="ocr"><WzOcrTab wzList={wzList} setWzList={setWzListFromImport} /></TabsContent>
        <TabsContent value="xls"><WzXlsTab wzList={wzList} setWzList={setWzListFromImport} /></TabsContent>
        <TabsContent value="paste"><WzPasteTab wzList={wzList} setWzList={setWzListFromImport} /></TabsContent>
        <TabsContent value="reczne"><WzManualForm wzList={wzList} setWzList={setWzList} autoKlasyfikacja={autoKlas} /></TabsContent>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {activeTab !== 'pdf-bulk' && (
        <div className="flex gap-2">
          {onBack && <Button variant="outline" onClick={onBack}>← Wstecz</Button>}
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Wysyłanie...' : 'Dalej →'}
          </Button>
        </div>
      )}
      {activeTab === 'pdf-bulk' && onBack && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={bulkSubmitting}>← Wstecz</Button>
        </div>
      )}
    </div>
  );
}
