/**
 * Parser dokumentow "Potwierdzenie zamowienia" z programu Ekonom (Sewera).
 *
 * Rozne od WZ:
 * - brak numeru WZ (pole pozostaje null)
 * - numer zamowienia w formacie R5/RE/2026/05/00120
 * - sekcja "Sprzedawca / Nabywca" zamiast "Sprzedawca / Odbiorca"
 * - sekcja "Adres dostawy" jest OPCJONALNA (gdy klient odbiera u siebie)
 * - jezeli brak Adres dostawy -> wyciagamy z sekcji Nabywca
 * - "Uwagi dot. wysylki:" zamiast "Uwagi:"
 * - brak m3, palet (pola pozostaja 0)
 * - waga z linii pod "Razem: X" (pdfjs zwraca w specyficznej kolejnosci)
 *
 * Zwraca te sama strukture co parseWZText (WZImportData) zeby UI mogl
 * wyswietlic preview tym samym komponentem.
 */

import type { WZImportData } from '@/components/shared/ModalImportWZ';

/** Normalizuje liczby PL: "1 234,56" -> 1234.56, "0,72" -> 0.72 */
function parsePLNumber(s: string): number | null {
  if (!s) return null;
  const cleaned = s.trim().replace(/\s+/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Splituje raw text na linie, trim, usun puste */
function toLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

export function parseZamowienieText(rawText: string): WZImportData {
  const lines = toLines(rawText);

  // 1. NUMER ZAMOWIENIA - "nr: R5/RE/2026/05/00120" lub samo R5 w tekscie
  let nr_zamowienia: string | null = null;
  // Najpierw szukaj "nr: R5/..." (najpewniejsza forma)
  const nrLine = lines.find(l => /^nr:\s*R5\s*\//i.test(l));
  if (nrLine) {
    const m = nrLine.match(/R5\s*\/\s*[A-Z]{2,3}\s*\/\s*\d{4}\s*\/\s*\d{2}\s*\/\s*\d+/i);
    if (m) nr_zamowienia = m[0].replace(/\s+/g, '');
  }
  // Fallback - dowolne wystapienie R5/.../.../.../...
  if (!nr_zamowienia) {
    for (const l of lines) {
      const m = l.match(/R5\s*\/\s*[A-Z]{2,3}\s*\/\s*\d{4}\s*\/\s*\d{2}\s*\/\s*\d+/i);
      if (m) {
        nr_zamowienia = m[0].replace(/\s+/g, '');
        break;
      }
    }
  }

  // 2. ADRES DOSTAWY i ODBIORCA
  // Logika:
  //  a) Jesli jest sekcja "Adres dostawy" -> wyciagamy stamtad (priorytet)
  //  b) Brak -> wyciagamy z sekcji Nabywca (po "Sprzedawca Nabywca", prawa kolumna)
  //
  // pdfjs zwraca dwukolumnowy uklad jako pionowa liste, lewa potem prawa.
  // Po "Sprzedawca Nabywca" mamy: [SEWERA, ul. Tadeusza, NIP, BDO, REDYSTRYBUCJA,
  // ul. KOSCIUSZKI 326] (lewa) potem [Nabywca name, adres, kod+miasto, Nr ewid] (prawa).
  let odbiorca: string | null = null;
  let adres: string | null = null;
  let osoba_kontaktowa: string | null = null;
  let tel: string | null = null;

  const adresIdx = lines.findIndex(l => /^Adres\s+dostawy\s*$/i.test(l));

  if (adresIdx >= 0) {
    // Sekcja "Adres dostawy" istnieje - wyciagamy odbiorca i adres stamtad
    const STOP = /^(Os\.\s*kontaktowa|Tel\.|Lp\.|Nazwa\s+towaru|Sprzedawca|Nabywca|Informacje|Wystawil|Razem)/i;
    const block: string[] = [];
    for (let i = adresIdx + 1; i < lines.length && i <= adresIdx + 10; i++) {
      const l = lines[i];
      if (STOP.test(l)) break;
      if (/^Nr\s+ewid/i.test(l)) continue;
      block.push(l);
    }
    // Pierwsza linia bloku = odbiorca (np. "Rek"), reszta = adres
    if (block.length > 0) odbiorca = block[0];
    if (block.length > 1) {
      // Sklejam adres z linii ktore wygladaja na adres (ul./kod pocztowy)
      const addrParts = block.slice(1).filter(l =>
        /^(?:ul|al|os|pl)\.\s/i.test(l) || /\d{2}-?\d{3}\s/.test(l)
      );
      if (addrParts.length > 0) adres = addrParts.join(', ').replace(/,\s*,/g, ',');
    }
  } else {
    // Brak "Adres dostawy" - wyciagamy z sekcji Nabywca
    const sprNabIdx = lines.findIndex(l => /Sprzedawca/i.test(l) && /Nabywca/i.test(l));
    if (sprNabIdx >= 0) {
      // Prefiksy lewej kolumny (Sewera) do odciecia
      const SEWERA_PREFIXES: RegExp[] = [
        /^SEWERA\s+POLSKA\s+CHEMIA\s+IRENEUSZ\s+WOLAK\b[\s,.]*/i,
        /^ul\.\s+Tadeusza\s+Ko[a-zA-Z]+\s*\d+\s*,?\s*\d{2}\s*-?\s*\d{3}\s+Katowice\s*/i,
        /^ul\.\s+KO[ŚS]CIUSZKI\s*\d+\s*,?\s*\d{2}\s*-?\s*\d{3}\s+KATOWICE\s*/i,
        /^NIP:\s*\d{10}\b\s*/i,
        /^N[RH]\s*BDO:\s*\d+\b\s*/i,
      ];

      let rightName: string | null = null;
      let rightSubName: string | null = null;
      const rightAddr: string[] = [];

      for (let i = sprNabIdx + 1; i < Math.min(sprNabIdx + 12, lines.length); i++) {
        let l = lines[i];
        // Odetnij prefix lewej
        for (const p of SEWERA_PREFIXES) {
          const m = l.match(p);
          if (m) { l = l.slice(m[0].length).trim(); break; }
        }
        if (/^REDYSTRYBUCJA\b|^ODDZIAŁ\b/i.test(l)) continue;
        if (/^Informacje\s*$/i.test(l)) break;
        if (/^Odbiorca\s*$/i.test(l)) break;
        if (/^Adres\s+dostawy/i.test(l)) break;
        if (/^Nr\s+ewid/i.test(l)) break;
        if (l.length < 2) continue;

        const isAddr = /^(?:ul|al|os|pl)\.\s/i.test(l) || /\d{2}-?\d{3}\s/.test(l);
        if (isAddr) {
          rightAddr.push(l);
        } else if (!rightName) {
          rightName = l;
        } else if (!rightSubName) {
          // Druga linia nazwy (np. "NIEDZWIECKI STANISLAW" pod "STANEX-BUD ZAKLAD...")
          rightSubName = l;
        }
      }

      if (rightName) {
        odbiorca = rightSubName ? `${rightName} ${rightSubName}` : rightName;
      }
      if (rightAddr.length) {
        adres = rightAddr.join(', ').replace(/,\s*,/g, ',');
      }
    }
  }

  // 3. OSOBA KONTAKTOWA + TELEFON
  // "Os. kontaktowa: klient" + "Tel.: 697 102 050 / 032 456 57"
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const osM = l.match(/^Os\.\s*kontaktowa:\s*(.+)$/i);
    if (osM) {
      osoba_kontaktowa = osM[1].trim();
    }
    const telM = l.match(/^Tel\.?:\s*(.+)$/i);
    if (telM && !tel) {
      // Mozliwe ze tel jest na 2 liniach - skleic z nastepna jesli zaczyna sie od "tel"
      let telVal = telM[1].trim();
      if (i + 1 < lines.length && /^tel\.?\s+\d/i.test(lines[i + 1])) {
        telVal = `${telVal}, ${lines[i + 1].replace(/^tel\.?\s+/i, '').trim()}`;
      }
      tel = telVal;
    }
  }

  // 4. WAGA - "Waga netto razem: X" (X jest na osobnej linii nad/pod, format zalezy od pdfjs)
  //
  // Ekonom uklada tabele tak:
  //   <linia produktu>           np. "2,00 SZT 30,40 60,80"
  //   <ilosc razem>               np. "2,00"
  //   <waga razem>                np. "0,72" lub "50,00"
  //   "Razem: <wartosc netto>"    np. "Razem: 60,80"
  //   "Waga netto razem:"
  //
  // Algorytm: znajdz "Waga netto razem:" -> linia 2 wczesniej = waga, linia 1 wczesniej = "Razem: ..."
  let masa_kg: number | null = null;
  const wagaIdx = lines.findIndex(l => /^Waga\s+netto\s+razem:?\s*$/i.test(l));
  if (wagaIdx >= 2) {
    const linePoprzednia = lines[wagaIdx - 1];
    const isRazem = /^Razem:/i.test(linePoprzednia);
    if (isRazem) {
      // 2 linie wczesniej = waga
      const wagaCandidate = lines[wagaIdx - 2];
      // Format PL liczby: 0,72 / 50,00 / 1 234,56
      if (/^[\d\s]+,\d+$/.test(wagaCandidate.trim())) {
        masa_kg = parsePLNumber(wagaCandidate);
      }
    }
  }
  // Fallback: "Waga netto razem: X" w jednej linii
  if (masa_kg == null) {
    const inlineWaga = lines.find(l => /Waga\s+netto\s+razem:?\s*[\d\s]+,\d+/i.test(l));
    if (inlineWaga) {
      const m = inlineWaga.match(/Waga\s+netto\s+razem:?\s*([\d\s]+,\d+)/i);
      if (m) masa_kg = parsePLNumber(m[1]);
    }
  }

  // 5. UWAGI dot. wysylki - "Uwagi dot. wysylki:" do "Wystawil:"
  let uwagi: string | null = null;
  const uwagiIdx = lines.findIndex(l => /^Uwagi\s+dot\.\s*wysy[lł]ki:?\s*$/i.test(l));
  if (uwagiIdx >= 0) {
    const STOP = /^(Wystawi[lł]|Osoba\s+drukuj|Wydruk\s+z\s+programu|Strona\s+\d)/i;
    const buf: string[] = [];
    for (let i = uwagiIdx + 1; i < lines.length && i <= uwagiIdx + 8; i++) {
      const l = lines[i];
      if (STOP.test(l)) break;
      buf.push(l);
    }
    if (buf.length > 0) uwagi = buf.join(' ').trim();
  }

  return {
    numer_wz: null, // zamowienie nie ma WZ
    nr_zamowienia,
    odbiorca,
    adres,
    tel,
    osoba_kontaktowa,
    masa_kg,
    ilosc_palet: null, // nie ma w zamowieniach
    objetosc_m3: null, // nie ma w zamowieniach
    uwagi,
    typ_dokumentu: 'zamowienie',
    ma_adres_dostawy: adresIdx >= 0,
  };
}
