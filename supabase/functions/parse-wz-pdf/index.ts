import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractField(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function parseWzFromText(text: string) {
  let pewnosc = 0;
  const total = 7;

  const nr_wz = extractField(text, [
    /WZ\s+([A-Z]{2}\/[\d\/]+)/i,
    /(?:WZ[:\s]+)([\w\-\/]+)/i,
  ]);
  if (nr_wz) pewnosc++;

  const nr_zamowienia = extractField(text, [
    /Nr\s+zam[:\s]+(T7\/[^\s\n]+)/i,
    /(T7\/[A-Z]{2}\/[\d\/]+)/i,
    /Nr\s+zam(?:ówienia)?[:\s]+([\w\-\/]+)/i,
  ]);
  if (nr_zamowienia) pewnosc++;

  const odbiorca = extractField(text, [
    /Odbiorca[:\s]*\n?\s*(.+?)(?:\n|$)/i,
    /Nabywca[:\s]*\n?\s*(.+?)(?:\n|$)/i,
  ]);
  if (odbiorca) pewnosc++;

  // Address: look for "Adres dostawy" section or street patterns
  let adres_dostawy = extractField(text, [
    /Adres\s+dostawy[:\s]*\n?\s*(.+?\d{2}-\d{3}\s*\w+)/is,
    /Adres\s+dostawy[:\s]*\n?\s*(.+?)(?:\n\n|\n[A-Z])/is,
  ]);
  if (!adres_dostawy) {
    adres_dostawy = extractField(text, [
      /((?:ul\.|al\.|os\.)\s*.+?\d{2}-\d{3}\s*\w+)/i,
    ]);
  }
  if (adres_dostawy) pewnosc++;

  const tel = extractField(text, [
    /Tel\.?[:\s]+([\d\s\-]{9,})/i,
  ]);
  if (tel) pewnosc++;

  let masa_kg: number | null = null;
  const masaMatch = text.match(/Waga\s+netto\s+razem[:\s]+([\d.,]+)/i)
    || text.match(/Masa\s+netto[:\s]+([\d.,]+)/i)
    || text.match(/([\d.,]+)\s*kg/i);
  if (masaMatch) {
    masa_kg = parseFloat(masaMatch[1].replace(',', '.'));
    pewnosc++;
  }

  const uwagi = extractField(text, [
    /Uwagi[:\s]+(.+?)(?:\n\n|\n[A-Z]|$)/is,
  ]);
  if (uwagi) pewnosc++;

  return {
    nr_wz,
    nr_zamowienia,
    odbiorca,
    adres_dostawy,
    tel: tel?.replace(/\s+/g, ' ').trim() || null,
    masa_kg,
    uwagi,
    pewnosc: Math.round((pewnosc / total) * 100),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

      const fileName = file.name.toLowerCase();
      if (!fileName.endsWith(".pdf")) {
        return new Response(
          JSON.stringify({ error: "Nieobsługiwany format pliku. Wymagany PDF." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Read PDF bytes
      const bytes = new Uint8Array(await file.arrayBuffer());
      
      // Simple text extraction from PDF - extract text between stream markers
      // For production, use a proper PDF library. This handles text-based PDFs.
      const decoder = new TextDecoder("latin1");
      const raw = decoder.decode(bytes);
      
      // Extract text content from PDF streams
      const textParts: string[] = [];
      
      // Method 1: Look for text between BT and ET markers
      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let match;
      while ((match = btEtRegex.exec(raw)) !== null) {
        const block = match[1];
        // Extract text from Tj and TJ operators
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        let tjMatch;
        while ((tjMatch = tjRegex.exec(block)) !== null) {
          textParts.push(tjMatch[1]);
        }
        // TJ array
        const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
        let tjArrMatch;
        while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
          const inner = tjArrMatch[1];
          const strRegex = /\(([^)]*)\)/g;
          let strMatch;
          while ((strMatch = strRegex.exec(inner)) !== null) {
            textParts.push(strMatch[1]);
          }
        }
      }
      
      text = textParts.join(" ").replace(/\\n/g, "\n").replace(/\s+/g, " ");
      
      // If no text extracted, try raw string extraction as fallback
      if (text.trim().length < 20) {
        // Extract readable strings from the PDF
        const strRegex = /\(([A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s.,\-\/:\\@#&;!?+=%'"(){}[\]]+)\)/g;
        const fallbackParts: string[] = [];
        let fm;
        while ((fm = strRegex.exec(raw)) !== null) {
          if (fm[1].length > 2) fallbackParts.push(fm[1]);
        }
        text = fallbackParts.join("\n");
      }

      if (!text || text.trim().length < 10) {
        return new Response(
          JSON.stringify({ error: "Nie można odczytać PDF — plik może być zeskanowanym obrazem", pewnosc: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Accept raw text as JSON body for testing
      const body = await req.json();
      text = body.text || "";
    }

    const result = parseWzFromText(text);

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
