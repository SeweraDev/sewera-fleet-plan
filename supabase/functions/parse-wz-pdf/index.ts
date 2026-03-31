import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
function decodePUA(text: string): string {
  // Windows-1250 mapping for 0x80-0x9F (control chars in Unicode, useful chars in Win-1250)
  const win1250: Record<number, string> = {
    0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
    0x89: "‰", 0x8A: "Š", 0x8B: "‹", 0x8C: "Ś", 0x8D: "Ť", 0x8E: "Ž", 0x8F: "Ź",
    0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201C", 0x94: "\u201D",
    0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™",
    0x9A: "š", 0x9B: "›", 0x9C: "ś", 0x9D: "ť", 0x9E: "ž", 0x9F: "ź",
  };
  const bases = [0xE000, 0xF000, 0x10000, 0x100000];
  return Array.from(text)
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      for (const base of bases) {
        const off = cp - base;
        if (off >= 0x20 && off <= 0x24F) {
          if (off >= 0x80 && off <= 0x9F) return win1250[off] ?? "";
          return String.fromCodePoint(off);
        }
      }
      if ((cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0x10000) return "";
      return ch;
    })
    .join("");
}

function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[^\x20-\x7E\u00A0-\u024F\u2000-\u215F\n\r\t]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(\n\s*){3,}/g, "\n\n");
}

