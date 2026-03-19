import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as XLSX from "npm:xlsx@0.18.5/xlsx.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TYP_MAP: Record<string, string | null> = {
  A: null,
  B: "Dostawczy 1,2t",
  C: "Winda 1,8t",
  D: "Winda 6,3t",
  E: "Winda MAX 15,8t",
  F: "HDS 11,7t",
  G: "HDS 11,7t",
  H: "HDS 8,9t",
  I: "HDS 8,9t",
};

// Header synonyms → canonical field
const HEADER_PATTERNS: { patterns: RegExp[]; field: string }[] = [
  { patterns: [/^kierowca$/i, /^kier$/i], field: "kierowca" },
  { patterns: [/^kurs$/i], field: "kurs" },
  { patterns: [/^kod$/i, /^nr\s*indeksu$/i], field: "kod" },
  {
    patterns: [/^nazwa\s*kontrahenta$/i, /^kontrahent$/i],
    field: "odbiorca",
  },
  { patterns: [/^miejscowo/i, /^miasto$/i], field: "miasto" },
  { patterns: [/^ulica$/i, /^adres$/i], field: "ulica" },
  { patterns: [/^nr\s*wz$/i, /^wz$/i], field: "nr_wz" },
  { patterns: [/^masa$/i, /^waga$/i], field: "masa" },
  {
    patterns: [
      /^typ\s*samochodu$/i,
      /^rodzaj\s*samochodu$/i,
      /^klasyfikacja$/i,
      /^typ$/i,
    ],
    field: "typ",
  },
  { patterns: [/^rodzaj\s*dostawy$/i], field: "rodzaj_dostawy" },
  { patterns: [/^uwagi/i], field: "uwagi" },
];

function matchHeader(h: string): string | null {
  const t = (h || "").trim();
  for (const hp of HEADER_PATTERNS) {
    for (const p of hp.patterns) {
      if (p.test(t)) return hp.field;
    }
  }
  return null;
}

function extractNrRej(name: string): string | null {
  const m = name.match(/[A-Z]{2}\d{4,5}[A-Z]/);
  return m ? m[0] : null;
}

function extractKierowcaName(raw: string): string {
  // e.g. "GRZEGORZ K 5,8 T WNDA SK1035N" → "GRZEGORZ K"
  // Remove nr rej pattern
  let name = raw.replace(/[A-Z]{2}\d{4,5}[A-Z]/g, "").trim();
  // Remove vehicle specs like "5,8 T WNDA", "6,3T", etc.
  name = name.replace(/\d+[,.]\d+\s*T\s*(WNDA|HDS|DOST)?/gi, "").trim();
  // Remove trailing whitespace/dots
  name = name.replace(/\s+/g, " ").trim();
  return name || raw;
}

function mapGodzinaToSlot(timeStr: string): string | null {
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const minutes = parseInt(m[1]) * 60 + parseInt(m[2]);
  if (minutes <= 450) return "do 8:00"; // ≤7:30
  if (minutes <= 570) return "do 10:00"; // ≤9:30
  if (minutes <= 690) return "do 12:00"; // ≤11:30
  if (minutes <= 810) return "do 14:00"; // ≤13:30
  return "do 16:00";
}

interface ParsedZlecenie {
  nr_wz: string | null;
  odbiorca: string | null;
  miasto: string | null;
  ulica: string | null;
  adres_pelny: string | null;
  masa_kg: number | null;
  rodzaj_dostawy: string | null;
  uwagi: string | null;
  godzina_dostawy: string | null;
}

