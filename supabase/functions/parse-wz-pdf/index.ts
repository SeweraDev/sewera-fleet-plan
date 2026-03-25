import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
        if (/^NabywcaSprzedawca|^Sprzedawca\s+Nabywca/.test(l)) break;
        if (/^Nr ewid\.|^NIP:/.test(l)) continue;
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
  // Trzy warianty:
  // A) "Adres dostawy" na osobnej linii, adres POD nią (PZ z sekcją)
  // B) "Adres dostawy" sklejone z "Magazyn wydający:", adres PRZED "Magazyn wydający:"
  // C) "Adres dostawy" na osobnej linii ale adres jest PRZED "Magazyn wydający:" (WZ KK/112)
  //    → fallback z A do B gdy adres po etykiecie jest pusty
  let adresDostawy = "";
  let osobaKontaktowa = "";
  const maAdresDostawy = /Adres\s+dostawy/i.test(text);
  const adresSamodzielny = /\nAdres dostawy\s*\n/i.test(text);

  if (adresSamodzielny) {
    // Wariant A: szukaj adresu po etykiecie "Adres dostawy"
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
      const m = afterWaga.match(/([\d ]+[,.][\d]+)/);
        ulicaLines.push(l);
        continue;
      }
      if (l.match(/^\d{2}-\d{3}/)) {
        kodLines.push(l);
        continue;
      }
    }

    osobaKontaktowa = kontakty.join(", ");
    adresDostawy = [ulicaLines[0] || "", kodLines[0] || ""].filter(Boolean).join(", ");
    if (!adresDostawy) {
      const budowa = adBlok.find((l: string) => l.startsWith("Budowa"));
      adresDostawy = budowa || "";
    }
  }

  // Wariant B/C: gdy brak adresu po etykiecie — szukaj PRZED "Magazyn wydający:"
  if (!adresDostawy && maAdresDostawy) {
    const magazynIdx = text.search(/\nMagazyn wydający:/i);
    if (magazynIdx > -1) {
      const beforeLines = text
        .substring(0, magazynIdx)
        .split("\n")
  !l.match(/^Na podstawie art\./),
```

Edytuj te dwie linie bezpośrednio w Supabase. Wejdź w **View code**, znajdź i zmień:

**Zmiana 1** — znajdź linię:
```
const m = afterWaga.match(/([\d ]+[,.][\d]+)/);
```
Zamień na:
```
const m = afterWaga.match(/([\d ]+[,.][\d]{2,})/);
```

**Zmiana 2** — znajdź linię:
```
          !l.match(/^Na podstawie art\./),
```
Zamień na:
```
          !l.includes("Na podstawie art.") && !l.includes("Kupuj"),
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
    // WZ/WZS: masa PO "Waga netto razem:" — pierwsza liczba z przecinkiem
    const wagaIdx = text.search(/Waga\s+netto\s+razem:/i);
    if (wagaIdx > -1) {
      const afterWaga = text.substring(wagaIdx + 20, wagaIdx + 200);
      const m = afterWaga.match(/([\d ]+[,.][\d]+)/);
      if (m) {
        masaKg = Math.ceil(parseFloat(m[1].replace(/\s/g, "").replace(",", ".")) || 0);
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
          !l.match(/^Na podstawie art\./),
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
      text = body.text || "";
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
