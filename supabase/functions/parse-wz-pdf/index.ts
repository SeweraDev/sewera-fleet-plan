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

/* ─── Document type identification ─── */
function identyfikujTyp(text: string): 'WZ' | 'WZS' | 'PZ' {
  if (/Potwierdzenie zamówienia/i.test(text)) return 'PZ';
  if (/WZS\s+[A-Z]{2}\/\d/.test(text)) return 'WZS';
  return 'WZ';
}

/* ─── Unified Sewera document parser ─── */
function parseSeweraDoc(rawText: string) {
  // KROK 0: Odetnij stopkę — wszystko od "Wystawił:" to dane handlowca
  const wystawilIdx = rawText.search(/\nWystawił:/i);
  const text = wystawilIdx > -1 ? rawText.substring(0, wystawilIdx) : rawText;
  const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
  const typ = identyfikujTyp(text);

  // ── NR DOKUMENTU ──
  let nrDokumentu = '';
  if (typ === 'WZ' || typ === 'WZS') {
    const m = text.match(/(WZS?\s+[A-Z]{2}\/\d+\/\d+\/\d+\/\d+)/);
    nrDokumentu = m ? m[1].trim() : '';
  } else {
    const m = text.match(/\bnr:\s*([A-Z0-9\/]+)/i);
    nrDokumentu = m ? m[1].trim() : '';
  }

  // ── NR ZAMÓWIENIA ──
  let nrZam = '';
  const mSys = text.match(/Nr zamówienia \(systemowy\):\s*([A-Z0-9\/]+)/);
  const mNag = text.match(/\[Nr zam:\s*([A-Z0-9\/]+)\]/);
  nrZam = (mSys?.[1] || mNag?.[1] || (typ === 'PZ' ? nrDokumentu : '')).trim();

  // ── NABYWCA / ODBIORCA ──
  const etykieta = (typ === 'PZ') ? /\bNabywca\b/ : /\bOdbiorca\b/;
  let nabywca = '';
  let adresNabywcy = '';

  const etIdx = lines.findIndex((l: string) => etykieta.test(l));
  if (etIdx > -1) {
    const blok: string[] = [];
    for (let i = etIdx + 1; i < Math.min(etIdx + 15, lines.length); i++) {
      const l = lines[i];
      if (/^(Informacje|Termin zapłaty|Adres dostawy|Magazyn wydający|Lp\.|Nr ewid)/.test(l)) break;
      if (/SEWERA|KOŚCIUSZKI 326|NIP: 6340|NR BDO:|ODDZIAŁ/.test(l)) continue;
      blok.push(l);
    }
    const nazwaLines: string[] = [];
    const adresLines: string[] = [];
    let doAdresu = false;
    for (const l of blok) {
      if (!doAdresu && (l.match(/^(ul\.|al\.|os\.|pl\.)/i) || l.match(/^\d{2}-\d{3}/))) {
        doAdresu = true;
      }
      if (doAdresu) {
        if (l.match(/^(ul\.|al\.|os\.|pl\.)/i) || l.match(/^\d{2}-\d{3}/)) adresLines.push(l);
      } else {
        if (!l.match(/^NIP:|^Nr ewid\./)) nazwaLines.push(l);
      }
    }
    nabywca = nazwaLines.join(' ').replace(/\s+/g, ' ').trim();
    adresNabywcy = adresLines.join(', ').trim();
  }

  // ── ADRES DOSTAWY + TELEFON ──
  let adresDostawy = '';
  let tel = '';
  const maAdresDostawy = /Adres\s+dostawy/i.test(text);

  if (maAdresDostawy) {
    const adIdx = text.search(/Adres\s+dostawy/i);
    const afterAd = text.substring(adIdx + 15, adIdx + 600);
    const stopAd = afterAd.search(/\nLp\.|\nMagazyn wydający:|Termin zapłaty.*Forma/i);
    const adBlok = (stopAd > -1 ? afterAd.substring(0, stopAd) : afterAd)
      .split('\n').map((l: string) => l.trim()).filter(Boolean);

    const ulicaLines: string[] = [];
    const kodLines: string[] = [];

    for (const l of adBlok) {
      if (!tel) {
        const telM = l.match(/[Tt]el\.?\s*:?\s*([0-9][0-9\s\-]{8,})/);
        if (telM) {
          tel = telM[1].split(/\s{2,}|[A-Za-z]/)[0]
            .replace(/\-/g, ' ').trim()
            .replace(/\s+/g, ' ');
          continue;
        }
      }
      if (l.startsWith('Os. kontaktowa:')) continue;
      if (l.match(/^(ul\.|al\.|os\.|pl\.)/i)) { ulicaLines.push(l); continue; }
      if (l.match(/^\d{2}-\d{3}/)) { kodLines.push(l); continue; }
    }

    const ulica = ulicaLines[0] || '';
    const kodMiasto = kodLines[0] || '';
    adresDostawy = [ulica, kodMiasto].filter(Boolean).join(', ');

    if (!adresDostawy) {
      const budowa = adBlok.find((l: string) => l.startsWith('Budowa'));
      adresDostawy = budowa || '';
    }
  } else {
    adresDostawy = adresNabywcy;
  }

  // ── MASA ──
  let masaKg = 0;

  if (typ === 'WZ' || typ === 'WZS') {
    const wagaIdx = text.search(/Waga\s+netto\s+razem:/i);
    if (wagaIdx > -1) {
      const afterWaga = text.substring(wagaIdx + 20, wagaIdx + 200);
      const m = afterWaga.match(/([\d ]+[,.][\d]+)/);
      if (m) {
        masaKg = Math.ceil(parseFloat(m[1].replace(/\s/g, '').replace(',', '.')) || 0);
      }
    }
  } else {
    // PZ: masa jest PRZED "Razem: [wartość PLN]"
    // Struktura: [ilość pozycji z przecinkiem] → [MASA z przecinkiem] → Razem: [PLN]
    // Masa = PRZEDOSTATNIA liczba z przecinkiem przed "Razem:"
    const razIdx = text.search(/\nRazem:\s+[\d\s]+[,.][\d]+/);
    if (razIdx > -1) {
      const beforeRaz = text.substring(Math.max(0, razIdx - 300), razIdx);
      const numeryZPrzecinkiem = [...beforeRaz.matchAll(/([\d ]+[,]\d+)/g)]
        .map((m: RegExpMatchArray) => m[1].replace(/\s/g, '').replace(',', '.'))
        .filter((n: string) => !isNaN(parseFloat(n)));
      // Przedostatnia = masa, ostatnia = ilość pozycji (np. "99,00")
      const idx = numeryZPrzecinkiem.length >= 2
        ? numeryZPrzecinkiem.length - 2
        : numeryZPrzecinkiem.length - 1;
      if (idx >= 0) {
        masaKg = Math.ceil(parseFloat(numeryZPrzecinkiem[idx]) || 0);
      }
    }
  }

  // ── PALETY — zawsze 0, użytkownik wpisuje ręcznie ──
  // Pozycja "PALETA" w dokumencie = paleta zwrotna, nie liczba palet załadunku
  const iloscPalet = 0;

  // ── UWAGI ──
  let uwagi = '';
  const uwagiM = text.match(/Uwagi(?:\s+dot\.\s+wysyłki)?:\s*\n([\s\S]*?)(?:\nNa podstawie art\. 481|\nWystawił:|\nOsoba drukująca:|$)/i);
  if (uwagiM) {
    uwagi = uwagiM[1]
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) =>
        l.length > 0 &&
        !l.startsWith('Nr zamówienia (systemowy):') &&
        !l.startsWith('Nr oferty:') &&
        !l.match(/^WZ\s+[A-Z]{2}\//)
      )
      .join('\n')
      .trim();
  }

  // ── OBJETOSC — zawsze 0, do ręcznego uzupełnienia ──
  const objetosc_m3 = 0;

  // Count found fields for confidence (palety/m3 excluded — always manual)
  let found = 0;
  const total = 8;
  if (nrDokumentu) found++;
  if (nrZam) found++;
  if (nabywca) found++;
  if (adresNabywcy) found++;
  if (adresDostawy) found++;
  if (tel) found++;
  if (masaKg) found++;
  if (uwagi) found++;

  return {
    typ_dokumentu: typ,
    nr_wz: nrDokumentu,
    nr_zamowienia: nrZam,
    odbiorca_nazwa: nabywca,
    odbiorca_adres_siedziby: adresNabywcy,
    adres_dostawy: adresDostawy,
    ma_adres_dostawy: maAdresDostawy,
    tel,
    tel2: null as string | null,
    masa_kg: masaKg,
    ilosc_palet: iloscPalet,
    objetosc_m3,
    uwagi: uwagi || null,
    uwagi_krotkie: uwagi || null,
    nazwa_budowy: null as string | null,
    osoba_kontaktowa: null as string | null,
    data_wz: null as string | null,
    pozycje: [] as any[],
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

    console.log("RAW_TEXT_START");
    console.log(text);

    const result = parseSeweraDoc(cleanText(text));

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
