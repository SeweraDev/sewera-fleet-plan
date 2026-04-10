import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
// Heavy libraries loaded dynamically (lazy) to avoid blocking app startup
let pdfjsLib: typeof import("pdfjs-dist") | null = null;
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

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
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground text-xs hover:text-foreground"
        >
          {open ? "▼" : "▶"} 📦 Pozycje z WZ ({pozycje.length} pozycji)
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

  const handleFile = useCallback(
    async (file: File) => {
      const name = file.name.toLowerCase();
      const isImage = name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
      if (!isImage && !name.endsWith(".pdf")) {
        setError("Nieobsługiwany format. Wymagany PDF lub zdjęcie (PNG/JPG).");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError("Plik za duży (max 10 MB)");
        return;
      }

      setParsing(true);
      setError(null);
      setResult(null);
      setFormData(null);

      try {
        // OCR branch: images (PNG/JPG)
        if (isImage) {
          const TesseractModule = await import("tesseract.js");
          const { data: { text: ocrText } } = await TesseractModule.default.recognize(file, "pol", {
            logger: (m: any) => {
              if (m.status === "recognizing text") {
                setError(`Rozpoznawanie tekstu: ${Math.round((m.progress || 0) * 100)}%`);
              } else if (m.status === "loading language traineddata") {
                setError("Pobieranie modelu OCR (pierwszy raz)...");
              }
            },
          });
          setError(null);

          if (!ocrText || ocrText.trim().length < 20) {
            setParsing(false);
            setError("Nie udało się rozpoznać tekstu ze zdjęcia. Uzupełnij ręcznie.");
            setTimeout(onSwitchManual, 3000);
            return;
          }

          console.log("[PdfTab OCR] extracted text:\n", ocrText.substring(0, 500));
          const mapped = parseWZText(ocrText);

          setResult({
            nr_wz: mapped.numer_wz, nr_zamowienia: mapped.nr_zamowienia,
            odbiorca_nazwa: mapped.odbiorca, odbiorca: mapped.odbiorca,
            odbiorca_adres_siedziby: null, adres_dostawy: mapped.adres,
            nazwa_budowy: null, osoba_kontaktowa: mapped.osoba_kontaktowa,
            tel: mapped.tel, tel2: null, masa_kg: mapped.masa_kg,
            ilosc_palet: mapped.ilosc_palet, objetosc_m3: mapped.objetosc_m3,
            uwagi: mapped.uwagi, pozycje: [], pewnosc: 60,
          } as ParsedPdfResult);
          setFormData(mapped);
          setParsing(false);
          return;
        }

        // Client-side PDF text extraction — preserve line structure via Y-position tracking
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await getPdfjs();
        const pdfDoc = await pdf.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          const lines: string[] = [];
          let currentLine = "";
          let lastY: number | null = null;
          for (const item of content.items as any[]) {
            if (!item.str && item.str !== "") continue;
            const y = item.transform ? item.transform[5] : null;
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
              // Y position changed — new line
              if (currentLine.trim()) lines.push(currentLine.trim());
              currentLine = item.str;
            } else {
              currentLine += (currentLine && item.str && !currentLine.endsWith(" ") ? " " : "") + item.str;
            }
            if (y !== null) lastY = y;
            if (item.hasEOL) {
              if (currentLine.trim()) lines.push(currentLine.trim());
              currentLine = "";
              lastY = null;
            }
          }
          if (currentLine.trim()) lines.push(currentLine.trim());
          pages.push(lines.join("\n"));
        }
        const rawText = pages.join("\n");

        if (!rawText || rawText.trim().length < 10) {
          setParsing(false);
          setError("Nie można odczytać PDF — plik może być zeskanowanym obrazem");
          return;
        }

        // Same pipeline as PasteTab: decodePUA → cleanText → parseWZText
        console.log("[PdfTab] extracted text:\n", rawText.substring(0, 500));
        const mapped = parseWZText(rawText);
        console.log("[PdfTab] parsed client-side with parseWZText (identical to PasteTab)");

        setResult({
          nr_wz: mapped.numer_wz,
          nr_zamowienia: mapped.nr_zamowienia,
          odbiorca_nazwa: mapped.odbiorca,
          odbiorca: mapped.odbiorca,
          odbiorca_adres_siedziby: null,
          adres_dostawy: mapped.adres,
          nazwa_budowy: null,
          osoba_kontaktowa: mapped.osoba_kontaktowa,
          tel: mapped.tel,
          tel2: null,
          masa_kg: mapped.masa_kg,
          ilosc_palet: mapped.ilosc_palet,
          objetosc_m3: mapped.objetosc_m3,
          uwagi: mapped.uwagi,
          pozycje: [],
          pewnosc: 80,
        } as ParsedPdfResult);

        setFormData(mapped);
      } catch (err) {
        setError("Błąd odczytu PDF: " + (err as Error).message);
      }
      setParsing(false);
    },
    [onSwitchManual],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const fields: { key: keyof WZImportData; label: string; type?: string }[] = [
    { key: "numer_wz", label: "Nr WZ" },
    { key: "nr_zamowienia", label: "Nr zamówienia" },
    { key: "odbiorca", label: "Odbiorca" },
    { key: "adres", label: "Adres dostawy" },
    { key: "tel", label: "Telefon" },
    { key: "masa_kg", label: "Masa kg" },
    { key: "ilosc_palet", label: "Ilość palet", type: "number" },
    { key: "objetosc_m3", label: "Objętość m³", type: "number" },
    { key: "uwagi", label: "Uwagi" },
  ];

  return (
    <div className="space-y-3">
      <div
        className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <p className="text-sm font-medium text-muted-foreground">📄 Przeciągnij PDF lub zdjęcie, lub kliknij aby wybrać</p>
        <p className="text-xs text-muted-foreground mt-1">PDF do 10 MB · Zdjęcia PNG/JPG (OCR)</p>
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
            {fields.map((f) => {
              const val = formData[f.key];
              const found = val != null && val !== "" && val !== 0;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-sm w-4">{found ? "✓" : "⚠️"}</span>
                  <Label className="text-xs w-28 shrink-0">{f.label}</Label>
                  <Input
                    className="h-8 text-sm flex-1"
                    type={f.type || "text"}
                    value={f.key === "masa_kg" && typeof val === "number" ? formatMasaKg(val) : (val?.toString() ?? "")}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setFormData((prev) =>
                        prev
                          ? {
                              ...prev,
                              [f.key]:
                                f.type === "number"
                                  ? raw
                                    ? Number(raw)
                                    : null
                                  : f.key === "masa_kg"
                                    ? parseFloat(raw.replace(/\s/g, "").replace(",", ".")) || 0
                                    : raw,
                            }
                          : prev,
                      );
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

          <Button onClick={() => onParsed(formData)} className="w-full">
            ✅ Użyj tych danych
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── XLS Header mapping ─── */
const XLS_HEADER_PATTERNS: { patterns: RegExp[]; field: string }[] = [
  { patterns: [/^kierowca$/i, /^kier$/i], field: "kierowca" },
  { patterns: [/^kurs$/i], field: "kurs" },
  { patterns: [/^nazwa\s*kontrahenta$/i, /^kontrahent$/i], field: "odbiorca" },
  { patterns: [/^miejscowo/i, /^miasto$/i], field: "miasto" },
  { patterns: [/^ulica$/i, /^adres$/i], field: "ulica" },
  { patterns: [/^nr\s*wz$/i, /^wz$/i], field: "nr_wz" },
  { patterns: [/^masa$/i, /^waga$/i], field: "masa" },
  { patterns: [/^typ\s*samochodu$/i, /^rodzaj\s*samochodu$/i, /^klasyfikacja$/i, /^typ$/i], field: "typ" },
  { patterns: [/^rodzaj\s*dostawy$/i], field: "rodzaj_dostawy" },
  { patterns: [/^uwagi/i], field: "uwagi" },
];

const XLS_TYP_MAP: Record<string, string | null> = {
  A: null, B: "Dostawczy 1,2t", C: "Winda 1,8t", D: "Winda 6,3t",
  E: "Winda MAX 15,8t", F: "HDS 12,0t", G: "HDS 12,0t", H: "HDS 9,0t", I: "HDS 9,0t",
};

function matchXlsHeader(h: string): string | null {
  // Normalize: collapse all whitespace/newlines to single space
  const t = (h || "").replace(/[\s\n\r]+/g, " ").trim();
  for (const hp of XLS_HEADER_PATTERNS) {
    for (const p of hp.patterns) { if (p.test(t)) return hp.field; }
  }
  return null;
}

/* ─── XLS Tab (client-side parsing with SheetJS) ─── */
function XlsTab({ onParsed }: { onParsed: (rows: WZImportData[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<(WZImportData & { typ_pojazdu?: string })[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError("Plik za duży (max 10 MB)");
      return;
    }
    setParsing(true);
    setError(null);
    setRows([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (rawRows.length < 2) { setError("Plik jest pusty"); setParsing(false); return; }

      // Find header row (first row with >= 3 recognized headers)
      let headerIdx = -1;
      const colMap = new Map<number, string>();
      for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
        const tempMap = new Map<number, string>();
        for (let j = 0; j < (rawRows[i]?.length || 0); j++) {
          const field = matchXlsHeader(String(rawRows[i][j] || ""));
          if (field) tempMap.set(j, field);
        }
        if (tempMap.size >= 3) {
          headerIdx = i;
          tempMap.forEach((v, k) => colMap.set(k, v));
          break;
        }
      }

      if (headerIdx === -1) { setError("Nie rozpoznano nagłówków kolumn"); setParsing(false); return; }

      const fieldCol: Record<string, number> = {};
      colMap.forEach((field, idx) => { fieldCol[field] = idx; });
      const get = (row: any[], field: string): string => {
        const idx = fieldCol[field]; return idx !== undefined ? String(row[idx] ?? "").trim() : "";
      };
      const getNum = (row: any[], field: string): number | null => {
        const v = get(row, field); if (!v) return null;
        const n = parseFloat(v.replace(/\s/g, "").replace(",", "."));
        return isNaN(n) ? null : Math.ceil(n);
      };

      // Parse rows into flat WZ list
      const allWz: (WZImportData & { typ_pojazdu?: string })[] = [];
      let currentTyp: string | null = null;

      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.every((c: any) => !c && c !== 0)) continue;

        const nrWz = get(row, "nr_wz");
        const odbiorca = get(row, "odbiorca");
        const masa = getNum(row, "masa");
        const typKod = get(row, "typ").toUpperCase().trim().charAt(0);

        if (!nrWz && !odbiorca && masa !== null) continue; // summary row
        if (!nrWz && !odbiorca) continue;

        if (typKod && XLS_TYP_MAP[typKod] !== undefined) currentTyp = XLS_TYP_MAP[typKod];

        const miasto = get(row, "miasto");
        const ulica = get(row, "ulica");
        const rodzajDostawy = get(row, "rodzaj_dostawy");
        const uwagi = get(row, "uwagi");

        allWz.push({
          numer_wz: nrWz || null,
          nr_zamowienia: null,
          odbiorca: odbiorca || null,
          adres: [ulica, miasto].filter(Boolean).join(", ") || null,
          tel: null,
          osoba_kontaktowa: null,
          masa_kg: masa,
          ilosc_palet: null,
          objetosc_m3: null,
          uwagi: [rodzajDostawy, uwagi].filter(Boolean).join("; ") || null,
          typ_dokumentu: "WZ",
          ma_adres_dostawy: false,
          typ_pojazdu: currentTyp,
        });
      }

      console.log("[XlsTab] parsed client-side:", allWz.length, "WZ rows");
      setRows(allWz);
      setSelected(new Set(allWz.map((_, i) => i)));
    } catch (err) {
      setError("Błąd odczytu pliku: " + (err as Error).message);
    }
    setParsing(false);
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
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
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
                    <td className="px-2 py-1">
                      <Checkbox checked={selected.has(i)} />
                    </td>
                    <td className="px-2 py-1 font-mono">{r.numer_wz || "—"}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{r.odbiorca || "—"}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{r.adres || "—"}</td>
                    <td className="px-2 py-1 text-right">{r.masa_kg ?? "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.typ_pojazdu || "—"}</td>
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
    0x80: "€",
    0x82: "‚",
    0x84: "„",
    0x85: "…",
    0x86: "†",
    0x87: "‡",
    0x89: "‰",
    0x8a: "Š",
    0x8b: "‹",
    0x8c: "Ś",
    0x8d: "Ť",
    0x8e: "Ž",
    0x8f: "Ź",
    0x91: "\u2018",
    0x92: "\u2019",
    0x93: "\u201C",
    0x94: "\u201D",
    0x95: "•",
    0x96: "–",
    0x97: "—",
    0x99: "™",
    0x9a: "š",
    0x9b: "›",
    0x9c: "ś",
    0x9d: "ť",
    0x9e: "ž",
    0x9f: "ź",
  };
  const bases = [0xe000, 0xf000, 0x10000, 0x100000];
  return Array.from(text)
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      for (const base of bases) {
        const off = cp - base;
        if (off >= 0x20 && off <= 0x24f) {
          if (off >= 0x80 && off <= 0x9f) return win1250[off] ?? "";
          return String.fromCodePoint(off);
        }
      }
      if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0x10000) return "";
      return ch;
    })
    .join("");
}

/* ─── cleanText — remove non-printable chars from PDF clipboard ─── */
function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[^\x20-\x7E\u00A0-\u024F\u2000-\u215F\n\r\t]/g, "")
    // Rozdziel złączone linie — wstaw newline przed kluczowymi wzorcami
    .replace(/(NIP:\s*\d)/g, "\n$1")
    .replace(/(NR BDO:)/gi, "\n$1")
    .replace(/(Nr\s+ewid)/gi, "\n$1")
    .replace(/(ODDZIAŁ\s)/gi, "\n$1")
    .replace(/(Magazyn\s+wydaj)/gi, "\n$1")
    .replace(/(Adres\s+dostawy)/gi, "\n$1")
    .replace(/(Termin\s+zapłaty)/gi, "\n$1")
    .replace(/(Wystawił:)/gi, "\n$1")
    .replace(/(Na\s+podstawie\s+art)/gi, "\n$1")
    .replace(/(Wydruk\s+z\s+programu)/gi, "\n$1")
    .replace(/(Osoba\s+drukująca)/gi, "\n$1")
    .replace(/(Os\.\s*upoważnione)/gi, "\n$1")
    .replace(/(Uwagi:)/gi, "\n$1")
    .replace(/(RAZEM[:\s])/gi, "\n$1")
    .replace(/(\d)(Waga\s+netto)/gi, "$1\n$2")
    .replace(/(Waga\s+netto\s+razem[:\s])/gi, "\n$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(\n\s*){3,}/g, "\n\n");
}

/* ─── formatMasaKg — display with Polish thousands separator ─── */
function formatMasaKg(masa: number | null | undefined): string {
  if (!masa) return "";
  return Math.ceil(masa).toLocaleString("pl-PL");
}

/* ─── parseWZText — Ekonom WZ parser v5 ─── */
export function parseWZText(rawText: string): WZImportData {
  const text = cleanText(decodePUA(rawText));
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. nr_wz — ONLY match WZ, WZS, or PZ prefixed document numbers
  let numer_wz: string | null = null;
  const wzM = text.match(/(WZS?|PZ)\s+([A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/);
  if (wzM) {
    numer_wz = `${wzM[1]} ${wzM[2]}`;
  }

  // 2. nr_zamowienia — label first, then pattern, then "Potwierdzenie zamówienia nr:"
  let nr_zamowienia: string | null = null;
  const zamLabel = text.match(/Nr\s+zam(?:ówienia)?(?:\s*\(systemowy\))?[:\s\]]+([A-Z0-9\/]+)/i);
  if (zamLabel) nr_zamowienia = zamLabel[1];
  if (!nr_zamowienia) {
    const zamPattern = text.match(/([A-Z]{1,2}\d?\/[A-Z]{2}\/\d{4}\/\d{2}\/\d+)/);
    if (zamPattern) nr_zamowienia = zamPattern[1];
  }
  if (!nr_zamowienia) {
    const potwM = text.match(/Potwierdzenie\s+zam[oó]wienia\s+nr[:\s]+([A-Z0-9\/]+)/i);
    if (potwM) nr_zamowienia = potwM[1];
  }

  // 3. odbiorca — try labeled section first ("Odbiorca" / "Nabywca"), then fallback
  let odbiorca: string | null = null;
  let odbiornikAdres: string | null = null; // adres z sekcji odbiorcy (fallback gdy brak "Adres dostawy")

  // Priority: find "Odbiorca" or "Nabywca" label and collect ALL lines after it
  const odbLabelIdx = lines.findIndex((l) => /^(?:Odbiorca|Nabywca)\s*$/i.test(l) || /(?:^|\s)(?:Odbiorca|Nabywca)\s*$/i.test(l));
  if (odbLabelIdx >= 0) {
    const SEWERA_CHECK = /SEWERA|KOŚCIUSZKI\s*326|000044503/i;
    const nameParts: string[] = [];
    const addrParts: string[] = [];
    let passedSewera = false;
    for (let i = odbLabelIdx + 1; i < Math.min(odbLabelIdx + 20, lines.length); i++) {
      const l = lines[i];
      if (/Adres\s+dostawy/i.test(l)) break;
      if (/^Informacje\s*$/i.test(l)) break;
      if (/^Magazyn\s+wydający/i.test(l)) break;
      if (/^Termin\s+zapłaty/i.test(l)) break;
      if (/^Wydano\s+na/i.test(l)) break;
      if (/^Nazwa\s+towaru/i.test(l)) break;
      if (/^Lp\.\s/i.test(l)) break;
      if (/^\d+\.\s/.test(l)) break;
      if (SEWERA_CHECK.test(l)) { passedSewera = true; nameParts.length = 0; addrParts.length = 0; continue; }
      // Blok Sewery — pomijaj NIP, NR BDO, ODDZIAŁ, adres Sewery
      if (!passedSewera && (/^NIP:/i.test(l) || /^NR BDO:/i.test(l))) continue;
      if (passedSewera && /^ODDZIAŁ/i.test(l)) continue;
      if (passedSewera && /^NIP:/i.test(l)) continue;
      if (passedSewera && /^NR BDO:/i.test(l)) continue;
      if (passedSewera && /^ul\.\s/i.test(l) && /KATOWICE|KOŚCIUSZKI/i.test(l)) continue;
      // Nr ewid odbiorcy — stop (już mamy odbiorcę)
      if (/^Nr\s+ewid/i.test(l) && nameParts.length > 0) break;
      if (/^NIP:/i.test(l) && nameParts.length > 0) break;
      if (l.length < 2) continue;
      // Rozdziel adres od nazwy firmy
      if (/^(?:ul|al|os|pl)\.\s/i.test(l) || /^\d{2}-\d{3}\s/.test(l)) {
        addrParts.push(l);
      } else {
        nameParts.push(l);
      }
    }
    // Odbiorca = nazwa firmy; adres siedziby zapisz osobno
    if (nameParts.length) odbiorca = nameParts.join(" ");
    if (addrParts.length) odbiornikAdres = addrParts.join(", ");
  }

  // Fallback: skip SEWERA block, find company by legal form / caps
  if (!odbiorca) {
  const SELLER_MARKERS = /SEWERA|KOŚCIUSZKI\s*326|NR\s*BDO:\s*000044503/i;
  const SKIP_PATTERNS = [
    SELLER_MARKERS,
    /ODDZIAŁ/i,
    /^ul\./i,
    /^al\./i,
    /^os\./i,
    /^pl\./i,
    /NIP:/i,
    /NR BDO:/i,
    /Adres\s+dostawy/i,
    /Waga\s+netto/i,
    /Nr\s+zam/i,
    /PALETA/i,
    /Tel\./i,
    /Os\.\s*kontaktowa/i,
    /^\d{2}-\d{3}/,
    /Katowice,\s*\d/,
    /Uwagi/i,
    /kontaktowa/i,
    /Budowa/i,
    /^\d+\s+(SZT|KG|M|OP|KPL)/i,
    /Magazyn/i,
    /^RAZEM/i,
    /Wystawił/i,
    /Na podstawie/i,
    /Nr oferty/i,
    /^\d+\.\s/,
    /Lp\./,
    /Kod\s+towaru/i,
    /Kod\s+EAN/i,
    /Nazwa\s+towaru/i,
    /Termin\s+zap/i,
    /Wydano\s+na/i,
    /Informacje/i,
    /^Cena\s/i,
    /^Netto$/i,
    /Wydruk\s+z\s+programu/i,
    /Osoba\s+drukuj/i,
    /Czas\s+wydruku/i,
  ];

  // Find SEWERA line index to skip the seller block
  let seweraIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SELLER_MARKERS.test(lines[i])) {
      seweraIdx = i;
      break;
    }
  }

  // Search for odbiorca starting after SEWERA block
  const searchStart = seweraIdx >= 0 ? seweraIdx + 1 : 0;
  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_PATTERNS.some((p) => p.test(line))) continue;
    // Skip product codes and manufacturer lines in parentheses
    if (/\(.*(?:SPÓŁKA|SP\.|S\.A\.|S\.C\.)/i.test(line)) continue;
    if (/^[A-Z]{1,3}-\d/.test(line)) continue;
    const hasLegalForm = /SPÓŁKA|SP\.\s*K|SP\.\s*Z|S\.A\.?|S\.C\.|Sp\.\s*z\s*o\.o\.|KOMANDYT/i.test(line);
    const capsWords = line.split(/\s+/).filter((w) => /^[A-ZĄĆĘŁŃÓŚŹŻ\-]{2,}$/.test(w)).length;
    // Match company-like names: initials with dots (P.A, P.H.U.), mixed case brand names
    const hasInitials = /\b[A-Z]\.[A-Z]\.?\b/.test(line);
    const allCapsName = line.split(/\s+/).filter((w) => /^[A-ZĄĆĘŁŃÓŚŹŻ][A-Za-ząćęłńóśźż.\-]{1,}$/.test(w)).length >= 2;
    if (hasLegalForm || capsWords >= 3 || (hasInitials && allCapsName)) {
      // Zbierz nazwę firmy + dane teleadresowe (obcinanie robimy w post-processing)
      const parts = [line];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const nl = lines[j];
        if (/NIP:|NR BDO:|Nr\s+ewid|Adres\s+dostawy|Budowa|Magazyn|Informacje|Termin/i.test(nl)) break;
        if (/^(Lp\.|Kod\s+towaru|Nazwa\s+towaru|Ilość|Sprzedawca|Nabywca|Odbiorca)\s*$/i.test(nl)) break;
        if (/^\d+\.\s/.test(nl)) break; // product line
        // Adres (ul./kod) lub kontynuacja nazwy — zbierz
        if (/^(?:ul|al|os|pl)\.\s/i.test(nl) || /^\d{2}-\d{3}\s/.test(nl) || /^[A-ZĄĆĘŁŃÓŚŹŻ]{3,}$/i.test(nl)) {
          parts.push(nl);
          continue;
        }
        break;
      }
      odbiorca = parts.join(", ").replace(/,\s*,/g, ",");
      break;
    }
  }
  } // end if (!odbiorca)

  // 4. adres_dostawy — ONLY set when document has explicit "Adres dostawy" or "Budowa" section
  let adres: string | null = null;
  const adresIdx = lines.findIndex((l) => /Adres\s+dostawy/i.test(l));
  const hasBudowa = lines.some((l) => /^Budowa/i.test(l));
  const hasDeliverySection = adresIdx >= 0 || hasBudowa;

  if (hasDeliverySection) {
    // Priority 1: ALL lines AFTER "Adres dostawy" header (zbieraj agresywnie)
    if (adresIdx >= 0) {
      const STOP = /^(Os\.\s*kontaktowa|Tel\.|Nr\s+zam|PALETA|Waga|Uwagi|Termin|Wydano|Lp\.|Magazyn|Forma\s+płatn|NIP:|NR BDO:|Ilość|JM|Kod\s+towaru|Nazwa\s+towaru|Sprzedawca|Nabywca|Odbiorca)/i;
      const addrParts: string[] = [];
      for (let i = adresIdx + 1; i < lines.length && i <= adresIdx + 8; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (STOP.test(l)) break;
        // Skip lines that are clearly product data (digit + SZT/KG etc)
        if (/^\d+\s+(SZT|KG|M|OP|KPL)/i.test(l)) break;
        if (/^\d+\.\s/.test(l)) break; // product line "1. ..."
        addrParts.push(l);
      }
      if (addrParts.length) adres = addrParts.join(", ").replace(/,\s*,/g, ",");
    }
    // Priority 2: lines BEFORE "Adres dostawy" (PDF column layout)
    if (!adres && adresIdx >= 0) {
      const addrParts: string[] = [];
      for (let i = adresIdx - 1; i >= Math.max(0, adresIdx - 8); i--) {
        const l = lines[i];
        if (/^(Os\.\s*kontaktowa|Tel\.|^p\.)/i.test(l)) continue;
        if (/NIP:|NR BDO:|SEWERA|ODDZIAŁ|Nr\s+ewid/i.test(l)) break;
        if (/\d{2}-\d{3}/.test(l)) { addrParts.unshift(l); continue; }
        if (/ul\.|al\.|os\.|pl\./i.test(l)) { addrParts.unshift(l); continue; }
        // Nazwa miasta/lokalizacji (np. TYCHY PSP) — zbierz i kontynuuj
        if (addrParts.length > 0 && /^[A-ZŁŚŻŹĆŃÓĘ\s\-\.]{3,}$/i.test(l.trim())) { addrParts.unshift(l.trim()); continue; }
      }
      if (addrParts.length) adres = addrParts.join(", ").replace(/,\s*,/g, ",");
    }
    // Priority 3: "Budowa" line as delivery location
    if (!adres && hasBudowa) {
      const budowaIdx2 = lines.findIndex((l) => /^Budowa/i.test(l));
      const addrParts: string[] = [];
      for (let i = budowaIdx2 + 1; i < Math.min(budowaIdx2 + 5, lines.length); i++) {
        const l = lines[i];
        if (/^(Os\.\s*kontaktowa|Tel\.|Magazyn|Termin|Nr\s+zam)/i.test(l)) break;
        if (/ul\.|al\.|os\.|pl\./i.test(l) || /\d{2}-\d{3}/.test(l) || addrParts.length > 0) {
          addrParts.push(l);
        }
      }
      if (addrParts.length) adres = addrParts.join(", ").replace(/,\s*,/g, ",");
    }
    // Final guard: if adres duplicates odbiorca address, clear it
    if (adres && odbiorca && odbiorca.includes(adres)) {
      adres = null;
    }
  }

  // Fallback: brak sekcji "Adres dostawy" — użyj adresu z sekcji odbiorcy
  if (!adres && odbiornikAdres) {
    adres = odbiornikAdres;
  }

  // 5. tel — search near delivery section ONLY when document has explicit delivery address
  let tel: string | null = null;
  const wystawilIdx = lines.findIndex((l) => /Wystawił/i.test(l));
  const budowaIdx = lines.findIndex((l) => /^Budowa/i.test(l));
  const deliveryAnchor = Math.max(budowaIdx, adresIdx >= 0 ? adresIdx : 0);
  if (hasDeliverySection && deliveryAnchor > 0) {
    // Search backward from anchor (PDF column layout: Tel. before Adres dostawy)
    for (let i = deliveryAnchor - 1; i >= Math.max(0, deliveryAnchor - 6); i--) {
      if (/NIP:|NR BDO:|SEWERA|ODDZIAŁ|Nr\s+ewid/i.test(lines[i])) break;
      const telM = lines[i].match(/Tel\.?:?\s*([\d\s\-]{9,})/i);
      if (telM) {
        tel = telM[1].trim();
        break;
      }
    }
    // Search forward from anchor
    if (!tel) {
      const telEndIdx = lines.findIndex((l, i) => i > deliveryAnchor && /Nr\s+zam|Uwagi|PALETA|Waga|Lp\./i.test(l));
      const effectiveEnd = Math.min(
        telEndIdx >= 0 ? telEndIdx : deliveryAnchor + 10,
        wystawilIdx >= 0 ? wystawilIdx : lines.length,
      );
      for (let i = deliveryAnchor; i < effectiveEnd && i < lines.length; i++) {
        const telM = lines[i].match(/Tel\.?:?\s*([\d\s\-]{9,})/i);
        if (telM) {
          tel = telM[1].trim();
          break;
        }
      }
    }
  }

  // 6. masa_kg — multiple strategies
  let masa_kg = 0;
  const razemIdx = lines.findIndex((l) => /^RAZEM/i.test(l));

  // Strategy A (priorytet): "Waga netto razem:" — zawsze obecne na WZ Ekonom
  const wagaIdx = lines.findIndex((l) => /Waga\s+netto\s+razem/i.test(l));
  if (wagaIdx >= 0) {
    // Liczba na tej samej linii: "Waga netto razem: 3 409,08"
    const inlineM = lines[wagaIdx].match(/Waga\s+netto\s+razem[:\s]*([\d\s]+[,.][\d]+)/i);
    if (inlineM) {
      masa_kg = Math.ceil(parseFloat(inlineM[1].replace(/\s/g, "").replace(",", ".")) || 0);
    }
    // Liczba na następnej linii (lub kilku): szukaj ostatniej z przecinkiem
    if (masa_kg === 0) {
      for (let i = wagaIdx + 1; i < Math.min(wagaIdx + 5, lines.length); i++) {
        if (/^RAZEM/i.test(lines[i])) break;
        const s = lines[i].replace(/\s/g, "");
        const m = s.match(/^([\d]+,[\d]+)$/);
        if (m) {
          masa_kg = Math.ceil(parseFloat(m[1].replace(",", ".")) || 0);
        }
      }
    }
    // Fallback: integer na następnej linii (waga bez przecinka, np. "500")
    if (masa_kg === 0) {
      for (let i = wagaIdx + 1; i < Math.min(wagaIdx + 3, lines.length); i++) {
        if (/^RAZEM/i.test(lines[i])) break;
        const s = lines[i].trim();
        if (/^\d+$/.test(s)) {
          masa_kg = parseInt(s);
          break;
        }
      }
    }
  }

  // Strategy A2: szukaj na pełnym tekście "Waga netto razem:" + liczba (multiline)
  if (masa_kg === 0) {
    const fullM = text.match(/Waga\s+netto\s+razem[:\s]*([\d\s]+[,.][\d]+)/i);
    if (fullM) {
      masa_kg = Math.ceil(parseFloat(fullM[1].replace(/\s/g, "").replace(",", ".")) || 0);
    }
  }

  // Strategy B (fallback): standalone number before "RAZEM:" line
  if (masa_kg === 0 && razemIdx > 0) {
    for (let i = razemIdx - 1; i >= Math.max(0, razemIdx - 5); i--) {
      const s = lines[i].replace(/\s/g, "");
      const m = s.match(/^([\d,.]+)$/);
      if (m) {
        const val = Math.ceil(parseFloat(m[1].replace(",", ".")));
        if (val > 0 && val < 100000) { masa_kg = val; break; }
      }
    }
  }

  // Strategy C: "RAZEM:" on same line with number (e.g. "RAZEM: 1 700,00")
  if (masa_kg === 0) {
    const razemInline = text.match(/RAZEM[:\s]+([\d\s]+[,.][\d]+)/i);
    if (razemInline) {
      masa_kg = Math.ceil(parseFloat(razemInline[1].replace(/\s/g, "").replace(",", ".")) || 0);
    }
  }

  // Strategy D: number on RAZEM line itself (e.g. "RAZEM 1700,00 kg" or "RAZEM: 63,60")
  if (masa_kg === 0 && razemIdx >= 0) {
    const razemLine = lines[razemIdx];
    const razemNum = razemLine.match(/RAZEM[:\s]*([\d\s]+[\d,.]+)\s*(?:kg)?/i);
    if (razemNum) {
      masa_kg = Math.ceil(parseFloat(razemNum[1].replace(/\s/g, "").replace(",", ".")) || 0);
    }
  }

  // Strategy E: last big number (>10) in the document before footer
  if (masa_kg === 0) {
    const footerIdx = lines.findIndex((l) => /Wystawił|Na\s+podstawie/i.test(l));
    const searchEnd = footerIdx > 0 ? footerIdx : lines.length;
    for (let i = searchEnd - 1; i >= Math.max(0, searchEnd - 20); i--) {
      const numM = lines[i].match(/([\d\s]+[,.][\d]{2})\s*(?:kg)?$/);
      if (numM) {
        const val = parseFloat(numM[1].replace(/\s/g, "").replace(",", "."));
        if (val > 10) {
          masa_kg = Math.ceil(val);
          break;
        }
      }
    }
  }

  // Strategy D: number on RAZEM line itself (e.g. "RAZEM 1700,00 kg" or "RAZEM: 63,60")
  if (masa_kg === 0 && razemIdx >= 0) {
    const razemLine = lines[razemIdx];
    const razemNum = razemLine.match(/RAZEM[:\s]*([\d\s]+[\d,.]+)\s*(?:kg)?/i);
    if (razemNum) {
      masa_kg = Math.ceil(parseFloat(razemNum[1].replace(/\s/g, "").replace(",", ".")) || 0);
    }
  }

  // Strategy E: last big number (>10) in the document before footer
  if (masa_kg === 0) {
    const footerIdx = lines.findIndex((l) => /Wystawił|Na\s+podstawie/i.test(l));
    const searchEnd = footerIdx > 0 ? footerIdx : lines.length;
    for (let i = searchEnd - 1; i >= Math.max(0, searchEnd - 20); i--) {
      const numM = lines[i].match(/([\d\s]+[,.][\d]{2})\s*(?:kg)?$/);
      if (numM) {
        const val = parseFloat(numM[1].replace(/\s/g, "").replace(",", "."));
        if (val > 10) {
          masa_kg = Math.ceil(val);
          break;
        }
      }
    }
  }

  // 7. objetosc_m3 — only from summary lines, NOT from product descriptions
  let objetosc_m3 = 0;
  for (const line of lines) {
    if (/^\d+\.\s/.test(line) || /paczka|opak|wym\s/i.test(line)) continue;
    const objM = line.match(/^([\d.,]+)\s*m[³3]$/i);
    if (objM) {
      objetosc_m3 = parseFloat(objM[1].replace(",", ".")) || 0;
      break;
    }
  }

  // 8. ilosc_palet — wyłączone (wpisywane ręcznie przez użytkownika)
  const ilosc_palet = 0;

  // 9. uwagi — text after "Uwagi:" or "Uwagi dot. wysyłki:" up to "Na podstawie art."
  //    Skip "Nr zamówienia (systemowy):" and "Nr oferty:" lines
  let uwagi: string | null = null;
  const uwagiIdx = lines.findIndex((l) => /^Uwagi(?:\s+dot\.\s+wysy[łl]ki)?\s*:/i.test(l));
  if (uwagiIdx >= 0) {
    const afterLines: string[] = [];
    for (let i = uwagiIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/Na\s+podstawie\s+art|^Wystawił/i.test(l)) break;
      if (/Nr\s+zam(?:ówienia)?\s*\(systemowy\)/i.test(l)) continue;
      if (/Nr\s+oferty/i.test(l)) continue;
      if (nr_zamowienia && l.trim() === nr_zamowienia) continue;
      afterLines.push(l);
    }
    uwagi = afterLines.join("\n").trim() || null;
  }

  // 10. osoba_kontaktowa — regex on full text (PUA decode may concatenate lines)
  let osoba_kontaktowa: string | null = null;
  const contactEntries: string[] = [];
  const osMatch = text.match(
    /Os\.\s*kontaktowa[:\s]+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\-]+)/i,
  );
  if (osMatch) {
    let entry = osMatch[1].trim();
    const afterOsFull = text.slice(text.indexOf(osMatch[0]) + osMatch[0].length);
    // Ogranicz do sekcji dostawy — stop przed Wystawił/footer/produktami
    const stopIdx = afterOsFull.search(/Wystawił|Na\s+podstawie|Lp\.\s|Magazyn\s+wydaj/i);
    const afterOs = stopIdx > -1 ? afterOsFull.slice(0, stopIdx) : afterOsFull;
    const telAfter = afterOs.match(/^[\s:]*Tel\.?\s*:?\s*([\d][\d\s\-]{7,})/i);
    if (telAfter) entry += " tel. " + telAfter[1].replace(/[^\d]/g, " ").trim().replace(/\s+/g, " ");
    contactEntries.push(entry);
    // Additional contacts: "Name tel. number" — only in delivery section
    const extras = [
      ...afterOs.matchAll(
        /([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\-]+)\s+tel\.?\s*:?\s*([\d][\d\s\-]{7,})/gi,
      ),
    ];
    for (const m of extras) {
      const name = m[1].trim();
      const phone = m[2].replace(/[^\d]/g, " ").trim().replace(/\s+/g, " ");
      if (!contactEntries.some((e) => e.includes(name))) contactEntries.push(name + " tel. " + phone);
    }
    // "p. Name number" format
    const pExtras = [...afterOs.matchAll(/p\.\s*([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)\s+([\d][\d\s\-]{7,})/gi)];
    for (const m of pExtras) {
      const name = m[1].trim();
      const phone = m[2].replace(/[^\d]/g, " ").trim().replace(/\s+/g, " ");
      if (!contactEntries.some((e) => e.includes(name))) contactEntries.push(name + " tel. " + phone);
    }
  }
  if (contactEntries.length) osoba_kontaktowa = contactEntries.join(", ");

  console.log("[parseWZText v7] debug masa:", { razemIdx, razemLine: razemIdx >= 0 ? lines[razemIdx] : null, prevLines: razemIdx > 0 ? lines.slice(Math.max(0, razemIdx - 3), razemIdx) : [] });
  console.log("[parseWZText v7] result:", {
    numer_wz,
    nr_zamowienia,
    odbiorca,
    adres,
    tel,
    osoba_kontaktowa,
    masa_kg,
    ilosc_palet,
    objetosc_m3,
    uwagi,
  });

  // Sprawdź czy adres dostawy = adres siedziby (zawarty w odbiorca)
  // Jeśli tak — to nie jest prawdziwy adres dostawy, wyczyść
  if (adres && odbiorca && odbiorca.includes(adres.split(',')[0].trim())) {
    adres = null;
  }

  // Jeśli JEST sekcja "Adres dostawy" I mamy PRAWDZIWY adres dostawy — obetnij adres z odbiorca
  if (hasDeliverySection && adres && odbiorca) {
    // Wyczyść adres dostawy z odbiorca jeśli się powtarza
    if (odbiorca.includes(adres)) {
      odbiorca = odbiorca.replace(adres, '').replace(/,\s*,/g, ',').replace(/,\s*$/, '').replace(/^\s*,/, '').trim();
    }
    // Obetnij adres siedziby (ul./al./os./pl. + kod pocztowy)
    const ulMatch = odbiorca.match(/,\s*(?:ul|al|os|pl)\.\s/i);
    if (ulMatch && ulMatch.index != null) {
      odbiorca = odbiorca.substring(0, ulMatch.index).trim();
    }
  }
  // Jeśli BRAK adresu dostawy — dołącz adres siedziby do odbiorcy
  if (!adres && odbiornikAdres && odbiorca && !odbiorca.includes(odbiornikAdres)) {
    odbiorca = odbiorca + "\n" + odbiornikAdres;
  }

  // Wyciągnij adres z uwag jako fallback (szukaj "ul./al./os./pl." w uwagach)
  if (!adres && uwagi) {
    const uwagiLines = uwagi.split(/[\n]/).map(l => l.trim()).filter(Boolean);
    for (const line of uwagiLines) {
      if (/(?:ul|al|os|pl)\.\s*\S/i.test(line)) {
        adres = line.replace(/^tel[:\s].*/i, '').replace(/^transport[:\s].*/i, '').trim();
        if (adres) break;
      }
    }
  }

  // Wyciągnij telefony z uwag (zawsze, niezależnie od sekcji adresu)
  if (uwagi && !tel) {
    const uwagiLines = uwagi.split(/[\n,]/).map(l => l.trim()).filter(Boolean);
    const phoneNumbers: string[] = [];
    for (const line of uwagiLines) {
      const phoneRegex = /(\d{3}\s?\d{3}\s?\d{3})/g;
      let pm;
      while ((pm = phoneRegex.exec(line)) !== null) {
        const digits = pm[1].replace(/\s/g, '');
        if (digits.length === 9) {
          phoneNumbers.push(digits.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'));
        }
      }
    }
    if (phoneNumbers.length > 0) {
      tel = phoneNumbers.join(', ');
    }
  }
  // Uwagi — ZAWSZE zachowuj (nigdy nie zeruj)

  return {
    numer_wz,
    nr_zamowienia,
    odbiorca,
    adres,
    tel,
    osoba_kontaktowa,
    masa_kg,
    ilosc_palet,
    objetosc_m3,
    uwagi,
    typ_dokumentu: "WZ" as string | null,
    ma_adres_dostawy: false,
  };
}

/* ─── Paste Tab ─── */
function PasteTab({ onParsed, prefillText }: { onParsed: (d: WZImportData) => void; prefillText?: string }) {
  const [text, setText] = useState(prefillText || "");
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<WZImportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodedPreview, setDecodedPreview] = useState<string>("");

  // Update text when prefillText changes (e.g. from OCR → Paste switch)
  const prevPrefill = useRef(prefillText);
  if (prefillText && prefillText !== prevPrefill.current) {
    prevPrefill.current = prefillText;
    setText(prefillText);
  }

  const hasPUA = Array.from(text).some((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0x10000;
  });

  const parse = () => {
    if (text.length === 0) return;
    setParsing(true);
    setError(null);
    setResult(null);

    const decoded = decodePUA(text);
    setDecodedPreview(decoded.slice(0, 200));
    console.log("[PasteTab v8] raw chars:", text.length, "| PUA:", hasPUA, "| decoded preview:", decoded.slice(0, 150));

    // Only local parser — no edge function (edge function has stale parseSeweraDoc)
    const local = parseWZText(text);
    setResult(local);
    setParsing(false);
  };

  return (
    <div className="space-y-3">
      <Textarea
        className="min-h-[120px]"
        placeholder="Wklej tekst z dokumentu WZ — system wyciągnie nr WZ, odbiorcę, masę, adres..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {hasPUA && (
        <p className="text-xs text-blue-600 dark:text-blue-400">
          🔑 Wykryto znaki PUA (font PDF) — zostaną zdekodowane
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={parse} disabled={text.length === 0 || parsing} size="sm">
          {parsing ? "Analizuję..." : "Parsuj tekst"}
        </Button>
        <span className="text-xs text-muted-foreground">parser v5</span>
      </div>
      {decodedPreview && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Podgląd zdekodowanego tekstu</summary>
          <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded max-h-28 overflow-auto mt-1">
            {decodedPreview}
          </pre>
        </details>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2 pt-2 border-t">
          {(
            [
              ["Nr WZ", result.numer_wz],
              ["Nr zamówienia", result.nr_zamowienia],
              ["Odbiorca", result.odbiorca],
              ["Adres", result.adres],
              ["Os. kontaktowa", result.osoba_kontaktowa],
              ["Masa kg", formatMasaKg(result.masa_kg)],
              ["Ilość palet", result.ilosc_palet?.toString()],
              ["Objętość m³", result.objetosc_m3?.toString()],
              ["Uwagi", result.uwagi],
            ] as [string, string | undefined | null][]
          ).map(([label, val]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span className="w-4">{val ? "✓" : "⚠️"}</span>
              <span className="text-muted-foreground w-28">{label}</span>
              <span className="font-medium">{val || "—"}</span>
            </div>
          ))}
          <Button onClick={() => onParsed(result)} className="w-full mt-2">
            ✅ Użyj tych danych
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Manual Tab ─── */
function ManualTab({ onParsed }: { onParsed: (d: WZImportData) => void }) {
  const [form, setForm] = useState<WZImportData>({
    numer_wz: "",
    nr_zamowienia: "",
    odbiorca: "",
    adres: "",
    tel: "",
    osoba_kontaktowa: null,
    masa_kg: 0,
    ilosc_palet: null,
    objetosc_m3: null,
    uwagi: "",
    typ_dokumentu: "WZ",
    ma_adres_dostawy: false,
  });

  const update = (field: keyof WZImportData, val: string | number | null) =>
    setForm((prev) => ({ ...prev, [field]: val }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nr WZ</Label>
          <Input
            className="h-8 text-sm"
            value={form.numer_wz ?? ""}
            onChange={(e) => update("numer_wz", e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Nr zamówienia</Label>
          <Input
            className="h-8 text-sm"
            value={form.nr_zamowienia ?? ""}
            onChange={(e) => update("nr_zamowienia", e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Odbiorca *</Label>
          <Input
            className="h-8 text-sm"
            value={form.odbiorca ?? ""}
            onChange={(e) => update("odbiorca", e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Adres *</Label>
          <Input className="h-8 text-sm" value={form.adres ?? ""} onChange={(e) => update("adres", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Telefon</Label>
          <Input className="h-8 text-sm" value={form.tel ?? ""} onChange={(e) => update("tel", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Masa kg *</Label>
          <Input
            className="h-8 text-sm"
            type="number"
            value={form.masa_kg ?? ""}
            onChange={(e) => update("masa_kg", Number(e.target.value))}
          />
        </div>
        <div>
          <Label className="text-xs">Ilość palet</Label>
          <Input
            className="h-8 text-sm"
            type="number"
            value={form.ilosc_palet ?? ""}
            onChange={(e) => update("ilosc_palet", e.target.value ? Number(e.target.value) : 0)}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">Uzupełnij jeśli brak na dokumencie</p>
        </div>
        <div>
          <Label className="text-xs">Objętość m³</Label>
          <Input
            className="h-8 text-sm"
            type="number"
            value={form.objetosc_m3 ?? ""}
            onChange={(e) => update("objetosc_m3", e.target.value ? Number(e.target.value) : 0)}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">Uzupełnij jeśli brak na dokumencie</p>
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Uwagi</Label>
          <Input className="h-8 text-sm" value={form.uwagi ?? ""} onChange={(e) => update("uwagi", e.target.value)} />
        </div>
      </div>
      <Button onClick={() => onParsed(form)} disabled={!form.odbiorca && !form.adres} className="w-full">
        ✅ Użyj tych danych
      </Button>
    </div>
  );
}

/* ─── OCR Tab (dedicated camera/photo) ─── */
function OcrTab({ onParsed, onSwitchPaste }: { onParsed: (d: WZImportData) => void; onSwitchPaste: (text: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [result, setResult] = useState<ParsedPdfResult | null>(null);
  const [formData, setFormData] = useState<WZImportData | null>(null);
  const [rawOcrText, setRawOcrText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleImage = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    const isImage = name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")
      || name.endsWith(".heic") || name.endsWith(".webp");
    if (!isImage) {
      setError("Wymagane zdjęcie (PNG, JPG, HEIC, WebP).");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Plik za duży (max 15 MB)");
      return;
    }

    setParsing(true);
    setError(null);
    setResult(null);
    setFormData(null);
    setRawOcrText("");
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
      setRawOcrText(ocrText || "");

      if (!ocrText || ocrText.trim().length < 20) {
        setError("Nie udało się rozpoznać tekstu ze zdjęcia.");
        return;
      }

      console.log("[OcrTab] extracted text:\n", ocrText.substring(0, 500));
      const mapped = parseWZText(ocrText);

      setResult({
        nr_wz: mapped.numer_wz, nr_zamowienia: mapped.nr_zamowienia,
        odbiorca_nazwa: mapped.odbiorca, odbiorca: mapped.odbiorca,
        odbiorca_adres_siedziby: null, adres_dostawy: mapped.adres,
        nazwa_budowy: null, osoba_kontaktowa: mapped.osoba_kontaktowa,
        tel: mapped.tel, tel2: null, masa_kg: mapped.masa_kg,
        ilosc_palet: mapped.ilosc_palet, objetosc_m3: mapped.objetosc_m3,
        uwagi: mapped.uwagi, pozycje: [], pewnosc: 60,
        uwagi_krotkie: null, data_wz: null,
      });
      setFormData(mapped);
    } catch (e: any) {
      setParsing(false);
      setError("Błąd OCR: " + (e.message || "nieznany"));
    }
  }, []);

  return (
    <div className="space-y-3 pt-2">
      {!result && !parsing && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {/* Camera button (mobile) */}
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => cameraRef.current?.click()}
            >
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); }}
              />
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm font-medium text-muted-foreground">Zrób zdjęcie</p>
              <p className="text-xs text-muted-foreground mt-1">Aparat telefonu</p>
            </div>

            {/* File picker */}
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImage(f); }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/heic,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); }}
              />
              <div className="text-3xl mb-2">🖼️</div>
              <p className="text-sm font-medium text-muted-foreground">Wybierz plik</p>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG, HEIC, WebP</p>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}

      {/* Progress bar */}
      {parsing && (
        <div className="space-y-2 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{progressMsg}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div
              className="bg-primary h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* OCR result preview */}
      {result && formData && (
        <div className="space-y-3">
          <ConfidenceBadge pewnosc={result.pewnosc} totalFields={16} />

          <div className="space-y-2 text-sm">
            {formData.numer_wz && <div><span className="text-muted-foreground">Nr WZ:</span> <strong className="font-mono">{formData.numer_wz}</strong></div>}
            {formData.nr_zamowienia && <div><span className="text-muted-foreground">Nr zam.:</span> <strong className="font-mono">{formData.nr_zamowienia}</strong></div>}
            {formData.odbiorca && <div><span className="text-muted-foreground">Odbiorca:</span> <strong>{formData.odbiorca}</strong></div>}
            {formData.adres && <div><span className="text-muted-foreground">Adres:</span> {formData.adres}</div>}
            {formData.tel && <div><span className="text-muted-foreground">Tel:</span> {formData.tel}</div>}
            {formData.osoba_kontaktowa && <div><span className="text-muted-foreground">Os. kontaktowa:</span> {formData.osoba_kontaktowa}</div>}
            {formData.masa_kg != null && <div><span className="text-muted-foreground">Masa:</span> {formData.masa_kg} kg</div>}
            {formData.uwagi && <div><span className="text-muted-foreground">Uwagi:</span> {formData.uwagi}</div>}
          </div>

          <div className="flex gap-2">
            <Button onClick={() => onParsed(formData)} className="flex-1">
              Importuj WZ
            </Button>
            <Button
              variant="outline"
              onClick={() => onSwitchPaste(rawOcrText)}
              className="text-xs"
            >
              Popraw tekst
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setResult(null); setFormData(null); setError(null); }}
              className="text-xs"
            >
              Nowe zdjęcie
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Modal ─── */
export function ModalImportWZ({ isOpen, onClose, onImport, hideXls }: Props) {
  const [activeTab, setActiveTab] = useState("pdf");
  const [prefillPasteText, setPrefillPasteText] = useState("");

  const handleSingle = useCallback(
    (d: WZImportData) => {
      onImport([d]);
      onClose();
    },
    [onImport, onClose],
  );

  const handleMulti = useCallback(
    (data: WZImportData[]) => {
      onImport(data);
      onClose();
    },
    [onImport, onClose],
  );

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>📥 Import WZ</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v !== "paste") setPrefillPasteText(""); }}>
          <TabsList className="w-full">
            <TabsTrigger value="pdf" className="flex-1 text-xs">
              PDF
            </TabsTrigger>
            <TabsTrigger value="ocr" className="flex-1 text-xs">
              OCR
            </TabsTrigger>
            {!hideXls && (
              <TabsTrigger value="xls" className="flex-1 text-xs">
                XLS
              </TabsTrigger>
            )}
            <TabsTrigger value="paste" className="flex-1 text-xs">
              Wklej
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex-1 text-xs">
              Ręcznie
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pdf">
            <PdfTab onParsed={handleSingle} onSwitchManual={() => setActiveTab("manual")} />
          </TabsContent>
          <TabsContent value="ocr">
            <OcrTab onParsed={handleSingle} onSwitchPaste={(text) => { setPrefillPasteText(text); setActiveTab("paste"); }} />
          </TabsContent>
          {!hideXls && (
            <TabsContent value="xls">
              <XlsTab onParsed={handleMulti} />
            </TabsContent>
          )}
          <TabsContent value="paste">
            <PasteTab onParsed={handleSingle} prefillText={prefillPasteText} />
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
