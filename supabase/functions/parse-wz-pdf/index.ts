import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u017E\n\r\t]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\n\s*){3,}/g, '\n\n');
}

function ext(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
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

function parseEkonomWz(text: string) {
  let found = 0;
  const total = 16;
  const lines = text.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);

  // 1. nr_wz — always include "WZ " prefix
  let nr_wz: string | null = null;
  const wzM = text.match(/WZ\s+([A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/);
  if (wzM) {
    nr_wz = `WZ ${wzM[1]}`;
    found++;
  } else {
    const wzBare = text.match(/([A-Z]{2}\/\d{2,3}\/\d{2}\/\d{2}\/\d{5,})/);
    if (wzBare) { nr_wz = `WZ ${wzBare[1]}`; found++; }
  }

  // 2. nr_zamowienia — supports BR/, T7/, R7/ etc.
  let nr_zamowienia = ext(text, [
    /Nr\s+zam(?:ówienia)?(?:\s*\(systemowy\))?[:\s\]]+([A-Z0-9\/]+)/i,
    /([A-Z]{1,2}\d?\/[A-Z]{2}\/\d{4}\/\d{2}\/\d+)/,
  ]);
  if (nr_zamowienia) found++;

  // 3. odbiorca — SKIP SEWERA block, find second company
  let odbiorca_nazwa: string | null = null;
  let odbiorca_adres_siedziby: string | null = null;
  const SELLER_MARKERS = /SEWERA|KOŚCIUSZKI\s*326|NR\s*BDO:\s*000044503/i;
  const SKIP_LINES = [
    SELLER_MARKERS, /ODDZIAŁ/i, /^ul\./i, /^al\./i, /^os\./i, /^pl\./i,
    /NIP:/i, /NR BDO:/i, /Adres\s+dostawy/i, /Waga\s+netto/i,
    /Nr\s+zam/i, /PALETA/i, /Tel\./i, /Os\.\s*kontaktowa/i,
    /^\d{2}-\d{3}/, /Katowice,\s*\d/, /Uwagi/i, /kontaktowa/i,
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
    if (SKIP_LINES.some((p: RegExp) => p.test(line))) continue;
    const hasLegalForm = /SPÓŁKA|SP\.\s*K|SP\.\s*Z|S\.A\.|Sp\.\s*z\s*o\.o\./i.test(line);
    const capsWords = line.split(/\s+/).filter((w: string) => /^[A-ZĄĆĘŁŃÓŚŹŻ\-]{2,}$/.test(w)).length;
    if (hasLegalForm || capsWords >= 3) {
      odbiorca_nazwa = line;
      found++;
      // Next line with address = odbiorca_adres_siedziby
      if (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (/ul\.|al\.|os\.|pl\./i.test(next) || /\d{2}-\d{3}/.test(next)) {
          odbiorca_adres_siedziby = next;
          found++;
        }
      }
      break;
    }
  }

  // 5. adres_dostawy + 6. nazwa_budowy
  let adres_dostawy: string | null = null;
  let nazwa_budowy: string | null = null;
  const adresIdx = lines.findIndex((l: string) => /^Adres\s+dostawy$/i.test(l));
  if (adresIdx >= 0) {
    const addrLines: string[] = [];
    for (let i = adresIdx + 1; i < lines.length && i <= adresIdx + 8; i++) {
      const l = lines[i];
      if (/^(Os\.\s*kontaktowa|Tel\.|Nr\s+zam|PALETA|Waga|Uwagi)/i.test(l)) break;
      if (/^Budowa/i.test(l)) { nazwa_budowy = l; found++; continue; }
      if (/ul\.|al\.|os\.|pl\./i.test(l) || /\d{2}-\d{3}/.test(l) || addrLines.length > 0) {
        addrLines.push(l);
      }
    }
    if (addrLines.length > 0) {
      adres_dostawy = addrLines.join(', ');
      found++;
    }
  }
  // Fallback: use odbiorca address
  if (!adres_dostawy && odbiorca_adres_siedziby) {
    adres_dostawy = odbiorca_adres_siedziby;
    found++;
  }

  // 7. osoba_kontaktowa
  const osoba_kontaktowa = ext(text, [
    /Os\.\s*kontaktowa[:\s]*(.+?)(?:\n|Tel|$)/i,
    /Osoba\s+kontaktowa[:\s]*(.+?)(?:\n|Tel|$)/i,
  ]);
  if (osoba_kontaktowa) found++;

  // 8. tel — ONLY from "Adres dostawy" section, NOT footer
  let tel: string | null = null;
  const wystawilIdx = lines.findIndex((l: string) => /Wystawił/i.test(l));
  if (adresIdx >= 0) {
    const telEndIdx = lines.findIndex((l: string, i: number) => i > adresIdx && /Nr\s+zam|Uwagi|PALETA|Waga/i.test(l));
    const effectiveEnd = Math.min(
      telEndIdx >= 0 ? telEndIdx : adresIdx + 10,
      wystawilIdx >= 0 ? wystawilIdx : lines.length
    );
    for (let i = adresIdx; i < effectiveEnd && i < lines.length; i++) {
      const telM = lines[i].match(/Tel\.?:?\s*([\d\s]{9,})/i);
      if (telM) { tel = telM[1].replace(/\s+/g, ' ').trim(); found++; break; }
    }
  }

  // 9. tel2 — second phone in delivery section
  let tel2: string | null = null;
  const telMatches = [...text.matchAll(/(?:Tel\.?|p\.)\s*:?\s*(?:[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]+\s+)?([\d\s]{9,15})/gi)];
  if (telMatches.length >= 2) {
    tel2 = telMatches[1][1].replace(/\s+/g, ' ').trim();
    found++;
  }

  // 10. pozycje_towarowe
  const pozycje: Pozycja[] = [];
  const rowRegex = /(\d+)\s+(\d{4,8})\s*(?:\(([^)]*)\))?\s*(?:(\d{13}))?\s+(.+?)\s+(\d+[.,]?\d*)\s+(SZT|KG|M|MB|M2|M3|KPL|OP|PAL|T)/gi;
  let rm;
  while ((rm = rowRegex.exec(text)) !== null) {
    const nazwaFull = rm[5].trim();
    const nameParts = nazwaFull.split(/\n/);
    pozycje.push({
      lp: parseInt(rm[1]),
      kod_towaru: rm[2],
      kod_producenta: rm[3] || '',
      kod_ean: rm[4] || '',
      nazwa_towaru: nameParts[0]?.trim() || nazwaFull,
      nazwa_dodatkowa: nameParts.slice(1).join(' ').trim(),
      ilosc: parseFloat(rm[6].replace(',', '.')),
      jm: rm[7].toUpperCase(),
    });
  }
  if (pozycje.length === 0) {
    const simpleRowRegex = /^\s*(\d+)\s+(\d{4,8})\b/gm;
    let sr;
    while ((sr = simpleRowRegex.exec(text)) !== null) {
      const afterMatch = text.slice(sr.index, sr.index + 500);
      const iloscJm = afterMatch.match(/([\d.,]+)\s+(SZT|KG|M|MB|M2|M3|KPL|OP|PAL|T)\b/i);
      const nameM = afterMatch.match(/\d{4,8}\s*(?:\([^)]*\))?\s*(?:\d{13}\s+)?(.+?)(?:\d+[.,]\d*\s+(?:SZT|KG|M))/is);
      pozycje.push({
        lp: parseInt(sr[1]),
        kod_towaru: sr[2],
        kod_producenta: '',
        kod_ean: '',
        nazwa_towaru: nameM?.[1]?.split('\n')[0]?.trim() || '',
        nazwa_dodatkowa: '',
        ilosc: iloscJm ? parseFloat(iloscJm[1].replace(',', '.')) : 0,
        jm: iloscJm?.[2]?.toUpperCase() || '',
      });
    }
  }
  if (pozycje.length > 0) found++;

  // 11. masa_kg — ONLY "Waga netto razem", NEVER "RAZEM:" (that's item count)
  let masa_kg: number | null = null;
  const masaM = text.match(/Waga\s+netto\s+razem[:\s]*([\d\s,.]+)/i);
  if (masaM) {
    masa_kg = Math.ceil(parseFloat(masaM[1].replace(/\s/g, '').replace(',', '.')));
    found++;
  }

  // 12 + 13. uwagi / uwagi_krotkie — collect after "Uwagi:" up to "Na podstawie art."
  let uwagi: string | null = null;
  let uwagi_krotkie: string | null = null;
  const uwagiLineIdx = lines.findIndex((l: string) => /^Uwagi\s*:/i.test(l));
  if (uwagiLineIdx >= 0) {
    const afterLines: string[] = [];
    for (let i = uwagiLineIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/Na\s+podstawie\s+art/i.test(l)) break;
      if (/Nr\s+zam(?:ówienia)?\s*\(systemowy\)/i.test(l)) continue;
      if (/Nr\s+oferty/i.test(l)) continue;
      if (nr_zamowienia && l.trim() === nr_zamowienia) continue;
      afterLines.push(l);
    }
    uwagi_krotkie = afterLines.join('\n').trim() || null;
    uwagi = uwagi_krotkie;
    if (uwagi) found++;
    // Also extract nr_zamowienia from uwagi section if not found
    if (!nr_zamowienia) {
      const uwagiSection = lines.slice(uwagiLineIdx, uwagiLineIdx + 5).join('\n');
      const zamFromUwagi = uwagiSection.match(/([A-Z]{1,2}\d?\/[A-Z]{2}\/\d{4}\/\d{2}\/\d+)/);
      if (zamFromUwagi) { nr_zamowienia = zamFromUwagi[1]; found++; }
    }
  }

  // 14. data_wz
  let data_wz: string | null = null;
  const dataM = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dataM) {
    data_wz = `${dataM[3]}-${dataM[2]}-${dataM[1]}`;
    found++;
  }

  // 15. ilosc_palet — from PALETA goods line
  let ilosc_palet: number | null = null;
  for (const line of lines) {
    if (/PALETA/i.test(line)) {
      const palQty = line.match(/(\d+)\s*(?:SZT|szt)/i);
      if (palQty) { ilosc_palet = parseInt(palQty[1]); found++; break; }
    }
  }
  if (!ilosc_palet) {
    const palPattern = text.match(/paleta\s*=\s*(\d+)\s*szt/i);
    if (palPattern) { ilosc_palet = parseInt(palPattern[1]); found++; }
  }

  // 16. objetosc_m3
  let objetosc_m3: number | null = null;
  const objM = text.match(/([\d.,]+)\s*m[³3]/i);
  if (objM) {
    objetosc_m3 = parseFloat(objM[1].replace(',', '.'));
    found++;
  }

  return {
    nr_wz,
    nr_zamowienia,
    odbiorca_nazwa,
    odbiorca_adres_siedziby,
    adres_dostawy,
    nazwa_budowy,
    osoba_kontaktowa,
    tel,
    tel2,
    masa_kg,
    ilosc_palet,
    objetosc_m3,
    uwagi,
    uwagi_krotkie,
    data_wz,
    pozycje,
    pewnosc: Math.round((found / total) * 100),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let text = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return new Response(JSON.stringify({ error: "Brak pliku" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!file.name.toLowerCase().endsWith(".pdf")) {
        return new Response(
          JSON.stringify({ error: "Nieobsługiwany format pliku. Wymagany PDF." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const buffer = await file.arrayBuffer();
      const parsed = await pdf(new Uint8Array(buffer));
      text = parsed.text || "";

      if (!text || text.trim().length < 10) {
        return new Response(
          JSON.stringify({ error: "Nie można odczytać PDF — plik może być zeskanowanym obrazem", pewnosc: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      const body = await req.json();
      text = body.text || "";
    }

    const result = parseEkonomWz(cleanText(text));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Błąd parsowania: " + (err as Error).message, pewnosc: 0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
