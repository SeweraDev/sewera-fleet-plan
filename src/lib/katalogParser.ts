/**
 * Parser CSV/XLSX dla bazy towarow Sewery (export z Ekonom).
 *
 * Plik z Ekonoma ma kodowanie cp1250, separator ';', oczekiwane kolumny:
 *   Kod | Nazwa | Nazwa dodatkowa | Kod producenta | Jm. | Objetosc | Dzial | Producent | Waga netto | EAN | HDS
 *
 * Walidator sanity (decyzja usera 15.05.2026): flagujemy podejrzane m3, ale NIE
 * odrzucamy — admin widzi liste do weryfikacji w panelu.
 *
 * Reguly podejrzanego m3:
 *  1. m3 > 5 (1 paleta = 1,1 m3 — wiekszosc towarow << 5 m3 per szt)
 *  2. m3 > 2 dla JM=SZT (1 sztuka > 2 palety = absurd dla wiekszosci asortymentu)
 *  3. m3 == waga (z dokladnoscia 0.001) — czesty bug skopiowania pola
 *  4. m3 > 0.5 dla produktow z 'ml' lub 'L'/'l' w nazwie (puszka/butelka)
 */

export interface KatalogRow {
  kod: string;
  kod_producenta: string | null;
  ean: string | null;
  nazwa: string;
  nazwa_dodatkowa: string | null;
  jm: string | null;
  m3_per_szt: number | null;
  m3_podejrzany: boolean;
  dzial: string | null;
  producent: string | null;
  kg_per_szt: number | null;
  szt_na_palecie: number | null;
  m3_per_paleta: number | null;
  wymaga_hds: boolean;
}

// Parsuje liczbe w formacie PL ("0,123" lub "0.123"). Zwraca null gdy brak/0.
function parseNum(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const v = parseFloat(s);
  if (!isFinite(v) || v <= 0) return null;
  return v;
}

function isPodejrzanyM3(m3: number, jm: string, nazwa: string, nazwaDod: string, waga: number | null): boolean {
  // Regula 1: m3 absurdalnie duzy (>5 m3 per szt to bug w 99% przypadkow)
  if (m3 > 5) return true;
  // Regula 2: m3 > 2 dla SZT (pojedyncza sztuka > 2 palety)
  if (jm.toUpperCase() === 'SZT' && m3 > 2) return true;
  // Regula 3: m3 ≈ waga (z dokladnoscia 0.001 i przy wartosciach >0.1)
  if (waga != null && Math.abs(m3 - waga) < 0.001 && m3 > 0.1) return true;
  // Regula 4: produkty w ml/L z m3 > 0.5 (puszka spray, butelka — nie moga byc > 500L)
  if (m3 > 0.5) {
    const text = `${nazwa} ${nazwaDod}`.toLowerCase();
    const hasMl = /\d+\s*ml\b/.test(text);
    const hasL = /\d+(?:[,.]\d+)?\s*l\b/.test(text);
    // Wykluczenia: styropian/welna/wata/izolacja moga miec duze m3
    const wyklucz = /styrop|wełna|welna|wata|izolac|płyta|plyta|panel|rolka|mata/i.test(text);
    if ((hasMl || hasL) && !wyklucz) return true;
  }
  return false;
}

/**
 * Sparsuj 1 wiersz danych do KatalogRow.
 * Wszystkie kolumny opcjonalne poza kod+nazwa (jesli brak — wiersz odrzucony).
 */
function mapRow(cells: string[]): KatalogRow | null {
  const kod = (cells[0] || '').trim();
  const nazwa = (cells[1] || '').trim();
  if (!kod || !nazwa) return null;

  const nazwa_dodatkowa = (cells[2] || '').trim() || null;
  const kod_producenta = (cells[3] || '').trim() || null;
  const jm = (cells[4] || '').trim() || null;
  const m3 = parseNum(cells[5]);
  const dzial = (cells[6] || '').trim() || null;
  const producent = (cells[7] || '').trim() || null;
  const waga = parseNum(cells[8]);
  // EAN moze byc "5907602498363,42" (artefakt Excela) — bierzemy tylko 8-14 cyfr
  let ean: string | null = null;
  const eanRaw = (cells[9] || '').trim();
  if (eanRaw) {
    const eanMatch = eanRaw.match(/\d{8,14}/);
    if (eanMatch) ean = eanMatch[0];
  }
  // HDS: kolumna 10. Tylko 'tak' (case-insensitive) = wymaga_hds=true. Wszystko inne = false.
  const hdsRaw = (cells[10] || '').trim().toLowerCase();
  const wymaga_hds = hdsRaw === 'tak';

  // Opcjonalne kolumny dla wyliczania palet z liczby sztuk (decyzja 15.05.2026):
  //   kolumna 11: szt_na_palecie — np. 240 dla dachowki, 60 dla bloczka, 22 dla papy
  //   kolumna 12: m3_per_paleta — domyslnie 1.1 (standard), nadpisuj tylko dla nietypowych
  let szt_na_palecie: number | null = null;
  const sztRaw = (cells[11] || '').trim().replace(',', '.');
  if (sztRaw) {
    const v = parseInt(sztRaw, 10);
    if (isFinite(v) && v > 0) szt_na_palecie = v;
  }
  const m3Pal = parseNum(cells[12]);

  const m3_podejrzany = m3 != null
    ? isPodejrzanyM3(m3, jm || '', nazwa, nazwa_dodatkowa || '', waga)
    : false;

  return {
    kod,
    kod_producenta,
    ean,
    nazwa,
    nazwa_dodatkowa,
    jm,
    m3_per_szt: m3,
    m3_podejrzany,
    dzial,
    producent,
    kg_per_szt: waga,
    szt_na_palecie,
    m3_per_paleta: m3Pal,
    wymaga_hds,
  };
}

/**
 * Parser CSV z poprawna obsluga cudzyslowow (zeby srednik w nazwie nie rozbil kolumn).
 * Kodowanie cp1250 — wykryte z formatu pliku Ekonom.
 */
export async function parseKatalogCSV(file: File): Promise<KatalogRow[]> {
  const buf = await file.arrayBuffer();
  // Decode cp1250 -> UTF-8 (TextDecoder obsluguje 'windows-1250')
  const decoder = new TextDecoder('windows-1250');
  const text = decoder.decode(buf);
  return parseCSVText(text);
}

function parseCSVText(text: string): KatalogRow[] {
  // CSV parser respektujacy cudzyslowy: "abc;def" jest 1 polem mimo srednika w srodku
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ';') { cur.push(field); field = ''; }
      else if (c === '\r') continue;
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else field += c;
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }

  // Pierwszy wiersz to header — pomijamy
  const dataRows = rows.slice(1).filter(r => r.length >= 2 && r[0]?.trim());
  const out: KatalogRow[] = [];
  const seen = new Set<string>();
  for (const r of dataRows) {
    const parsed = mapRow(r);
    if (parsed && !seen.has(parsed.kod)) {
      out.push(parsed);
      seen.add(parsed.kod);
    }
  }
  return out;
}

/** Parser XLSX (lazy load SheetJS — kompatybilnosc z Lovable). */
export async function parseKatalogXLSX(file: File): Promise<KatalogRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const dataRows = data.slice(1).filter(r => r.length >= 2 && String(r[0] ?? '').trim());
  const out: KatalogRow[] = [];
  const seen = new Set<string>();
  for (const r of dataRows) {
    const parsed = mapRow(r.map(c => String(c ?? '')));
    if (parsed && !seen.has(parsed.kod)) {
      out.push(parsed);
      seen.add(parsed.kod);
    }
  }
  return out;
}
