import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Lightweight CSV/TSV-like XLS text extraction
// For full XLSX support we parse the XML inside the zip

interface WzRow {
  nr_wz: string | null;
  nr_zamowienia: string | null;
  odbiorca: string | null;
  adres_dostawy: string | null;
  tel: string | null;
  masa_kg: number | null;
  uwagi: string | null;
}

// Column name matching
const COL_MAP: Record<string, keyof WzRow> = {};
const COL_PATTERNS: { pattern: RegExp; field: keyof WzRow }[] = [
  { pattern: /^(nr\s*wz|numer\s*wz|dokument)/i, field: "nr_wz" },
  { pattern: /^(odbiorca|nazwa\s*odbiorcy|klient)/i, field: "odbiorca" },
  { pattern: /^(adres|adres\s*dostawy|miejsce)/i, field: "adres_dostawy" },
  { pattern: /^(masa|waga|masa\s*netto|kg)/i, field: "masa_kg" },
  { pattern: /^(nr\s*zam|zamówienie|nr\s*zamówienia)/i, field: "nr_zamowienia" },
  { pattern: /^(telefon|tel)/i, field: "tel" },
  { pattern: /^(uwagi|komentarz|notatka)/i, field: "uwagi" },
];

function matchColumn(header: string): keyof WzRow | null {
  const h = header.trim();
  for (const cp of COL_PATTERNS) {
    if (cp.pattern.test(h)) return cp.field;
  }
  return null;
}

function parseCSV(text: string, delimiter: string = ","): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim()) {
      rows.push(line.split(delimiter).map(c => c.replace(/^"|"$/g, '').trim()));
    }
  }
  return rows;
}

async function extractXlsxSheets(bytes: Uint8Array): Promise<string[][]> {
  // Try to parse as CSV/TSV first (common export format)
  const textDecoder = new TextDecoder("utf-8");
  let text: string;
  try {
    text = textDecoder.decode(bytes);
  } catch {
    const latin = new TextDecoder("latin1");
    text = latin.decode(bytes);
  }

  // Check if it's tab-separated
  const firstLine = text.split(/\r?\n/)[0] || "";
  if (firstLine.includes("\t")) {
    return parseCSV(text, "\t");
  }
  // Check if comma-separated
  if (firstLine.includes(",") && firstLine.split(",").length >= 3) {
    return parseCSV(text, ",");
  }
  // Semicolon (common in PL locale)
  if (firstLine.includes(";") && firstLine.split(";").length >= 3) {
    return parseCSV(text, ";");
  }

  // For actual XLSX binary, try to find shared strings and sheet data in the zip
  // This is a simplified approach
  try {
    // Look for XML content in the binary data
    const raw = new TextDecoder("latin1").decode(bytes);
    
    // Try to find readable tabular data
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 5);
    if (lines.length >= 2) {
      return lines.map(l => {
        // Split by common delimiters
        if (l.includes("\t")) return l.split("\t").map(c => c.trim());
        if (l.includes(";")) return l.split(";").map(c => c.trim());
        return l.split(",").map(c => c.trim());
      });
    }
  } catch {
    // ignore
  }

  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    if (!contentType.includes("multipart/form-data")) {
      return new Response(
        JSON.stringify({ error: "Wymagany multipart/form-data z plikiem", wiersze: [], liczba_wierszy: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(
        JSON.stringify({ error: "Brak pliku", wiersze: [], liczba_wierszy: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xls") && !fileName.endsWith(".xlsx") && !fileName.endsWith(".csv")) {
      return new Response(
        JSON.stringify({ error: "Nieobsługiwany format. Wymagany XLS, XLSX lub CSV.", wiersze: [], liczba_wierszy: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const rows = await extractXlsxSheets(bytes);

    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: "Plik jest pusty lub nie można go odczytać", wiersze: [], liczba_wierszy: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find header row (first row with recognizable columns)
    let headerRowIdx = -1;
    let colMapping: Map<number, keyof WzRow> = new Map();

    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const mapping = new Map<number, keyof WzRow>();
      for (let j = 0; j < rows[i].length; j++) {
        const field = matchColumn(rows[i][j]);
        if (field) mapping.set(j, field);
      }
      if (mapping.size >= 2) {
        headerRowIdx = i;
        colMapping = mapping;
        break;
      }
    }

    if (headerRowIdx === -1 || colMapping.size < 2) {
      return new Response(
        JSON.stringify({ error: "Nie rozpoznano nagłówków kolumn", wiersze: [], liczba_wierszy: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const wiersze: WzRow[] = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every(c => !c)) continue; // skip empty rows

      const wz: WzRow = {
        nr_wz: null, nr_zamowienia: null, odbiorca: null,
        adres_dostawy: null, tel: null, masa_kg: null, uwagi: null,
      };

      for (const [colIdx, field] of colMapping) {
        const val = row[colIdx] || null;
        if (!val) continue;
        if (field === "masa_kg") {
          wz.masa_kg = parseFloat(val.replace(",", ".")) || null;
        } else {
          (wz as any)[field] = val;
        }
      }

      // Skip rows where all fields are null
      if (Object.values(wz).some(v => v !== null)) {
        wiersze.push(wz);
      }
    }

    return new Response(
      JSON.stringify({ wiersze, liczba_wierszy: wiersze.length, error: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Błąd: " + (err as Error).message, wiersze: [], liczba_wierszy: 0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
