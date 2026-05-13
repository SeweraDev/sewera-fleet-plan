/**
 * Smart prefill — pomocniki do automatycznego wypełniania formularza nowego
 * zlecenia na podstawie danych z parsera WZ/zamówienia.
 *
 * Sesja 13.05.2026: gdy w uwagach z WZ jest np. "transport 05.05.2026",
 * traktujemy to jako sugerowaną datę dostawy. User może oczywiście zmienić.
 */

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
