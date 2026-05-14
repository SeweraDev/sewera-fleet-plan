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
export function wyliczObjetoscPozycji(p: Pozycja): number | null {
  // 1. Pomijaj usługi
  if (/USŁUGA|TRANSPORT|MONTAŻ|DOSTAWA|ROBOCIZNA/i.test(p.nazwa_towaru)) return null;

  const opis = p.nazwa_dodatkowa || '';

  // 2. Wymiary płyty z opisu: "wym 600x1000" (mm) → m
  const wymM = opis.match(/wym\s*(\d+)\s*[x×]\s*(\d+)/i);
  if (!wymM) return null;
  const dl = parseInt(wymM[1], 10) / 1000;
  const sz = parseInt(wymM[2], 10) / 1000;
  if (dl < 0.05 || sz < 0.05) return null; // sanity check

  // 3. Grubość z końca nazwy: "FASOTERM 150" → 150 mm → 0,15 m
  const grubM = p.nazwa_towaru.match(/\b(\d{2,4})\s*$/);
  if (!grubM) return null;
  const gr = parseInt(grubM[1], 10) / 1000;
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
export function wyliczObjetoscZPozycji(pozycje: Pozycja[] | undefined | null): {
  m3Total: number;
  rozpoznane: number;
  nierozpoznane: number;
  pominiete: number; // usługi
} {
  if (!pozycje || pozycje.length === 0) {
    return { m3Total: 0, rozpoznane: 0, nierozpoznane: 0, pominiete: 0 };
  }
  let m3Total = 0;
  let rozpoznane = 0;
  let nierozpoznane = 0;
  let pominiete = 0;
  for (const p of pozycje) {
    if (/USŁUGA|TRANSPORT|MONTAŻ|DOSTAWA|ROBOCIZNA/i.test(p.nazwa_towaru)) {
      console.log(`[m3-pos] [USLUGA-skip] lp=${p.lp} "${p.nazwa_towaru}"`);
      pominiete += 1;
      continue;
    }
    const m3 = wyliczObjetoscPozycji(p);
    console.log(`[m3-pos] lp=${p.lp} JM=${p.jm} il=${p.ilosc} nazwa="${p.nazwa_towaru}" opis="${p.nazwa_dodatkowa}" => m3=${m3}`);
    if (m3 != null && m3 > 0) {
      m3Total += m3;
      rozpoznane += 1;
    } else {
      nierozpoznane += 1;
    }
  }
  return { m3Total, rozpoznane, nierozpoznane, pominiete };
}