function parseSeweraDoc(rawText: string) {
  // KROK 0: Odetnij stopkę
  const wystawilIdx = rawText.search(/\nWystawił:/i);
  const text = wystawilIdx > -1 ? rawText.substring(0, wystawilIdx) : rawText;

  // KROK 1: Typ dokumentu
  const isPZ = /Potwierdzenie zamówienia/i.test(text);
  const isWZS = /WZS\s+[A-Z]{2}\/\d/.test(text);
  const typDokumentu = isPZ ? "PZ" : isWZS ? "WZS" : "WZ";

  // KROK 2: Nr dokumentu
  let nrDokumentu = "";
  if (!isPZ) {
    const m = text.match(/(WZS?\s+[A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/);
    nrDokumentu = m ? m[1].trim() : "";
  } else {
    const m = text.match(/\bnr:\s*([A-Z0-9\/]+)/i);
    nrDokumentu = m ? m[1].trim() : "";
  }

  // KROK 3: Nr zamówienia
  const mSys = text.match(/Nr zamówienia \(systemowy\):\s*([A-Z0-9\/]+)/);
  const mNag = text.match(/\[Nr zam:\s*([A-Z0-9\/]+)\]/);
  const nrZam = (mSys?.[1] || mNag?.[1] || (isPZ ? nrDokumentu : "")).trim();

  // KROK 4: Nabywca / Odbiorca
  let nabywca = "";
  let adresNabywcy = "";
  const lines = text
    .split("\n")
    .map((l: string) => l.trim())
    .filter(Boolean);

  if (isPZ) {
    const nrIdx = lines.findIndex((l: string) => /^nr:\s*[A-Z0-9]/i.test(l));
    if (nrIdx > -1) {
      const nazwaLines: string[] = [];
      const adresLines: string[] = [];
      let doAdresu = false;
      for (let i = nrIdx + 1; i < Math.min(nrIdx + 10, lines.length); i++) {
        const l = lines[i];
        if (/^(NabywcaSprzedawca|Sprzedawca\s+Nabywca|OdbiorcaInformacje)/i.test(l)) break;
        if (/^(Nr ewid\.|NIP:|NR BDO:)/i.test(l)) continue;
        if (!doAdresu && (l.match(/^(ul\.|al\.)/) || l.match(/^\d{2}-\d{3}/))) doAdresu = true;
        if (doAdresu) {
          if (l.match(/^(ul\.|al\.)/) || l.match(/^\d{2}-\d{3}/)) adresLines.push(l);
        } else {
          nazwaLines.push(l);
        }
      }
      nabywca = nazwaLines.join(" ").replace(/\s+/g, " ").trim();
      adresNabywcy = adresLines.join(", ").trim();
    }
  } else {
    const sewIdx = lines.findIndex(
      (l: string) =>
        /^ul\.\s+[A-Z]/.test(l) &&
        (l.includes("KATOWICE") ||
          l.includes("GLIWICE") ||
          l.includes("OŚWIĘCIM") ||
          l.includes("SOSNOWIEC") ||
          l.includes("CHRZANÓW") ||
          l.includes("BĘDZIN") ||
          l.includes("ZABRZE") ||
          l.includes("DOJAZDOWA") ||
          l.includes("KOŚCIUSZKI") ||
          l.includes("WYZWOLENIA")),
    );
    if (sewIdx > -1) {
      const nazwaLines: string[] = [];
      const adresLines: string[] = [];
      let doAdresu = false;
      for (let i = sewIdx + 1; i < Math.min(sewIdx + 10, lines.length); i++) {
        const l = lines[i];
        if (/^(Magazyn wydający|NIP:|Nr ewid\.)/.test(l)) break;
        if (/NIP:.*Nr ewid\./i.test(l)) break;
        if (!doAdresu && (l.match(/^(ul\.|al\.)/) || l.match(/^\d{2}-\d{3}/))) doAdresu = true;
        if (doAdresu) {
          if (l.match(/^(ul\.|al\.)/) || l.match(/^\d{2}-\d{3}/)) adresLines.push(l);
        } else {
          nazwaLines.push(l);
        }
      }
      nabywca = nazwaLines.join(" ").replace(/\s+/g, " ").trim();
      adresNabywcy = adresLines.join(", ").trim();
    }
  }

  // KROK 5: Adres dostawy + kontakt
  let adresDostawy = "";
  let osobaKontaktowa = "";
  const maAdresDostawy = /Adres\s+dostawy/i.test(text);
  const adresSamodzielny = /\nAdres dostawy\s*\n/i.test(text);

  if (adresSamodzielny) {
    const adIdx = text.search(/\nAdres dostawy\s*\n/i);
    const afterAd = text.substring(adIdx + 15, adIdx + 500);
    const stopAd = afterAd.search(/\nLp\.|\nTermin zapłaty|\nMagazyn wydający/i);
    const adBlok = (stopAd > -1 ? afterAd.substring(0, stopAd) : afterAd)
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);

    const ulicaLines: string[] = [];
    const kodLines: string[] = [];
    const kontakty: string[] = [];

    for (const l of adBlok) {
      if (/Os\.?\s*kontaktowa/i.test(l)) {
        const osM = l.match(/Os\.?\s*kontaktowa:\s*(.+?)(?:\s+tel\.?\s*[\d].*)?$/i);
        const telM = l.match(/tel\.?\s*([0-9][0-9\s\-]{7,})/i);
        const imie = osM?.[1]?.trim() || "";
        const telefon = telM?.[1]?.replace(/\-/g, " ").trim() || "";
        kontakty.push([imie, telefon].filter(Boolean).join(" "));
        continue;
      }
      if (/^Tel\.?[:\s]/i.test(l)) {
        const telM = l.match(/Tel\.?[:\s]+([0-9][0-9\s]{8,})/i);
        if (telM) kontakty.push(telM[1].trim());
        continue;
      }
      if (/[A-Z][a-z]+ [A-Z][a-z]+\s+tel\.?\s+[0-9]/i.test(l)) {
        const m = l.match(/(.+?)\s+tel\.?\s+([0-9][0-9\s\-]{7,})/i);
        if (m) kontakty.push(`${m[1].trim()} ${m[2].replace(/\-/g, " ").trim()}`);
        continue;
      }
      if (l.match(/^(ul\.|al\.|os\.|pl\.)/i)) {
        ulicaLines.push(l);
        continue;
      }
      if (l.match(/^\d{2}-\d{3}/)) {
        kodLines.push(l);
        continue;
      }
    }

    osobaKontaktowa = kontakty.join(", ");
    const nazwaObiektu = adBlok.find((l: string) => /^(Budowa|Plac|Osiedle|Hala|Magazyn|Zakład)/i.test(l)) || "";
    adresDostawy = [ulicaLines[0] || "", kodLines[0] || ""].filter(Boolean).join(", ");
    if (nazwaObiektu && adresDostawy) {
      adresDostawy = nazwaObiektu + ", " + adresDostawy;
    } else if (nazwaObiektu) {
      adresDostawy = nazwaObiektu;
    }
  }

  // Wariant B/C: gdy brak adresu po etykiecie — szukaj PRZED "Magazyn wydający:"
  if (!adresDostawy && maAdresDostawy) {
    const magazynIdx = text.search(/\nMagazyn wydający:/i);
    if (magazynIdx > -1) {
      const beforeLines = text
        .substring(0, magazynIdx)
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean);
      const kontakty: string[] = [];
      const ulicaLines: string[] = [];
      const kodLines: string[] = [];

      for (let i = beforeLines.length - 1; i >= 0; i--) {
        const l = beforeLines[i];
        if (/^NIP:/.test(l) || /NIP:.*Nr ewid\./i.test(l)) break;
        if (/^(SEWERA|NR BDO:|ODDZIAŁ|NabywcaSprzedawca|Sprzedawca|Odbiorca)/.test(l)) break;
        if (/Os\.?\s*kontaktowa/i.test(l)) {
          const osM = l.match(/Os\.?\s*kontaktowa:\s*(.+?)(?:\s+tel\.?\s*[\d].*)?$/i);
          if (osM) kontakty.unshift(osM[1].trim());
          continue;
        }
        if (/^Tel\.?[:\s]/i.test(l)) {
          const telM = l.match(/Tel\.?[:\s]+([0-9][0-9\s]{8,})/i);
          if (telM) kontakty.unshift(telM[1].trim());
          continue;
        }
        if (l.match(/^\d{2}-\d{3}/)) {
          kodLines.unshift(l);
          continue;
        }
        if (l.match(/^(ul\.|al\.)/i)) {
          ulicaLines.unshift(l);
          continue;
        }
      }

      if (!osobaKontaktowa) osobaKontaktowa = kontakty.join(", ");
      adresDostawy = [ulicaLines[0] || "", kodLines[0] || ""].filter(Boolean).join(", ");
    }
  }

  if (!adresDostawy) adresDostawy = adresNabywcy;

  // KROK 5B: os.kontaktowa — multi-kontakt regex na pełnym tekście (stop przed Wystawił)
  if (!osobaKontaktowa) {
    const contactEntries: string[] = [];
    const osMatch = text.match(/Os\.\s*kontaktowa[:\s]+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\-]+)/i);
    if (osMatch) {
      let entry = osMatch[1].trim();
      const afterOsFull = text.slice(text.indexOf(osMatch[0]) + osMatch[0].length);
      const stopIdx = afterOsFull.search(/Wystawił|Na\s+podstawie|Lp\.\s|Magazyn\s+wydaj/i);
      const afterOs = stopIdx > -1 ? afterOsFull.slice(0, stopIdx) : afterOsFull;
      const telAfter = afterOs.match(/^[\s:]*Tel\.?\s*:?\s*([\d][\d\s\-]{7,})/i);
      if (telAfter) entry += " tel. " + telAfter[1].replace(/[^\d]/g, " ").trim().replace(/\s+/g, " ");
      contactEntries.push(entry);
      const extras = [...afterOs.matchAll(/([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\-]+)\s+tel\.?\s*:?\s*([\d][\d\s\-]{7,})/gi)];
      for (const m of extras) {
        const name = m[1].trim();
        const phone = m[2].replace(/[^\d]/g, " ").trim().replace(/\s+/g, " ");
        if (!contactEntries.some((e: string) => e.includes(name))) contactEntries.push(name + " tel. " + phone);
      }
      const pExtras = [...afterOs.matchAll(/p\.\s*([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)\s+([\d][\d\s\-]{7,})/gi)];
      for (const m of pExtras) {
        const name = m[1].trim();
        const phone = m[2].replace(/[^\d]/g, " ").trim().replace(/\s+/g, " ");
        if (!contactEntries.some((e: string) => e.includes(name))) contactEntries.push(name + " tel. " + phone);
      }
      if (contactEntries.length) osobaKontaktowa = contactEntries.join(", ");
    }
  }

  // KROK 6: MASA — last standalone number before "RAZEM:" line
  let masaKg = 0;
  const massLines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  const razemLineIdx = massLines.findIndex((l: string) => /^RAZEM/i.test(l));
  if (razemLineIdx > 0) {
    for (let mi = razemLineIdx - 1; mi >= Math.max(0, razemLineIdx - 5); mi--) {
      const s = massLines[mi].replace(/\s/g, "");
      const mm = s.match(/^([\d,.]+)$/);
      if (mm) { masaKg = Math.ceil(parseFloat(mm[1].replace(",", ".")) || 0); break; }
    }
  }
  // Fallback: inline after "Waga netto razem:"
  if (masaKg === 0) {
    const wagaInline = text.match(/Waga\s+netto\s+razem[:\s]*([\d]+[\d,.]*)/i);
    if (wagaInline) masaKg = Math.ceil(parseFloat(wagaInline[1].replace(",", ".")) || 0);
  }

  // KROK 7: Uwagi
  let uwagi = "";
  const uwagiM = text.match(/Uwagi(?:\s+dot\.\s+wysyłki)?:\s*\n([\s\S]*?)$/i);
  if (uwagiM) {
    uwagi = uwagiM[1]
      .split("\n")
      .map((l: string) => l.trim())
      .filter(
        (l: string) =>
          l.length > 0 &&
          !l.startsWith("Nr zamówienia (systemowy):") &&
          !l.startsWith("Nr oferty:") &&
          !l.match(/^WZ\s+[A-Z]{2}\//) &&
          !l.includes("Na podstawie art.") &&
          !l.includes("Kupuj"),
      )
      .join("\n")
      .trim();
  }

  return {
    typ_dokumentu: typDokumentu,
    nr_wz: nrDokumentu,
    nr_zamowienia: nrZam,
    odbiorca: [nabywca, adresNabywcy].filter(Boolean).join(", "),
    adres_dostawy: adresDostawy,
    ma_adres_dostawy: maAdresDostawy,
    osoba_kontaktowa: osobaKontaktowa,
    tel: null,
    masa_kg: masaKg,
    ilosc_palet: 0,
    objetosc_m3: 0,
    uwagi,
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
        return new Response(JSON.stringify({ error: "Nieobsługiwany format pliku. Wymagany PDF." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const buffer = await file.arrayBuffer();
      const parsed = await pdf(new Uint8Array(buffer));
      text = parsed.text || "";
      if (!text || text.trim().length < 10) {
        return new Response(
          JSON.stringify({ error: "Nie można odczytać PDF — plik może być zeskanowanym obrazem", pewnosc: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      const body = await req.json();
      text = decodePUA(body.text || "");
    }

    console.log("RAW_TEXT_START");
    console.log(text);

    const afterClean = cleanText(text);
    console.log("AFTER_CLEAN_START");
    console.log(afterClean.substring(0, 200));
    console.log("AFTER_CLEAN_END");

    const result = parseSeweraDoc(afterClean);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Błąd parsowania: " + (err as Error).message, pewnosc: 0 }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
// redeployed: 2026-03-27v7