interface ParsedKurs {
  nr_kursu_w_pliku: string;
  kierowca_nazwa: string;
  kierowca_nr_rej: string | null;
  typ_pojazdu_kod: string | null;
  typ_pojazdu: string | null;
  zlecenia: ParsedZlecenie[];
  suma_kg: number;
  liczba_wz: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return new Response(
        JSON.stringify({ error: "Wymagany multipart/form-data z plikiem" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: "Brak pliku" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileName = file.name.toLowerCase();
    if (
      !fileName.endsWith(".xls") &&
      !fileName.endsWith(".xlsx") &&
      !fileName.endsWith(".csv")
    ) {
      return new Response(
        JSON.stringify({ error: "Nieobsługiwany format. Wymagany XLS/XLSX." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });

    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: "Plik jest pusty", kursy: [], pewnosc: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Find header row
    let headerIdx = -1;
    const colMap = new Map<number, string>();

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const tempMap = new Map<number, string>();
      for (let j = 0; j < (rows[i]?.length || 0); j++) {
        const field = matchHeader(String(rows[i][j] || ""));
        if (field) tempMap.set(j, field);
      }
      if (tempMap.size >= 3) {
        headerIdx = i;
        tempMap.forEach((v, k) => colMap.set(k, v));
        break;
      }
    }

    if (headerIdx === -1) {
      return new Response(
        JSON.stringify({
          error: "Nie rozpoznano nagłówków kolumn",
          kursy: [],
          pewnosc: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build field→colIdx reverse map
    const fieldCol: Record<string, number> = {};
    colMap.forEach((field, idx) => {
      fieldCol[field] = idx;
    });

    const get = (row: any[], field: string): string => {
      const idx = fieldCol[field];
      if (idx === undefined) return "";
      return String(row[idx] ?? "").trim();
    };

    const getNum = (row: any[], field: string): number | null => {
      const v = get(row, field);
      if (!v) return null;
      const n = parseFloat(v.replace(",", "."));
      return isNaN(n) ? null : n;
    };

    // Parse rows into courses
    const kursy: ParsedKurs[] = [];
    const bledy: string[] = [];
    let currentKurs: ParsedKurs | null = null;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c: any) => !c && c !== 0)) continue;

      const kursVal = get(row, "kurs");
      const kierowcaVal = get(row, "kierowca");
      const nrWz = get(row, "nr_wz");
      const odbiorca = get(row, "odbiorca");
      const masa = getNum(row, "masa");
      const typKod = get(row, "typ").toUpperCase().trim();

      // Detect summary rows (no WZ, no odbiorca)
      if (!nrWz && !odbiorca && masa !== null) continue;
      if (!nrWz && !odbiorca) continue;

      // New course when kurs or kierowca changes
      const isNewKurs =
        (kursVal && kursVal !== currentKurs?.nr_kursu_w_pliku) ||
        (kierowcaVal && kierowcaVal !== currentKurs?.kierowca_nazwa);

      if (isNewKurs && (kursVal || kierowcaVal)) {
        const typCode = typKod.charAt(0);
        const mappedTyp = TYP_MAP[typCode] ?? null;

        if (typCode === "A") {
          bledy.push(`Wiersz ${i + 1}: typ A pominięty (nieobsługiwany)`);
        }

        currentKurs = {
          nr_kursu_w_pliku: kursVal || `KURS-${kursy.length + 1}`,
          kierowca_nazwa: kierowcaVal
            ? extractKierowcaName(kierowcaVal)
            : "Nieznany",
          kierowca_nr_rej: kierowcaVal
            ? extractNrRej(kierowcaVal)
            : null,
          typ_pojazdu_kod: typCode || null,
          typ_pojazdu: typCode === "A" ? null : mappedTyp,
          zlecenia: [],
          suma_kg: 0,
          liczba_wz: 0,
        };
        kursy.push(currentKurs);
      }

      if (!currentKurs) {
        // Create default course for orphan rows
        currentKurs = {
          nr_kursu_w_pliku: "KURS-1",
          kierowca_nazwa: kierowcaVal
            ? extractKierowcaName(kierowcaVal)
            : "Nieznany",
          kierowca_nr_rej: kierowcaVal ? extractNrRej(kierowcaVal) : null,
          typ_pojazdu_kod: null,
          typ_pojazdu: null,
          zlecenia: [],
          suma_kg: 0,
          liczba_wz: 0,
        };
        kursy.push(currentKurs);
      }

      const miasto = get(row, "miasto");
      const ulica = get(row, "ulica");
      const rodzajDostawy = get(row, "rodzaj_dostawy");
      const uwagi = get(row, "uwagi");

      const adresPelny = [ulica, miasto].filter(Boolean).join(", ");
      const godzinaDostawy = rodzajDostawy
        ? mapGodzinaToSlot(rodzajDostawy)
        : null;

      const zlecenie: ParsedZlecenie = {
        nr_wz: nrWz || null,
        odbiorca: odbiorca || null,
        miasto: miasto || null,
        ulica: ulica || null,
        adres_pelny: adresPelny || null,
        masa_kg: masa,
        rodzaj_dostawy: rodzajDostawy || null,
        uwagi: uwagi || null,
        godzina_dostawy: godzinaDostawy,
      };

      currentKurs.zlecenia.push(zlecenie);
      if (masa) currentKurs.suma_kg += masa;
      currentKurs.liczba_wz++;
    }

    // Calculate confidence
    const totalWz = kursy.reduce((s, k) => s + k.liczba_wz, 0);
    const fieldsFound = Object.keys(fieldCol).length;
    const pewnosc = Math.min(
      100,
      Math.round((fieldsFound / 11) * 50 + (totalWz > 0 ? 50 : 0))
    );

    const result = {
      kursy,
      data_pliku: null as string | null,
      oddzial: null as string | null,
      liczba_kursow: kursy.length,
      liczba_wz: totalWz,
      bledy,
      pewnosc,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Błąd: " + (err as Error).message,
        kursy: [],
        pewnosc: 0,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
