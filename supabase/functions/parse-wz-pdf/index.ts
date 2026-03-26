import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
function decodePUA(text: string): string {
  const map: Record<number, string> = {
    0xe020: " ",
    0xe021: "!",
    0xe022: '"',
    0xe023: "#",
    0xe024: "$",
    0xe025: "%",
    0xe026: "&",
    0xe027: "'",
    0xe028: "(",
    0xe029: ")",
    0xe02a: "*",
    0xe02b: "+",
    0xe02c: ",",
    0xe02d: "-",
    0xe02e: ".",
    0xe02f: "/",
    0xe030: "0",
    0xe031: "1",
    0xe032: "2",
    0xe033: "3",
    0xe034: "4",
    0xe035: "5",
    0xe036: "6",
    0xe037: "7",
    0xe038: "8",
    0xe039: "9",
    0xe03a: ":",
    0xe03b: ";",
    0xe03c: "<",
    0xe03d: "=",
    0xe03e: ">",
    0xe03f: "?",
    0xe040: "@",
    0xe041: "A",
    0xe042: "B",
    0xe043: "C",
    0xe044: "D",
    0xe045: "E",
    0xe046: "F",
    0xe047: "G",
    0xe048: "H",
    0xe049: "I",
    0xe04a: "J",
    0xe04b: "K",
    0xe04c: "L",
    0xe04d: "M",
    0xe04e: "N",
    0xe04f: "O",
    0xe050: "P",
    0xe051: "Q",
    0xe052: "R",
    0xe053: "S",
    0xe054: "T",
    0xe055: "U",
    0xe056: "V",
    0xe057: "W",
    0xe058: "X",
    0xe059: "Y",
    0xe05a: "Z",
    0xe05b: "[",
    0xe05c: "\\",
    0xe05d: "]",
    0xe05f: "_",
    0xe061: "a",
    0xe062: "b",
    0xe063: "c",
    0xe064: "d",
    0xe065: "e",
    0xe066: "f",
    0xe067: "g",
    0xe068: "h",
    0xe069: "i",
    0xe06a: "j",
    0xe06b: "k",
    0xe06c: "l",
    0xe06d: "m",
    0xe06e: "n",
    0xe06f: "o",
    0xe070: "p",
    0xe071: "q",
    0xe072: "r",
    0xe073: "s",
    0xe074: "t",
    0xe075: "u",
    0xe076: "v",
    0xe077: "w",
    0xe078: "x",
    0xe079: "y",
    0xe07a: "z",
    0xe100: "Ą",
    0xe103: "Ć",
    0xe104: "Ę",
    0xe107: "Ł",
    0xe10b: "Ń",
    0xe10f: "Ó",
    0xe112: "Ś",
    0xe118: "Ź",
    0xe119: "Ż",
    0xe141: "ą",
    0xe143: "ć",
    0xe144: "ę",
    0xe147: "ł",
    0xe14b: "ń",
    0xe14f: "ó",
    0xe152: "ś",
    0xe158: "ź",
    0xe159: "ż",
    0xe082: "„",
    0xe093: "\u2013",
    0xe080: "€",
    0xe002: "ƒ",
  };

  return text
    .split("")
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return map[cp] ?? (cp >= 0xe000 && cp <= 0xf8ff ? "" : ch);
    })
    .join("");
}

function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[^\x20-\x7E\u00A0-\u017E\n\r\t]/g, "")
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

  // KROK 6: MASA
  let masaKg = 0;

  if (!isPZ) {
    // WZ/WZS: masa PO "Waga netto razem:"
    const wagaIdx = text.search(/Waga\s+netto\s+razem:/i);
    if (wagaIdx > -1) {
      const wagaLine = text.substring(wagaIdx, wagaIdx + 200);
      // Wariant A: liczba w tej samej linii "Waga netto razem: 9 733,10"
      const inlineMatch = wagaLine.match(/Waga\s+netto\s+razem:\s*([\d][\d ,]*[,.]\d+)/i);
      if (inlineMatch) {
        masaKg = Math.ceil(parseFloat(inlineMatch[1].replace(/\s/g, "").replace(",", ".")) || 0);
      } else {
        // Wariant B: liczba w kolejnych liniach — bierz największą liczbę z przecinkiem
        const fragment = wagaLine
          .split("\n")
          .map((l: string) => l.trim())
          .filter(Boolean);
        const kandydaci: number[] = [];
        for (const fl of fragment) {
          if (/^RAZEM:/i.test(fl)) break;
          if (fl.includes(",") || fl.includes(".")) {
            const n = parseFloat(fl.replace(/\s/g, "").replace(",", "."));
            if (!isNaN(n) && n > 0) kandydaci.push(n);
          }
        }
        if (kandydaci.length > 0) {
          masaKg = Math.ceil(Math.max(...kandydaci));
        }
      }
    }
  } else {
    // PZ: masa PRZED "Razem:" — ostatnia liczba z przecinkiem
    const razIdx = text.search(/[\d ,]+Razem:|Razem:\s*[\d ,]+/i);
    if (razIdx > -1) {
      const before = text.substring(Math.max(0, razIdx - 200), razIdx);
      const numery = [...before.matchAll(/([\d ]*\d[,]\d+)/g)]
        .map((m: RegExpMatchArray) => m[1].replace(/\s/g, "").replace(",", "."))
        .filter((n: string) => parseFloat(n) > 0);
      if (numery.length >= 1) {
        masaKg = Math.ceil(parseFloat(numery[numery.length - 1]) || 0);
      }
    }
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
    odbiorca: nabywca,
    adres_dostawy: adresDostawy,
    ma_adres_dostawy: maAdresDostawy,
    osoba_kontaktowa: osobaKontaktowa,
    tel: osobaKontaktowa,
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

    const result = parseSeweraDoc(cleanText(text));

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
// redeployed: 2026-03-26
