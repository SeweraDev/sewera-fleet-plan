import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

  // 1. nr_wz
  const nr_wz = ext(text, [
    /WZ\s+([A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/i,
    /WZ\s+([A-Z]{2}\/[\d\/]+)/i,
    /(?:WZ[:\s]+)([\w\-\/]+)/i,
  ]);
  if (nr_wz) found++;

  // 2. nr_zamowienia
  let nr_zamowienia = ext(text, [
    /Nr\s+zam\.?[:\s]+(T7\/[^\s\n]+)/i,
    /(T7\/[A-Z]{2}\/[\d\/]+)/i,
    /Nr\s+zam(?:ówienia)?[:\s]+([\w\-\/]+)/i,
  ]);
  if (nr_zamowienia) found++;

  // 3. odbiorca_nazwa — first line after "Odbiorca" header
  let odbiorca_nazwa: string | null = null;
  let odbiorca_adres_siedziby: string | null = null;
  const odbM = text.match(/Odbiorca\s*[:\n]\s*(.+?)(?:\n(.+?))?(?:\n\n|\nAdres|\nNIP)/is);
  if (odbM) {
    odbiorca_nazwa = odbM[1]?.trim() || null;
    if (odbiorca_nazwa) found++;
    // 4. odbiorca_adres_siedziby — second line
    if (odbM[2]) {
      odbiorca_adres_siedziby = odbM[2].trim();
      found++;
    }
  }
  if (!odbiorca_nazwa) {
    odbiorca_nazwa = ext(text, [
      /Odbiorca[:\s]*\n?\s*(.+?)(?:\n|$)/i,
      /Nabywca[:\s]*\n?\s*(.+?)(?:\n|$)/i,
    ]);
    if (odbiorca_nazwa) found++;
  }

  // 5. adres_dostawy + 6. nazwa_budowy
  let adres_dostawy: string | null = null;
  let nazwa_budowy: string | null = null;
  const adrSection = text.match(/Adres\s+dostawy\s*[:\n]\s*([\s\S]*?)(?:Os\.\s*kontaktowa|Osoba\s+kontaktowa|Tel\.|$)/i);
  if (adrSection) {
    const lines = adrSection[1].split('\n').map(l => l.trim()).filter(Boolean);
    const addrLines: string[] = [];
    for (const line of lines) {
      if (/^(ul\.|al\.|os\.|pl\.)/.test(line) || /\d{2}-\d{3}/.test(line)) {
        addrLines.push(line);
      } else if (addrLines.length === 0) {
        // line before address = nazwa_budowy
        nazwa_budowy = line;
        found++;
      }
    }
    if (addrLines.length > 0) {
      adres_dostawy = addrLines.join(', ');
      found++;
    } else if (lines.length > 0) {
      // fallback: take all lines as address
      adres_dostawy = lines.join(', ');
      found++;
    }
  }
  if (!adres_dostawy) {
    adres_dostawy = ext(text, [
      /Adres\s+dostawy[:\s]*\n?\s*(.+?\d{2}-\d{3}\s*\w+)/is,
      /((?:ul\.|al\.|os\.)\s*.+?\d{2}-\d{3}\s*\w+)/i,
    ]);
    if (adres_dostawy) found++;
  }

  // 7. osoba_kontaktowa
  const osoba_kontaktowa = ext(text, [
    /Os\.\s*kontaktowa[:\s]*(.+?)(?:\n|Tel|$)/i,
    /Osoba\s+kontaktowa[:\s]*(.+?)(?:\n|Tel|$)/i,
  ]);
  if (osoba_kontaktowa) found++;

  // 8. tel — first phone
  const tel = ext(text, [
    /Tel\.?\s*:?\s*([\d\s\-]{9,15})/i,
  ])?.replace(/\s+/g, ' ').trim() || null;
  if (tel) found++;

  // 9. tel2 — second phone
  let tel2: string | null = null;
  const telMatches = [...text.matchAll(/(?:Tel\.?|p\.)\s*:?\s*(?:[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]+\s+)?([\d\s]{9,15})/gi)];
  if (telMatches.length >= 2) {
    tel2 = telMatches[1][1].replace(/\s+/g, ' ').trim();
    found++;
  }

  // 10. pozycje_towarowe
  const pozycje: Pozycja[] = [];
  // Try to find table rows: lp | kod_towaru | ...
  const rowRegex = /(\d+)\s+(\d{4,8})\s*(?:\(([^)]*)\))?\s*(?:(\d{13}))?\s+(.+?)\s+(\d+[.,]?\d*)\s+(SZT|KG|M|MB|M2|M3|KPL|OP|PAL|T)/gi;
  let rm;
  while ((rm = rowRegex.exec(text)) !== null) {
    const nazwaFull = rm[5].trim();
    // Split nazwa into main + dodatkowa if multiline
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
  // Simpler fallback for Ekonom table format
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

  // 11. masa_kg
  let masa_kg: number | null = null;
  const masaM = text.match(/Waga\s+netto\s+razem\s*:?\s*[\d]*\s*([\d.,]+)/i)
    || text.match(/Masa\s+(?:netto\s+)?razem\s*:?\s*([\d.,]+)/i)
    || text.match(/Waga\s+netto[:\s]+([\d.,]+)/i);
  if (masaM) {
    masa_kg = parseFloat(masaM[1].replace(',', '.'));
    found++;
  }

  // 12 + 13. uwagi / uwagi_krotkie
  let uwagi: string | null = null;
  let uwagi_krotkie: string | null = null;
  const uwagiM = text.match(/Uwagi\s*:?\s*\n?([\s\S]*?)(?:\n\n|Podpis|Wystawił|$)/i);
  if (uwagiM) {
    uwagi = uwagiM[1].trim() || null;
    if (uwagi) found++;
    // Extract short note after "Nr zamówienia (systemowy): ..."
    const shortM = uwagi?.match(/Nr\s+zam[^:]*:\s*\S+\s*([\s\S]*)/i);
    if (shortM && shortM[1].trim()) {
      uwagi_krotkie = shortM[1].trim();
      found++;
    }
    // Also extract nr_zamowienia from uwagi if not found yet
    if (!nr_zamowienia && uwagi) {
      const zamFromUwagi = uwagi.match(/(T7\/[A-Z]{2}\/[\d\/]+)/i);
      if (zamFromUwagi) {
        nr_zamowienia = zamFromUwagi[1];
        found++;
      }
    }
  }

  // 14. data_wz
  let data_wz: string | null = null;
  const dataM = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dataM) {
    data_wz = `${dataM[3]}-${dataM[2]}-${dataM[1]}`;
    found++;
  }

  // 15. ilosc_palet
  let ilosc_palet: number | null = null;
  const palM = text.match(/(\d+)\s*[Pp]alet/i) || text.match(/(\d+)\s*EUR/i) || text.match(/(\d+)\s*[Pp]al\b/i);
  if (palM) {
    ilosc_palet = parseInt(palM[1]);
    found++;
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

    const result = parseEkonomWz(text);

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
