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
  // Strategia: firma nabywcy pojawia się DWUKROTNIE w dokumencie.
  // Pierwsze wystąpienie: zaraz po "nr: XXXX" (PZ) lub po adresie oddziału SEWERA (WZ)
  // Drugie wystąpienie: w tabeli nabywca/odbiorca — też można użyć
  // Używamy pierwszego wystąpienia bo jest czystsze (bez sklejeń etykiet)
  let nabywca = "";
  let adresNabywcy = "";

  const lines = text
    .split("\n")
    .map((l: string) => l.trim())
    .filter(Boolean);

  if (isPZ) {
    // PZ: firma jest na górze dokumentu, zaraz po "nr: XXXX"
    // Struktura: "Gliwice, 19.03.2026" → "Potwierdzenie zamówienia" → "nr: R7/GL/..."
    //            → "PRZEDSIĘBIORSTWO MAXIMUS..." → "KOMANDYTOWA" → "ul. Elizy..."
    //            → "41-103 SIEMIANOWICE" → "Nr ewid.: 30000757" → "NabywcaSprzedawca"
    const nrIdx = lines.findIndex((l: string) => /^nr:\s+[A-Z0-9]/i.test(l));
    if (nrIdx > -1) {
      const nazwaLines: string[] = [];
      const adresLines: string[] = [];
      let doAdresu = false;
      for (let i = nrIdx + 1; i < Math.min(nrIdx + 10, lines.length); i++) {
        const l = lines[i];
        // Stop na etykietach tabeli
        if (/^NabywcaSprzedawca|^Sprzedawca\s+Nabywca/.test(l)) break;
        // Pomiń "Nr ewid." — to nie jest koniec nazwy, to dane rejestrowe
        if (/^Nr ewid\./.test(l)) continue;
        // Pomiń NIP
        if (/^NIP:/.test(l)) continue;
        // Wykryj przejście do adresu
        if (!doAdresu && (l.match(/^(ul\.|al\.)/) || l.match(/^\d{2}-\d{3}/))) {
          doAdresu = true;
        }
        if (doAdresu) {
          if (l.match(/^(ul\.|al\.)/) || l.match(/^\d{2}-\d{3}/)) adresLines.push(l);
        } else {
          nazwaLines.push(l);
        }
      }
      // Komentarz
      nabywca = nazwaLines.join(" ").replace(/\s+/g, " ").trim();
      adresNabywcy = adresLines.join(", ").trim();
    }
  } else {
    // WZ/WZS: firma jest po adresie oddziału SEWERA
    // Adres oddziału zawsze zawiera: ul. KOŚCIUSZKI / ul. DOJAZDOWA / ul. WYZWOLENIA itp.
    // Szukamy linii z adresem oddziału SEWERA (CAPS, zaczyna się od "ul.")
    const sewIdx = lines.findIndex(
      (l: string) =>
        /^ul\.\s+[A-ZŁŚŹŻĆĄĘ]/.test(l) &&
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
        if (/^(Magazyn wydający|Adres dostawy|NIP:|Nr ewid\.|Budowa)/.test(l)) break;
        if (!doAdresu && (l.match(/^(ul\.|al\.)/) || l.match(/^\d{2}-\d{3}/))) {
          doAdresu = true;
        }
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
  let tel = "";
  let osobaKontaktowa = "";
  const maAdresDostawy = /Adres\s+dostawy/i.test(text);

  if (maAdresDostawy) {
    const adIdx = text.search(/Adres\s+dostawy/i);
    const afterAd = text.substring(adIdx + 14, adIdx + 500);
    const stopAd = afterAd.search(/\nLp\.|\nTermin zapłaty|Magazyn wydający/i);
    const adBlok = (stopAd > -1 ? afterAd.substring(0, stopAd) : afterAd)
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);

    const ulicaLines: string[] = [];
    const kodLines: string[] = [];
    const kontakty: string[] = [];

    for (const l of adBlok) {
      // "Os. kontaktowa: Andrzej Nandzik" lub "Os. kontaktowa: Marcin Michałek tel. 531-195-028"
      if (/Os\.?\s*kontaktowa/i.test(l)) {
        const osM = l.match(/Os\.?\s*kontaktowa:\s*(.+?)(?:\s+tel\.?\s*[\d].*)?$/i);
        const telM = l.match(/tel\.?\s*([0-9][0-9\s\-]{7,})/i);
        const imie = osM?.[1]?.trim() || "";
        const telefon = telM?.[1]?.replace(/\-/g, " ").trim() || "";
        kontakty.push([imie, telefon].filter(Boolean).join(" "));
        continue;
      }
      // "Tel.: 602 303 264" w osobnej linii
      if (/^Tel\.?[:\s]/i.test(l)) {
        const telM = l.match(/Tel\.?[:\s]+([0-9][0-9\s]{8,})/i);
        if (telM) kontakty.push(telM[1].trim());
        continue;
      }
      // "Marcin Kot tel. 694 447 293" — imię nazwisko + tel w jednej linii
      if (/[A-ZŁŚŹŻĆĄĘ][a-złśźżćąę]+ [A-ZŁŚŹŻĆĄĘ][a-złśźżćąę]+\s+tel\.?\s+[0-9]/i.test(l)) {
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
    tel = "";

    const ulica = ulicaLines[0] || "";
    const kodMiasto = kodLines[0] || "";
    adresDostawy = [ulica, kodMiasto].filter(Boolean).join(", ");

    if (!adresDostawy) {
      const budowa = adBlok.find((l: string) => l.startsWith("Budowa"));
      adresDostawy = budowa || "";
    }
  } else {
    adresDostawy = adresNabywcy;
  }

  // KROK 6: MASA
  let masaKg = 0;

  if (!isPZ) {
    // WZ/WZS: masa jest PO "Waga netto razem:"
    const wagaIdx = text.search(/Waga\s+netto\s+razem:/i);
    if (wagaIdx > -1) {
      const afterWaga = text.substring(wagaIdx + 20, wagaIdx + 200);
      const m = afterWaga.match(/([\d ]+[,.][\d]+)/);
      if (m) {
        masaKg = Math.ceil(parseFloat(m[1].replace(/\s/g, "").replace(",", ".")) || 0);
      }
    }
  } else {
    // PZ: masa jest PRZED "Razem:" — w surowym tekście "1 699,15Razem:" (sklejone!)
    // Struktura: "\n61,00\n1344,80\n1 699,15Razem:"
    // Liczby z przecinkiem przed Razem: [61,00] [1344,80] [1699,15*]
    // *1699,15 jest sklejone z "Razem:" więc NIE trafia do tablicy "before"
    // Zostają [61,00] [1344,80] → bierzemy OSTATNIĄ = 1344,80 ✓
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
    tel,
    osoba_kontaktowa: osobaKontaktowa,
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
