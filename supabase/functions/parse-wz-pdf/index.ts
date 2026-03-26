import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
function decodePUA(text: string): string {
  const buildMap = (offset: number): Record<number, string> => ({
    [offset + 0x020]: " ", [offset + 0x021]: "!",
    [offset + 0x022]: '"', [offset + 0x023]: "#",
    [offset + 0x024]: "$", [offset + 0x025]: "%",
    [offset + 0x026]: "&", [offset + 0x027]: "'",
    [offset + 0x028]: "(", [offset + 0x029]: ")",
    [offset + 0x02a]: "*", [offset + 0x02b]: "+",
    [offset + 0x02c]: ",", [offset + 0x02d]: "-",
    [offset + 0x02e]: ".", [offset + 0x02f]: "/",
    [offset + 0x030]: "0", [offset + 0x031]: "1",
    [offset + 0x032]: "2", [offset + 0x033]: "3",
    [offset + 0x034]: "4", [offset + 0x035]: "5",
    [offset + 0x036]: "6", [offset + 0x037]: "7",
    [offset + 0x038]: "8", [offset + 0x039]: "9",
    [offset + 0x03a]: ":", [offset + 0x03b]: ";",
    [offset + 0x03c]: "<", [offset + 0x03d]: "=",
    [offset + 0x03e]: ">", [offset + 0x03f]: "?",
    [offset + 0x040]: "@",
    [offset + 0x041]: "A", [offset + 0x042]: "B",
    [offset + 0x043]: "C", [offset + 0x044]: "D",
    [offset + 0x045]: "E", [offset + 0x046]: "F",
    [offset + 0x047]: "G", [offset + 0x048]: "H",
    [offset + 0x049]: "I", [offset + 0x04a]: "J",
    [offset + 0x04b]: "K", [offset + 0x04c]: "L",
    [offset + 0x04d]: "M", [offset + 0x04e]: "N",
    [offset + 0x04f]: "O", [offset + 0x050]: "P",
    [offset + 0x051]: "Q", [offset + 0x052]: "R",
    [offset + 0x053]: "S", [offset + 0x054]: "T",
    [offset + 0x055]: "U", [offset + 0x056]: "V",
    [offset + 0x057]: "W", [offset + 0x058]: "X",
    [offset + 0x059]: "Y", [offset + 0x05a]: "Z",
    [offset + 0x05b]: "[", [offset + 0x05c]: "\\",
    [offset + 0x05d]: "]", [offset + 0x05f]: "_",
    [offset + 0x061]: "a", [offset + 0x062]: "b",
    [offset + 0x063]: "c", [offset + 0x064]: "d",
    [offset + 0x065]: "e", [offset + 0x066]: "f",
    [offset + 0x067]: "g", [offset + 0x068]: "h",
    [offset + 0x069]: "i", [offset + 0x06a]: "j",
    [offset + 0x06b]: "k", [offset + 0x06c]: "l",
    [offset + 0x06d]: "m", [offset + 0x06e]: "n",
    [offset + 0x06f]: "o", [offset + 0x070]: "p",
    [offset + 0x071]: "q", [offset + 0x072]: "r",
    [offset + 0x073]: "s", [offset + 0x074]: "t",
    [offset + 0x075]: "u", [offset + 0x076]: "v",
    [offset + 0x077]: "w", [offset + 0x078]: "x",
    [offset + 0x079]: "y", [offset + 0x07a]: "z",
    [offset + 0x100]: "Ą", [offset + 0x103]: "Ć",
    [offset + 0x104]: "Ę", [offset + 0x107]: "Ł",
    [offset + 0x10b]: "Ń", [offset + 0x10f]: "Ó",
    [offset + 0x112]: "Ś", [offset + 0x118]: "Ź",
    [offset + 0x119]: "Ż", [offset + 0x141]: "ą",
    [offset + 0x143]: "ć", [offset + 0x144]: "ę",
    [offset + 0x147]: "ł", [offset + 0x14b]: "ń",
    [offset + 0x14f]: "ó", [offset + 0x152]: "ś",
    [offset + 0x158]: "ź", [offset + 0x159]: "ż",
    [offset + 0x082]: "„", [offset + 0x093]: "\u2013",
    [offset + 0x080]: "€", [offset + 0x002]: "ƒ",
  });

  const map: Record<number, string> = {
    ...buildMap(0xe000),
    ...buildMap(0xf000),
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
// redeployed: 2026-03-26v3
