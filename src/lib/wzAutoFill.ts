/**
 * Smart prefill — pomocniki do automatycznego wypełniania formularza nowego
 * zlecenia na podstawie danych z parsera WZ/zamówienia.
 *
 * Sesja 13.05.2026:
 *  - data z uwag ("transport DD.MM.YYYY")
 *  - default dzień dostawy (jutro/pojutrze, pomija weekendy)
 *  - wyliczenie m³ z pozycji towarów (wymiary z opisu: "wym 600x1000" + grubość)
 */

import type { Pozycja } from '@/components/shared/ModalImportWZ';

/**
 * Wyciąga sugerowaną datę dostawy z pola Uwagi.
 *
 * Obsługiwane formaty (z prefixem "transport"/"dostawa"/"termin"/"data dostawy"
 * lub bez — bierzemy pierwszą rozsądną datę):
 *   - "transport 05.05.2026"
 *   - "dostawa: 5.05.2026"
 *   - "termin 5/5/2026"
 *   - "05-05-2026"
 *   - "2026-05-05" (ISO)
 *
 * Zwraca w formacie ISO "YYYY-MM-DD" lub null gdy brak / data starsza niż dziś
 * (nie ma sensu sugerować daty przeszłej — to pewnie data wystawienia dokumentu,
 * nie planowanej dostawy).
 */
export function wyciagnijDateZUwag(uwagi: string | null | undefined): string | null {
  if (!uwagi) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();

  const formatDate = (yyyy: number, mm: number, dd: number): string | null => {
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 2020 || yyyy > 2099) return null;
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  // PRIORYTET 1: data z keyword'em "transport/dostawa/termin/data dostawy".
  // Rok opcjonalny — jesli brak, uzywamy biezacego (Sewera nie ma dostaw z wyprzedzeniem rocznym).
  // Bierzemy ZAWSZE niezaleznie czy data jest >= dzis (WZ moga przyjsc retrospektywnie).
  const reKeyword = /(?:transport|dostawa|termin|data\s+dostawy)\s*[:.]?\s*(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}))?/i;
  const keywordMatch = uwagi.match(reKeyword);
  if (keywordMatch) {
    const dd = parseInt(keywordMatch[1], 10);
    const mm = parseInt(keywordMatch[2], 10);
    const yyyy = keywordMatch[3] ? parseInt(keywordMatch[3], 10) : currentYear;
    const iso = formatDate(yyyy, mm, dd);
    if (iso) return iso;
  }

  // PRIORYTET 2: data na POCZATKU uwag (pierwsza linia, pierwsze tokeny) — typowy zapis
  // sprzedawcow Sewery: "23.04 cena ok az" czy "5.05 pilne". Rok = biezacy (bez wyprzedzenia rocznego).
  const firstLine = uwagi.split(/\r?\n/)[0].trim();
  const reFirst = /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}))?\b/;
  const firstMatch = firstLine.match(reFirst);
  if (firstMatch) {
    const dd = parseInt(firstMatch[1], 10);
    const mm = parseInt(firstMatch[2], 10);
    const yyyy = firstMatch[3] ? parseInt(firstMatch[3], 10) : currentYear;
    const iso = formatDate(yyyy, mm, dd);
    if (iso) return iso;
  }

  // FALLBACK: dowolna data w uwagach, ale tylko >= dzis (zeby nie wziac daty wystawienia)
  const candidates: string[] = [];

  // Format DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY
  const reEU = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = reEU.exec(uwagi)) !== null) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 2020 || yyyy > 2099) continue;
    candidates.push(`${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  }

  // Format YYYY-MM-DD (ISO) — może występować obok EU
  const reISO = /(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = reISO.exec(uwagi)) !== null) {
    const yyyy = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 2020 || yyyy > 2099) continue;
    candidates.push(`${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  }

  // Wybierz pierwszą datę >= dziś (najwcześniejsza sensowna)
  for (const iso of candidates) {
    const d = new Date(iso + 'T00:00:00');
    if (d >= today) return iso;
  }

  return null;
}

/**
 * Wyciąga sugerowaną godzinę dostawy z pola Uwagi i mapuje na slot z TIME_OPTIONS.
 *
 * Obsługiwane formaty:
 *   - "godz. 8:00" / "godzina 8" / "g. 8:00"
 *   - "o godz. 8:00" / "po godz. 8" / "przed 14:00"
 *   - "transport ... godz. 8:00"
 *
 * Mapowanie A (literalne, decyzja 15.05.2026): X → najmniejszy slot taki że slot >= X.
 *   - 0-8   → "do 8:00"
 *   - 9-10  → "do 10:00"
 *   - 11-12 → "do 12:00"
 *   - 13-14 → "do 14:00"
 *   - 15-16 → "do 16:00"
 *   - 17+   → "Dowolna"
 *
 * Zwraca string ze slotem (np. "do 8:00") lub null gdy brak godziny w uwagach.
 */
