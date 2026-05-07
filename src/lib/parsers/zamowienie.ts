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
      // Prefiksy lewej kolumny (Sewera) do odciecia. Polskie litery w "Kościuszki" wymagaja
      // pelnej klasy znakow (a-z + diakrytyki) - klasa [a-zA-Z] gubi 'ś', 'ż' itp.
      const SEWERA_PREFIXES: RegExp[] = [
        /^SEWERA\s+POLSKA\s+CHEMIA\s+IRENEUSZ\s+WOLAK\b[\s,.]*/i,
        /^ul\.\s+Tadeusza\s+Ko[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+\s*\d+\s*,?\s*\d{2}\s*-?\s*\d{3}\s+Katowice\s*/i,
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

  // 4. WAGA - "Waga netto razem" + liczba (kolejnosc zalezy od pdfjs)
  //
  // Ekonom uklada tabele tak (logiczna kolejnosc):
  //   <linia produktu>           np. "2,00 SZT 30,40 60,80"
  //   <ilosc razem>               np. "2,00"
  //   <waga razem>                np. "0,72" lub "50,00"
  //   "Razem: <wartosc netto>"    np. "Razem: 60,80"
  //   "Waga netto razem:"
  //
  // pdfjs moze rozjechac kolejnosc - probujemy kilku heurystyk po kolei.
  let masa_kg: number | null = null;
  const wagaIdx = lines.findIndex(l => /Waga\s+netto\s+razem/i.test(l));

  if (wagaIdx >= 0) {
    // (a) Inline: "Waga netto razem: 50,00" (liczba na tej samej linii)
    const inlineMatch = lines[wagaIdx].match(/Waga\s+netto\s+razem:?\s*(\d{1,6}(?:\s\d{3})*[,.]\d{1,3})/i);
    if (inlineMatch) {
      masa_kg = parsePLNumber(inlineMatch[1]);
    }

    // (b) Po "Waga netto razem:" - liczba na nastepnej linii
    if (masa_kg == null) {
      for (let i = wagaIdx + 1; i <= Math.min(wagaIdx + 2, lines.length - 1); i++) {
        const l = lines[i].trim();
        if (/^Razem:/i.test(l)) continue;
        if (/^\d{1,6}(?:\s\d{3})*[,.]\d{1,3}$/.test(l)) {
          masa_kg = parsePLNumber(l);
          break;
        }
      }
    }

    // (c) Przed "Waga netto razem:" - skanuj wstecz, pomijaj "Razem: X" i wartosci netto
    // (wartosc netto = liczba bezposrednio po "Razem:"). Wage rozpoznajemy jako pierwsza
    // czysta liczba PL nad "Waga netto razem" ktora nie jest wartoscia netto.
    if (masa_kg == null) {
      // Wartosc netto z linii "Razem: VAL" - wykluczamy ja
      let wartoscNetto: number | null = null;
      for (let i = wagaIdx - 1; i >= Math.max(0, wagaIdx - 5); i--) {
        const m = lines[i].match(/^Razem:\s*(\d{1,6}(?:\s\d{3})*[,.]\d{1,3})/i);
        if (m) { wartoscNetto = parsePLNumber(m[1]); break; }
      }
      // Skanuj wstecz max 5 linii, weź pierwsza liczbe X,YY rozna od wartosci netto i 0
      for (let i = wagaIdx - 1; i >= Math.max(0, wagaIdx - 5); i--) {
        const l = lines[i].trim();
        if (/^Razem:/i.test(l)) continue;
        if (/^\d{1,6}(?:\s\d{3})*[,.]\d{1,3}$/.test(l)) {
          const num = parsePLNumber(l);
          if (num != null && num > 0 && num !== wartoscNetto) {
            masa_kg = num;
            break;
          }
        }
      }
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
