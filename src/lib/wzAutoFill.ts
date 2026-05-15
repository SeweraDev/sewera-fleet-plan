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
 *   - przed 14:00 → jutro
 *   - po 14:00   → pojutrze (bo dyspozytorzy zwykle nie zdążą zaplanować na jutro)
 *
 * Pomija weekendy: gdy jutro/pojutrze wypada w sobotę/niedzielę → przesuwa na poniedziałek.
 * Zwraca format ISO "YYYY-MM-DD".
 */
export function domyslnyDzienDostawy(): string {
  const now = new Date();
  const offset = now.getHours() >= 14 ? 2 : 1;
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
 * Algorytm (sesja 13.05.2026):
 *  1. Pomija usługi (USŁUGA / TRANSPORT / MONTAŻ / DOSTAWA / ROBOCIZNA)
 *  2. Z nazwy_dodatkowej: "wym 600x1000" → wymiary płyty (mm)
 *  3. Z nazwy_towaru: ostatnia liczba (np. "150" w "FASOTERM 150") → grubość (mm)
 *  4. Z nazwy_dodatkowej: "opak=1,2m2" → powierzchnia opakowania (m²)
 *  5. Sztuk per opak = powierzchnia_opak / powierzchnia_plyty (gdy JM=OPA)
 *  6. m³ per opak = sztuk_per_opak × powierzchnia_plyty × grubość
 *
 * Przykład: ISOVER FASOTERM 150, wym 600x1000, opak=1,2m2, JM=OPA, ilość=166
 *  → płyta 0,6m × 1,0m × 0,15m = 0,09 m³/szt
 *  → 1,2 m² / 0,6 m² = 2 szt/opak
 *  → 0,18 m³/opak × 166 = 29,88 m³
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
 * Sygnal: nazwa zawiera 'wełna/welna', 'styrop', 'izolac', 'wata', 'XPS', 'EPS',
 * lub konkretne nazwy producentow (FASOTERM, AKU-PŁYTA).
 * UWAGA: 'PŁYTA' jest TYLKO w kontekscie wełny/izolacji (np. AKU-PŁYTA),
 * nie wszystkie "płyty" sa puchate (plyty gipsowe NIE — to twarde plyty).
 */
export function isPuchatyMaterial(p: Pozycja): boolean {
  const tekst = `${p.nazwa_towaru} ${p.nazwa_dodatkowa || ''}`;
  return /wełna|welna|styrop|izolac\b|wata\b|\bXPS\b|\bEPS\b|FASOTERM|AKU-PŁYTA|AKU-PLYTA/i.test(tekst);
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

  // Dlugie towary (plyty gipsowe 1200x2600, dachowki, etc.) — wymiary > 2000mm.
  // Pakowane na specjalnej palecie producenta (np. 1200x2600), ktora na aucie
  // zajmuje 2 standardowe miejsca paletowe (1200x800). Decyzja 15.05.2026.
  const wym = opis.match(/wym\s*(\d+)\s*[x×]\s*(\d+)/i);
  if (wym) {
    const max = Math.max(parseInt(wym[1], 10), parseInt(wym[2], 10));
    if (max > 2000) {
      // ceil palet producenta * 2 (zaokraglamy bo dlugi towar nie jest dzielony na frakcje)
      return Math.max(1, Math.ceil(paletyProducenta)) * 2;
    }
  }
  return paletyProducenta;
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

  // 2. Wymiary płyty z opisu: "wym 600x1000" (mm) → m
  const wymM = opis.match(/wym\s*(\d+)\s*[x×]\s*(\d+)/i);
  if (!wymM) return null;
  const dl = parseInt(wymM[1], 10) / 1000;
  const sz = parseInt(wymM[2], 10) / 1000;
  if (dl < 0.05 || sz < 0.05) return null; // sanity check

  // 3. Grubość z nazwy:
  //    Wariant A: "FASOTERM 150" — liczba na samym koncu nazwy (mm domyslnie)
  //    Wariant B: "RIGIPS PLYTA GKF 12,5mm" — liczba + 'mm' (z dziesietnym)
  const grubMmm = p.nazwa_towaru.match(/(\d+(?:[,.]\d+)?)\s*mm\b/i);
  const grubM = p.nazwa_towaru.match(/\b(\d{2,4})\s*$/);
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
} {
  if (!pozycje || pozycje.length === 0) {
    return { m3Total: 0, palet: 0, rozpoznane: 0, nierozpoznane: 0, pominiete: 0 };
  }
  let m3Total = 0;
  let paletFrac = 0;
  let rozpoznane = 0;
  let nierozpoznane = 0;
  let pominiete = 0;
  for (const p of pozycje) {
    if (/USŁUGA|TRANSPORT|MONTAŻ|DOSTAWA|ROBOCIZNA/i.test(p.nazwa_towaru) || isPaletaJakoTowar(p)) {
      pominiete += 1;
      continue;
    }
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
  return { m3Total, palet, rozpoznane, nierozpoznane, pominiete };
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
  const wymaga_hds = katalog?.wymaga_hds ?? false;
  const dzialy_hds = katalog?.dzialy_hds ?? [];

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
    return { objetosc_m3: 0, ilosc_palet: 0, luzne_karton: true, bez_palet: true, wymaga_hds, dzialy_hds };
  }

  // m3 NIE jest wymuszane na palety × 1,1 — agregat (wyliczObjetoscZPozycji /
  // agregujZKatalogu) liczy m3 per pozycja wg priorytetu (fizyczne wymiary →
  // palety × 1,1 → m3 z bazy). Puchaty material (wełna, styropian) wnosi m3
  // fizyczne ale 0 palet — wymuszenie spojnosci by go gubilo.

  return { objetosc_m3: Math.round(m3 * 100) / 100, ilosc_palet: palet, luzne_karton: false, bez_palet: false, wymaga_hds, dzialy_hds };
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
        };
      }
    } catch (e) {
      console.warn('[klasyfikujWZAsync] Lookup w bazie katalog_towarow nie powiodl sie:', e);
    }
  }
  return klasyfikujLadunek(pozycje, masaKg, fallbackM3, fallbackPalet, katalog);
}