export function wyciagnijGodzineZUwag(uwagi: string | null | undefined): string | null {
  if (!uwagi) return null;
  // Pattern: opcjonalne "o/po/przed" + opcjonalne "godz./godzina/g." + liczba + opcjonalne ":MM"
  // Akceptujemy 1-2 cyfry (24h), separator ":" lub "." (np. "8.00")
  const re = /(?:^|\s)(?:o\s+|po\s+|przed\s+)?(?:godz?(?:ina)?\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?\b/i;
  // Szukamy w fragmencie zawierającym słowo "godz" — żeby nie złapać "p=48szt" czy daty "8.00"
  const godzCtx = uwagi.match(/(?:godz?\.?|godzina)\s*\d/i);
  if (!godzCtx) return null;
  const m = uwagi.slice(godzCtx.index ?? 0).match(re);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (h < 0 || h > 23) return null;
  if (h <= 8) return 'do 8:00';
  if (h <= 10) return 'do 10:00';
  if (h <= 12) return 'do 12:00';
  if (h <= 14) return 'do 14:00';
  if (h <= 16) return 'do 16:00';
  return 'Dowolna';
}

/**
 * Domyślna sugerowana data dostawy gdy brak w uwagach:
 *   - przed 12:00 → ten sam dzień (dzisiaj)
 *   - od 12:00   → kolejny dzień roboczy
 *
 * Pomija weekendy: gdy wynik wypada w sobotę/niedzielę → przesuwa na poniedziałek.
 * Gdy dziś jest weekend i jest przed 12:00 → też przesuwa do najbliższego dnia roboczego.
 * Zwraca format ISO "YYYY-MM-DD".
 */
export function domyslnyDzienDostawy(): string {
  const now = new Date();
  const offset = now.getHours() >= 12 ? 1 : 0;
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  // Pomijaj soboty (6) i niedziele (0)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Wylicza objętość (m³) dla pojedynczej pozycji towarowej z WZ.
 *
 * Algorytm (sesja 13.05.2026, rozszerzenie 3D 18.05.2026):
 *  1. Pomija usługi (USŁUGA / TRANSPORT / MONTAŻ / DOSTAWA / ROBOCIZNA)
 *  2a. Format 3D "wym wys X × dł Y × szer Z" (długie elementy: nadproża/belki) →
 *      m³ = X × Y × Z × ilość (bez grubości z nazwy)
 *  2.  Z nazwy_dodatkowej: "wym 600x1000" → wymiary płyty (mm)
 *  3.  Z nazwy_towaru: ostatnia liczba (np. "150" w "FASOTERM 150") → grubość (mm)
 *  4.  Z nazwy_dodatkowej: "opak=1,2m2" → powierzchnia opakowania (m²)
 *  5.  Sztuk per opak = powierzchnia_opak / powierzchnia_plyty (gdy JM=OPA)
 *  6.  m³ per opak = sztuk_per_opak × powierzchnia_plyty × grubość
 *
 * Przykład 2D: ISOVER FASOTERM 150, wym 600x1000, opak=1,2m2, JM=OPA, ilość=166
 *  → 0,18 m³/opak × 166 = 29,88 m³
 * Przykład 3D: RECTOR Nadproże, wym wys 71 x dł 2700 x szer 115, JM=SZT, ilość=8
 *  → 0,071 × 2,7 × 0,115 × 8 = 0,18 m³
 *
 * @returns objętość w m³ lub null gdy nie udało się wyliczyć
 */
/**
 * Czy pozycja to paleta jako towar (zwrotna, do odkupu)?
 * Np. "PALETA TERMOBET ODKUP M-39zł P-45zł" — to palety pod inny towar z WZ,
 * NIE zajmują dodatkowego miejsca na aucie (juz policzone w pozycji glownej).
 * Sygnal: nazwa zaczyna sie od "PALETA "/"PALETY " (nie zawiera gdziekolwiek).
 */
export function isPaletaJakoTowar(p: Pozycja): boolean {
  return /^(PALETA|PALETY)\s/i.test(p.nazwa_towaru.trim());
}

/**
 * Czy pozycja to material puchaty (welna, styropian, izolacja)?
 * Decyzja 15.05.2026: takie materialy NIE zajmuja miejsca paletowego na aucie
 * (mozna polozyc NA innym towarze, sa miekkie/lekkie). m3 wciaz liczymy z
 * wymiarow (zajmuja objetosc auta).
 *
 * Sygnal: NAZWA TOWARU zawiera 'wełna/welna', 'styrop', 'izolac', 'wata', 'XPS',
 * 'EPS', lub konkretne nazwy producentow (FASOTERM, AKU-PŁYTA).
 *
 * UWAGA 1: 'PŁYTA' jest TYLKO w kontekscie wełny/izolacji (np. AKU-PŁYTA),
 *   nie wszystkie "płyty" sa puchate (plyty gipsowe/OSB NIE — twarde plyty).
 * UWAGA 2: szukamy TYLKO w nazwa_towaru, NIE w nazwa_dodatkowa (decyzja 18.05.2026).
 *   Inaczej "TYTAN PIANOKLEJ DO STYROPIANU" złapane fałszywie jako puchaty —
 *   to puszka kleju z opisem zastosowania, nie izolacja.
 */
export function isPuchatyMaterial(p: Pozycja): boolean {
  return /wełna|welna|styrop|izolac\b|wata\b|\bXPS\b|\bEPS\b|FASOTERM|AKU-PŁYTA|AKU-PLYTA/i.test(p.nazwa_towaru);
}

/**
 * Wymiary towaru w mm — zwraca dwa największe wymiary (do detekcji płyt/długich
 * towarów). Pomija grubość (<100 mm) gdy są ≥2 inne wymiary.
 *
 * Szuka w priorytetowej kolejności:
 *   1. opis 3D: "wym wys X × dł Y × szer Z" (nadproża RECTOR)
 *   2. opis 2D: "wym X × Y" (płyty gipsowe w opisie)
 *   3. nazwa towaru: "XmmxYxZ" (OSB-3 18mmx1250x2500) / "XxYxZ" / "XxY"
 *
 * Zwraca {max: 0, min: 0} gdy brak danych. Sesja 18.05.2026.
 */
export function getWymiaryMm(p: Pozycja): { max: number; min: number } {
  const opis = p.nazwa_dodatkowa || '';
  const nazwa = p.nazwa_towaru || '';
  const wymiary: number[] = [];

  // 1. Opis 3D z prefixami (wys/dł/szer + polskie litery)
  const op3D = opis.match(
    /wym\s+(?:[^\s0-9x×]+\s+)?(\d+)\s*[x×]\s*(?:[^\s0-9x×]+\s+)?(\d+)\s*[x×]\s*(?:[^\s0-9x×]+\s+)?(\d+)/i,
  );
  if (op3D) {
    wymiary.push(parseInt(op3D[1], 10), parseInt(op3D[2], 10), parseInt(op3D[3], 10));
  } else {
    // 2. Opis 2D
    const op2D = opis.match(/wym\s*(\d+)\s*[x×]\s*(\d+)/i);
    if (op2D) wymiary.push(parseInt(op2D[1], 10), parseInt(op2D[2], 10));
    // 3. Nazwa towaru — 3D z grubością mm ("18mmx1250x2500")
    const nm3DMm = nazwa.match(/(\d+)\s*mm\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)/i);
    if (nm3DMm) {
      wymiary.push(parseInt(nm3DMm[1], 10), parseInt(nm3DMm[2], 10), parseInt(nm3DMm[3], 10));
    } else {
      // 4. Nazwa towaru — 3D bez mm
      const nm3D = nazwa.match(/\b(\d{2,5})\s*[x×]\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\b/i);
      if (nm3D) {
        wymiary.push(parseInt(nm3D[1], 10), parseInt(nm3D[2], 10), parseInt(nm3D[3], 10));
      } else {
        // 5. Nazwa towaru — 2D
        const nm2D = nazwa.match(/\b(\d{2,5})\s*[x×]\s*(\d{2,5})\b/);
        if (nm2D) wymiary.push(parseInt(nm2D[1], 10), parseInt(nm2D[2], 10));
      }
    }
  }

  if (wymiary.length === 0) return { max: 0, min: 0 };
  // Pomijaj grubość (<100 mm) gdy są ≥2 inne wymiary (jak "18mm" w OSB).
  let filtered = wymiary.filter((w) => w >= 100);
  if (filtered.length < 2) filtered = wymiary;
  filtered.sort((a, b) => b - a);
  return { max: filtered[0], min: filtered[1] ?? filtered[0] };
}

/** Wstecz-kompatybilny: tylko maksymalny wymiar w mm. */
export function getMaxWymiarMm(p: Pozycja): number {
  return getWymiaryMm(p).max;
}

/**
 * Sumuje paczki materiałów puchatych z WZ + wykrywa wariant (XPS / EPS / WELNA).
 * Używane do walidacji "auto pomieści tyle paczek styropianu" (kolumny
 * xps_paczek / eps_paczek w `flota`, migracja 18.05.2026).
 *
 * Wariant:
 *   - XPS: ≥1 pozycja puchata z 'XPS' w nazwie
 *   - EPS: ≥1 pozycja puchata z 'EPS' w nazwie
 *   - WELNA: pozycje puchate bez XPS/EPS (wełna, FASOTERM, AKU-PŁYTA)
 *   - MIX: ≥2 z powyższych w jednym WZ (rzadkie)
 *   - null: brak puchatego
 *
 * paczki = suma `ilosc` wszystkich pozycji puchatych (JM zwykle OPA).
 */
export function policzPaczkiPuchatego(pozycje: Pozycja[] | undefined | null): {
  paczki: number;
  typ: 'XPS' | 'EPS' | 'WELNA' | 'MIX' | null;
} {
  if (!pozycje || pozycje.length === 0) return { paczki: 0, typ: null };
  let xps = 0;
  let eps = 0;
  let welna = 0;
  for (const p of pozycje) {
    if (!isPuchatyMaterial(p)) continue;
    const ilosc = p.ilosc || 0;
    if (ilosc <= 0) continue;
    const nazwa = p.nazwa_towaru || '';
    if (/\bXPS\b/i.test(nazwa)) xps += ilosc;
    else if (/\bEPS\b/i.test(nazwa)) eps += ilosc;
    else welna += ilosc;
  }
  const total = xps + eps + welna;
  if (total === 0) return { paczki: 0, typ: null };
  const nonZero = [xps, eps, welna].filter((x) => x > 0).length;
  if (nonZero > 1) return { paczki: Math.round(total), typ: 'MIX' };
  if (xps > 0) return { paczki: Math.round(total), typ: 'XPS' };
  if (eps > 0) return { paczki: Math.round(total), typ: 'EPS' };
  return { paczki: Math.round(total), typ: 'WELNA' };
}

/**
 * Liczba miejsc paletowych na podłodze auta dla płyty/towaru o danych wymiarach.
 * Paleta euro = 1200 × 800 mm. Płyta układana wzdłuż osi długiej auta (szerokość
 * palety 800 wzdłuż jazdy), więc:
 *   miejsc = round(dłuższy_wymiar / 800) × round(krótszy_wymiar / 1200)
 *
 * Przykłady (sesja 18.05.2026):
 *   OSB 1250×2500 → round(2500/800)=3 × round(1250/1200)=1 = 3 miejsca
 *   Gips 1200×2600 → round(2600/800)=3 × 1 = 3 miejsca
 *   Płyta 1200×3000 → round(3000/800)=4 × 1 = 4 miejsca
 *   Wełna 600×1000 → 1 × 1 = 1 (i tak 0 — puchaty wyklucza wcześniej)
 *
 * Zwraca 1 gdy brak wymiarów (default = standardowa paleta).
 */
export function policzMiejscaPaletowePlyty(max: number, min: number): number {
  if (max === 0) return 1;
  const dl = Math.max(1, Math.round(max / 800));
  const sz = Math.max(1, Math.round(min / 1200));
  return dl * sz;
}

/** Frakcja palety dla pozycji — z opisu. 0 gdy brak.
 *  Obsluguje 2 konwencje producentow:
 *    - "p=32opak" (Isover/Sievert — krotka forma)
 *    - "paleta=100szt." (Wienerberger/Brukbet — pelna forma)
 *  Wymaga zeby przed `p`/`paleta` byl start/spacja/nawias — zeby nie lapac
 *  artefaktow typu "P-45zl" lub "M-MAGAZYN".
 */
export function wyliczPaletyFrakcjaPozycji(p: Pozycja): number {
  if (/USŁUGA|TRANSPORT|MONTAŻ|DOSTAWA|ROBOCIZNA/i.test(p.nazwa_towaru)) return 0;
  if (isPaletaJakoTowar(p)) return 0;
  // Puchaty material (wełna, styropian) NIE zajmuje miejsca paletowego — mozna polozyc na innym
  if (isPuchatyMaterial(p)) return 0;
  const opis = p.nazwa_dodatkowa || '';
  const pM = opis.match(/(?:^|[\s(])(?:paleta|p)\s*=\s*(\d+)\s*(?:szt|opak|m2|m3)?/i);
  if (!pM) return 0;
  const perPaleta = parseInt(pM[1], 10);
  if (perPaleta <= 0) return 0;
  const paletyProducenta = p.ilosc / perPaleta;

  // Plyty/dluzsze towary niemieszczace sie na euro-palecie 1200x800 — kazda paleta
  // producenta zajmuje N miejsc paletowych na podlodze auta wg wzoru
  // round(max/800) × round(min/1200). Decyzja 18.05.2026 (zastapilo ryczalt ×2).
  // Przyklady: OSB 1250x2500 = 3 miejsca, plyta 1200x3000 = 4 miejsca.
  const { max, min } = getWymiaryMm(p);
  if (max > 1200 || min > 800) {
    const miejsc = policzMiejscaPaletowePlyty(max, min);
    return Math.max(1, Math.ceil(paletyProducenta)) * miejsc;
  }
  return paletyProducenta;
}

/**
 * Czy pozycja to "długi luźny" — element konstrukcyjny pakowany w wiązki/luzem,
 * NIE na euro-paletę (nadproża, belki, słupy, rury, profile, blachy długie).
 *
 * Sygnał: opis ma 3D `wym X×Y×Z` z którymkolwiek wymiarem > 2000 mm
 * (nie zmieści się na palecie 1,2×0,8 m) ORAZ brak `p=`/`paleta=` w opisie
 * (gdyby producent pakował na palecie, podałby `p=`).
 *
 * Przykład: RECTOR Nadproże, "wym wys 71 x dł 2700 x szer 115 (wiązka=25szt)"
 *  → 2700 mm > 2000 mm, brak `p=`/`paleta=` → długi luźny → na podłodze auta.
 *
 * Sesja 18.05.2026.
 */
export function isDlugiLuzny(p: Pozycja): boolean {
  if (/USŁUGA|TRANSPORT|MONTAŻ|DOSTAWA|ROBOCIZNA/i.test(p.nazwa_towaru)) return false;
  if (isPaletaJakoTowar(p)) return false;
  if (isPuchatyMaterial(p)) return false;
  const opis = p.nazwa_dodatkowa || '';
  // Paleta producenta — wtedy NIE długi luźny.
  if (/(?:^|[\s(])(?:paleta|p)\s*=\s*\d+/i.test(opis)) return false;
  // 3D wymiary z prefixami: [^\s0-9x×]+ obsługuje polskie litery (dł/szer/gr).
  const wym3D = opis.match(
    /wym\s+(?:[^\s0-9x×]+\s+)?(\d+)\s*[x×]\s*(?:[^\s0-9x×]+\s+)?(\d+)\s*[x×]\s*(?:[^\s0-9x×]+\s+)?(\d+)/i,
  );
  if (!wym3D) return false;
  const maxMm = Math.max(parseInt(wym3D[1], 10), parseInt(wym3D[2], 10), parseInt(wym3D[3], 10));
  return maxMm > 2000;
}

export function wyliczObjetoscPozycji(p: Pozycja): number | null {
  // 1. Pomijaj usługi
  if (/USŁUGA|TRANSPORT|MONTAŻ|DOSTAWA|ROBOCIZNA/i.test(p.nazwa_towaru)) return null;
  // 1a. Pomijaj palety jako towar (zwrotne — nie zajmują dodatkowego m³)
  if (isPaletaJakoTowar(p)) return null;

  const opis = p.nazwa_dodatkowa || '';

  // 1b. PRIORYTET: jeśli opis podaje wprost objętość paczki "X,Ym3" (typowo dla
  // styropianu — np. "paczka 2m2 / 0,3m3"), bierzemy to wprost.
  // Sanity: 0,001 - 5 m³ per opak/paczka (filtr przeciwko np. "100m3" jako artefakt).
  // Tylko dla OPA — bo dla SZT nie wiemy co liczba m³ znaczy bez kontekstu.
  if (p.jm.toUpperCase().startsWith('OPA')) {
    const m3Direct = opis.match(/([\d]+[,.]?\d*)\s*m3\b/i);
    if (m3Direct) {
      const m3PerOpak = parseFloat(m3Direct[1].replace(',', '.'));
      if (m3PerOpak >= 0.001 && m3PerOpak <= 5) {
        return m3PerOpak * p.ilosc;
      }
    }
  }

  // 2a. Format 3D: "wym wys 71 x dł 2700 x szer 115" (długie elementy strunobetonowe:
  //     nadproża RECTOR, belki, słupy). Każda wartość w mm; opcjonalne prefiksy między
  //     `wym` a liczbami (wys/dł/szer/gr) lub między x a liczbą. Daje pełną m³ bez
  //     potrzeby brania grubości z nazwy — wynik = a × b × c × ilość.
  //     Bezpieczne dla 2D + opak= (regex wymaga TRZECH liczb rozdzielonych x).
  //     UWAGA: prefix matchuje `[^\s0-9x×]+` (nie `\w+`), bo polskie `ł`/`ą`/itp.
  //     nie są częścią \w w JS — bez flagi /u "dł" by się rozjechało po `d`.
  const wym3D = opis.match(
    /wym\s+(?:[^\s0-9x×]+\s+)?(\d+)\s*[x×]\s*(?:[^\s0-9x×]+\s+)?(\d+)\s*[x×]\s*(?:[^\s0-9x×]+\s+)?(\d+)/i,
  );
  if (wym3D) {
    const a = parseInt(wym3D[1], 10) / 1000;
    const b = parseInt(wym3D[2], 10) / 1000;
    const c = parseInt(wym3D[3], 10) / 1000;
    // Sanity: każdy wymiar 0,001 m – 5 m (1 mm – 5000 mm)
    if (a >= 0.001 && a <= 5 && b >= 0.001 && b <= 5 && c >= 0.001 && c <= 5) {
      const m3Total = a * b * c * p.ilosc;
      return m3Total > 0 ? m3Total : null;
    }
  }

  // 2. Wymiary płyty z opisu: "wym 600x1000" (mm) → m
  const wymM = opis.match(/wym\s*(\d+)\s*[x×]\s*(\d+)/i);
  if (!wymM) return null;
  const dl = parseInt(wymM[1], 10) / 1000;
  const sz = parseInt(wymM[2], 10) / 1000;
  if (dl < 0.05 || sz < 0.05) return null; // sanity check

  // 3. Grubość z nazwy:
  //    Wariant A: "FASOTERM 150" — liczba na samym koncu nazwy (mm domyslnie)
  //    Wariant B: "RIGIPS PLYTA GKF 12,5mm" — liczba + 'mm' (z dziesietnym)
  //    UWAGA: stripujemy lambda termiczna typu "^=0,037" (welna ma ja jako wspolczynnik)
  //    zeby regex nie wzial "037" jako grubosc zamiast prawdziwej "75".
  const nazwaNoLambda = p.nazwa_towaru.replace(/\s*(?:\^|λ|lambda)\s*=\s*\d+[,.]\d+/gi, '').trim();
  const grubMmm = nazwaNoLambda.match(/(\d+(?:[,.]\d+)?)\s*mm\b/i);
  const grubM = nazwaNoLambda.match(/\b(\d{2,4})\s*$/);
  let gr: number;
  if (grubMmm) {
    gr = parseFloat(grubMmm[1].replace(',', '.')) / 1000;
  } else if (grubM) {
    gr = parseInt(grubM[1], 10) / 1000;
  } else {
    return null;
  }
  if (gr < 0.001 || gr > 1.0) return null; // sanity: grubość 1-1000 mm

  const m3PerPlyta = dl * sz * gr;
  const pwPlyty = dl * sz; // m² powierzchni jednej płyty

  // 4. Liczba sztuk per JM (OPA): "opak=1,2m2" / powierzchnia_płyty = sztuk.
  // Sewera używa "opak", "paczka", "paleta" wymiennie (różni producenci) — wszystkie
  // znaczą "powierzchnia opakowania w m²" z której wyciągamy ile płyt mieści się w 1 JM.
  let sztukPerJm = 1;
  if (p.jm.toUpperCase().startsWith('OPA')) {
    const opakM = opis.match(/(?:opak|paczka|paleta)\s*[=:]?\s*([\d,.]+)\s*m2/i);
    if (opakM && pwPlyty > 0) {
      const opakM2 = parseFloat(opakM[1].replace(',', '.'));
      sztukPerJm = Math.max(1, Math.round(opakM2 / pwPlyty));
    }
  }

  const m3Total = m3PerPlyta * sztukPerJm * p.ilosc;
  return m3Total > 0 ? m3Total : null;
}

/**
 * Suma m³ wszystkich pozycji z WZ. Zwraca też ile pozycji rozpoznano
 * vs nierozpoznano (dla komunikatu typu "Wyliczono z 2/3 pozycji").
 */
/** Średnia objętość 1 palety w m³ (zakres typowo 1,0-1,2 — decyzja 14.05: bierzemy 1,1). */
export const M3_PER_PALETA = 1.1;

export function wyliczObjetoscZPozycji(pozycje: Pozycja[] | undefined | null): {
  m3Total: number;
  /** Liczba palet — ceil(suma frakcji palet z pozycji z p=Xszt w opisie).
   *  Pozycje BEZ p= są pomijane (decyzja 14.05). */
  palet: number;
  rozpoznane: number;
  nierozpoznane: number;
  pominiete: number; // usługi
  /** True gdy >=1 pozycja to "długi luźny" (3D z wymiarem >2000 mm bez palety
   *  producenta) — sygnał do auto-zaznaczenia "Bez palet" w formularzu. */
  dlugi_luzny: boolean;
} {
  if (!pozycje || pozycje.length === 0) {
    return { m3Total: 0, palet: 0, rozpoznane: 0, nierozpoznane: 0, pominiete: 0, dlugi_luzny: false };
  }
  let m3Total = 0;
  let paletFrac = 0;
  let rozpoznane = 0;
  let nierozpoznane = 0;
  let pominiete = 0;
  let dlugi_luzny = false;
  for (const p of pozycje) {
    if (/USŁUGA|TRANSPORT|MONTAŻ|DOSTAWA|ROBOCIZNA/i.test(p.nazwa_towaru) || isPaletaJakoTowar(p)) {
      pominiete += 1;
      continue;
    }
    if (isDlugiLuzny(p)) dlugi_luzny = true;
    const m3FromWym = wyliczObjetoscPozycji(p);
    const paletyForThis = wyliczPaletyFrakcjaPozycji(p);
    paletFrac += paletyForThis;

    // m³: priorytet wymiarów (precyzyjne). Jeśli brak → szacunek z palet × 1,1
    // (typowa paleta ma ~1-1,2 m³). Pozycje bez wymiarów i bez p= → null/pominięte.
    let m3 = m3FromWym ?? 0;
    if (m3 === 0 && paletyForThis > 0) {
      m3 = paletyForThis * M3_PER_PALETA;
    }
    if (m3 > 0) {
      m3Total += m3;
      rozpoznane += 1;
    } else {
      nierozpoznane += 1;
    }
  }
  // Ceil sumy frakcji palet, ale z progiem dla ostatka: drobny dodatek (< 0,2 palety)
  // dolicza sie do poprzedniej palety, bo w praktyce na palecie zostaje miejsce dla
  // 1-2 sztuk z innej pozycji. Przyklad: 33/33 + 2/24 = 1,083 → 1 paleta (nie 2).
  // Min 1 paleta gdy paletFrac > 0 (cos trzeba przewiezc, choc nie pelna).
  const fullPalet = Math.floor(paletFrac);
  const remainder = paletFrac - fullPalet;
  const palet = paletFrac === 0 ? 0 : Math.max(1, fullPalet + (remainder > 0.2 ? 1 : 0));
  return { m3Total, palet, rozpoznane, nierozpoznane, pominiete, dlugi_luzny };
}

/**
 * Klasyfikacja ladunku na podstawie pozycji + masy. Zwraca finalne wartosci
 * m3/palet + flagi luzne_karton/bez_palet do auto-zaznaczenia checkboxow.
 *
 * Zasada (15.05.2026):
 *  - jezeli parser wyliczyl m3/palety z opisow (wym/X,Ym3/p=Xszt) → wartosci wyliczone
 *  - jezeli parser nic nie wyliczyl I masa <= 100 kg → drobnica (karton/luzne, bez palet)
 *    (100 kg to ~3-5 kartonow, mozna upchnac na aucie bez palet — typowa dostawa drobnicy)
 *  - jezeli parser nic nie wyliczyl I masa > 100 kg → 0/0, user uzupelnia recznie
 *    (zbyt duzo zeby na pewno bylo luzne, ale parser nie ma pewnosci)
 *
 * Edge case styropian/welna: opisy zawieraja "wym XxY" lub "X,Ym3" → parser wylicza
 * m3 → idzie sciezka "wyliczone" niezaleznie od malej wagi (np. 45 kg = 3 m3).
 */
export const MASA_PROG_DROBNICA_KG = 100;

export interface KlasyfikacjaLadunku {
  objetosc_m3: number;
  ilosc_palet: number;
  luzne_karton: boolean;
  bez_palet: boolean;
  /** True gdy ≥1 pozycja WZ wykryta w bazie katalog_towarow ma wymaga_hds=true. */
  wymaga_hds: boolean;
  /** Lista unikalnych dzialow ciezkich z bazy (do wyswietlenia w bannerze). */
  dzialy_hds: string[];
  /** Palety plyt gipsowych — do progu HDS (>1) w Smart Prefill. */
  palety_gips: number;
  /** Palety pozostalych pozycji wymaga_hds — do progu HDS (>2) w Smart Prefill. */
  palety_inne_hds: number;
}

/**
 * Wynik agregacji z bazy katalog_towarow (zwracany przez agregujZKatalogu).
 * Podajemy opcjonalnie do klasyfikujLadunek — baza ma priorytet nad parserem opisu.
 */
export interface KatalogAgregatInput {
  m3_total: number;
  palet_total: number;
  wymaga_hds: boolean;
  dzialy_hds: string[];
  pozycji_z_baza: number;
  /** Palety producenta plyt gipsowych — prog HDS > 1 (decyzja 15.05.2026). */
  palety_gips: number;
  /** Palety pozostalych pozycji wymaga_hds=true — prog HDS > 2. */
  palety_inne_hds: number;
}

export function klasyfikujLadunek(
  pozycje: Pozycja[] | undefined | null,
  masaKg: number,
  fallbackM3: number = 0,
  fallbackPalet: number = 0,
  katalog?: KatalogAgregatInput,
): KlasyfikacjaLadunku {
  let m3 = 0;
  let palet = 0;
  let rozpoznane = 0;
  let dlugi_luzny = false;
  let ma_puchaty = false;
  const wymaga_hds = katalog?.wymaga_hds ?? false;
  const dzialy_hds = katalog?.dzialy_hds ?? [];
  const palety_gips = katalog?.palety_gips ?? 0;
  const palety_inne_hds = katalog?.palety_inne_hds ?? 0;

  // Sygnały "długi luźny" i "puchaty" liczymy ZAWSZE z pozycji (niezależnie od priorytetu
  // m³/palet), bo katalog_towarow nie ma takich flag — to czyste heurystyki opisu/nazwy.
  // Oba sygnały służą do auto-zaznaczenia "Bez palet" (towar bez euro-palety).
  if (pozycje && pozycje.length > 0) {
    dlugi_luzny = pozycje.some(isDlugiLuzny);
    ma_puchaty = pozycje.some(isPuchatyMaterial);
  }

  // Priorytet 1: baza katalog_towarow (gdy mamy dla wszystkich/wiekszosci pozycji)
  // Decyzja 15.05: baza ma najwyzszy priorytet, bo dane sa precyzyjne i autorytatywne.
  // Parser opisu (regex wym/X,Ym3/p=Xszt) tylko gdy baza nie pokrywa danej pozycji.
  if (katalog && katalog.pozycji_z_baza > 0 && katalog.m3_total > 0) {
    m3 = katalog.m3_total;
    palet = katalog.palet_total;
    rozpoznane = katalog.pozycji_z_baza;
  }

  // Priorytet 2: parser opisu (gdy baza nic nie zwrocila)
  if (m3 === 0 && pozycje && pozycje.length > 0) {
    const calc = wyliczObjetoscZPozycji(pozycje);
    rozpoznane = calc.rozpoznane;
    if (calc.rozpoznane > 0) m3 = Math.round(calc.m3Total * 100) / 100;
    palet = calc.palet;
  }

  // Priorytet 3: fallback do wartosci z PDF/zamowienia
  if (m3 === 0) m3 = fallbackM3;
  if (palet === 0) palet = fallbackPalet;

  // Auto-drobnica: zero ze wszystkich zrodel + masa <= 100 kg → luzne karton
  if (rozpoznane === 0 && m3 === 0 && palet === 0 && masaKg > 0 && masaKg <= MASA_PROG_DROBNICA_KG) {
    return { objetosc_m3: 0, ilosc_palet: 0, luzne_karton: true, bez_palet: true, wymaga_hds, dzialy_hds, palety_gips, palety_inne_hds };
  }

  // Auto-bez-palet: gdy palet finalnie = 0 I towar nie wymaga euro-palety:
  //  - długi luźny (3D >2000 mm, bez palety producenta) — nadproża, belki, słupy
  //  - puchaty materiał (wełna, styropian, izolacje) — kładziemy na innym towarze
  // Decyzja 18.05.2026.
  const bez_palet = palet === 0 && (dlugi_luzny || ma_puchaty);

  // m3 NIE jest wymuszane na palety × 1,1 — agregat (wyliczObjetoscZPozycji /
  // agregujZKatalogu) liczy m3 per pozycja wg priorytetu (fizyczne wymiary →
  // palety × 1,1 → m3 z bazy). Puchaty material (wełna, styropian) wnosi m3
  // fizyczne ale 0 palet — wymuszenie spojnosci by go gubilo.

  return { objetosc_m3: Math.round(m3 * 100) / 100, ilosc_palet: palet, luzne_karton: false, bez_palet, wymaga_hds, dzialy_hds, palety_gips, palety_inne_hds };
}

/**
 * Wersja async — pobiera dane z bazy katalog_towarow (Supabase) i potem
 * wywoluje klasyfikujLadunek z agregatem. Dynamic import lookupu zeby
 * nie ladowac modulu Supabase w komponentach gdzie go nie potrzeba.
 */
export async function klasyfikujWZAsync(
  pozycje: Pozycja[] | undefined | null,
  masaKg: number,
  fallbackM3: number = 0,
  fallbackPalet: number = 0,
): Promise<KlasyfikacjaLadunku> {
  let katalog: KatalogAgregatInput | undefined;
  if (pozycje && pozycje.length > 0) {
    try {
      const { wzbogacZKatalogu, agregujZKatalogu } = await import('@/lib/katalogLookup');
      const matches = await wzbogacZKatalogu(pozycje);
      const agr = agregujZKatalogu(pozycje, matches);
      // Bierzemy agregat gdy mamy choc jeden wynik: pozycja w katalogu, palety lub m3.
      // Agregat liczy palety/m3 takze dla pozycji BEZ katalogu (regex z opisu),
      // wiec moze byc uzyteczny nawet gdy pozycji_z_baza=0.
      if (agr.pozycji_z_baza > 0 || agr.palet_total > 0 || agr.m3_total > 0) {
        katalog = {
          m3_total: agr.m3_total,
          palet_total: agr.palet_total,
          wymaga_hds: agr.wymaga_hds,
          dzialy_hds: agr.dzialy_hds,
          pozycji_z_baza: Math.max(agr.pozycji_z_baza, 1), // >=1 zeby klasyfikujLadunek wzial wynik z bazy
          palety_gips: agr.palety_gips,
          palety_inne_hds: agr.palety_inne_hds,
        };
      }
    } catch (e) {
      console.warn('[klasyfikujWZAsync] Lookup w bazie katalog_towarow nie powiodl sie:', e);
    }
  }
  return klasyfikujLadunek(pozycje, masaKg, fallbackM3, fallbackPalet, katalog);
}
