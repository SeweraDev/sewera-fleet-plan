/**
 * Parser CSV z systemu magazynowego (Promak/Ekonom export).
 *
 * Format: 'Zestawienie HHHH.csv' — eksport WZ z magazynu.
 * Encoding: Windows-1250 (typowy dla starszych systemow PL).
 * Separator: srednik (;)
 * Pierwsze 2 linie to naglowek (linia tytulowa + nazwy kolumn).
 *
 * Filtr: wiersze z pustym 'Miejsce dostawy' (kol 31) sa pomijane jako
 * 'odbiór własny' / kurier — ich nie dostarczamy.
 *
 * Po imporcie pola brakujace w CSV (m³, palety, klasyfikacja, telefon,
 * typ_pojazdu, preferowana_godzina) zostaja puste — dyspozytor uzupelnia
 * w widoku zlecenia. Auto-plan uzywa proxy z wagi gdy m³/palety puste.
 */

/** Status wiersza po parsowaniu (przed wstawieniem do DB). */
export type ImportRowStatus = 'ok' | 'skip_pusta_dostawa' | 'skip_brak_numeru' | 'duplikat';

/** Pojedyncze zlecenie do importu. */
export interface ImportRow {
  /** Numer wiersza w CSV (LP) — do diagnostyki. */
  lp: number;
  /** Status wiersza — czy nadaje sie do importu, czy pomijamy. */
  status: ImportRowStatus;
  /** Numer WZ z systemu magazynowego (np. RE/112/26/04/0002173). */
  numer_wz: string;
  /** Numer zamowienia (np. B2C/RE/2026/04/00781). */
  nr_zamowienia: string | null;
  /** Kontrahent (firma/osoba). */
  odbiorca: string;
  /** Waga netto (kg). */
  masa_kg: number;
  /** Adres dostawy w formacie 'ul. ULICA NR, MIASTO' (parsed z 'Miejsce dostawy'). */
  adres: string;
  /** Wartosc netto sprzedazy (zl). */
  wartosc_netto: number | null;
  /** Uwagi z dokumentu. */
  uwagi: string | null;
}

/** Wynik parsowania calego pliku. */
export interface ImportParseResult {
  rows: ImportRow[];
  totalRows: number;
  okCount: number;
  skipCount: number;
  /** Bledy parsowania (np. niemozliwa do parsowania linia). */
  errors: string[];
}

/**
 * Decoduj plik z auto-detekcja encoding'u.
 * Default: Windows-1250 (typowy export z Promak/Ekonom).
 * Fallback: UTF-8 z BOM jesli wykryty.
 */
export async function decodeFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const view = new Uint8Array(buffer);
  // UTF-8 BOM: EF BB BF
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer);
  }
  // Default: Windows-1250 (export z Promak/Ekonom)
  return new TextDecoder('windows-1250').decode(buffer);
}

/** Parse string z separatorem ';' uwzgledniajac cudzyslowy (proste). */
function splitCsvLine(line: string): string[] {
  // System Promak NIE uzywa cudzyslowow w tym eksporcie — proste split wystarcza.
  // Gdyby zawieral cudzyslowy: trzeba state-machine. Zostawiamy proste.
  return line.split(';');
}

/** Parse polish-formatted decimal: "404,71" -> 404.71 */
function parsePolskaDecimal(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/\s+/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse "Miejsce dostawy" jako 'Nazwa [MIASTO, ul. ULICA NR]'.
 * Zwraca adres w formacie 'ul. ULICA NR, MIASTO' (gotowy do geocodingu).
 *
 * Przyklady:
 *   "Artur Pospiech [LEDZINY, ul. Gwarkow ]" -> "ul. Gwarkow, LEDZINY"
 *   "ROMIBUD [Pyskowice, ul. WYSZYNSKIEGO 22-24 ]" -> "ul. WYSZYNSKIEGO 22-24, Pyskowice"
 *   "Erfarb [Jaworzno, ul. Mostowa 2]" -> "ul. Mostowa 2, Jaworzno"
 *   "" -> "" (puste, zlecenie pomijane)
 */
export function parseMiejsceDostawy(raw: string | undefined): string {
  if (!raw) return '';
  const m = raw.match(/\[\s*(.+?)\s*,\s*(.+?)\s*\]\s*$/);
  if (!m) return ''; // brak nawiasow → puste / niestandardowy format
  const miasto = m[1].trim();
  const ulica = m[2].trim();
  return `${ulica}, ${miasto}`;
}

/**
 * Parse caly tekst CSV → lista ImportRow.
 *
 * Pomija pierwsze 2 linie (tytuł + nagłowki kolumn).
 * Per linia: ekstrakcja pol, walidacja, status.
 */
export function parseCsv(text: string): ImportParseResult {
  const errors: string[] = [];
  const rows: ImportRow[] = [];

  // Normalize linie ends + split
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // Skip 2 linie naglowka, pomin puste linie na koncu
  const dataLines = lines.slice(2).filter((l) => l.trim().length > 0);

  for (let i = 0; i < dataLines.length; i++) {
    const cols = splitCsvLine(dataLines[i]);
    if (cols.length < 32) {
      errors.push(`Linia ${i + 3}: za malo kolumn (${cols.length}, oczekiwano 32+)`);
      continue;
    }

    const lp = parseInt(cols[0]) || i + 1;
    const numer_wz = (cols[3] || '').trim();
    const odbiorca = (cols[6] || '').trim();
    const masa_kg = parsePolskaDecimal(cols[8]);
    const uwagi_raw = (cols[16] || '').trim();
    const wartosc_netto_raw = parsePolskaDecimal(cols[18]);
    const nr_zamowienia = (cols[24] || '').trim();
    const miejsce_dostawy_raw = (cols[31] || '').trim();
    const adres = parseMiejsceDostawy(miejsce_dostawy_raw);

    let status: ImportRowStatus = 'ok';
    if (!numer_wz) {
      status = 'skip_brak_numeru';
    } else if (!miejsce_dostawy_raw || !adres) {
      status = 'skip_pusta_dostawa';
    }

    rows.push({
      lp,
      status,
      numer_wz,
      nr_zamowienia: nr_zamowienia || null,
      odbiorca,
      masa_kg,
      adres,
      wartosc_netto: wartosc_netto_raw > 0 ? wartosc_netto_raw : null,
      uwagi: uwagi_raw || null,
    });
  }

  const okCount = rows.filter((r) => r.status === 'ok').length;
  const skipCount = rows.filter((r) => r.status !== 'ok').length;

  return {
    rows,
    totalRows: rows.length,
    okCount,
    skipCount,
    errors,
  };
}

/**
 * Wczytaj plik + parse w jednej operacji.
 */
export async function parseCsvFile(file: File): Promise<ImportParseResult> {
  const text = await decodeFile(file);
  return parseCsv(text);
}
