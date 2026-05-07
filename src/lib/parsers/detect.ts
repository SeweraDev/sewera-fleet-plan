/**
 * Wykrywa typ dokumentu na podstawie tresci tekstowej.
 *
 * Sewera ma dwa typy dokumentow z programu Ekonom:
 * - WZ (Dokument wydania) - faktyczna dostawa, numer "WZ RE/..."
 * - Zamowienie (Potwierdzenie zamowienia) - planowanie, numer "R5/RE/..."
 *
 * Naglowki sa jednoznaczne wiec detekcja jest bezbledna.
 */

export type DocumentType = 'wz' | 'zamowienie' | 'unknown';

export function detectDocumentType(rawText: string): DocumentType {
  if (!rawText) return 'unknown';
  const t = rawText.slice(0, 2000); // pierwsze 2000 znakow wystarczy (naglowki)

  // Zamowienie: "Potwierdzenie zamowienia" + "nr: R5/..." - mocne sygnaly
  // Wlasciwie wystarczy jeden z tych dwoch.
  const hasZamowienieHeader = /Potwierdzenie\s+zam[oó]wienia/i.test(t);
  const hasR5Number = /\bR5\s*\/\s*[A-Z]{2,3}\s*\/\s*\d{4}\s*\/\s*\d{2}\s*\/\s*\d+/i.test(t);

  // WZ: "Dokument wydania" + "WZ RE/..."
  const hasWzHeader = /Dokument\s+wydania/i.test(t);
  const hasWzNumber = /\bWZ\s+[A-Z]{2,3}\s*\/\s*\d+\s*\/\s*\d{2}\s*\/\s*\d{2}\s*\/\s*\d+/i.test(t);

  // Priorytet: WZ wygrywa gdy oba (zamowienie moze byc zalacznikiem do WZ teoretycznie)
  if (hasWzHeader || hasWzNumber) return 'wz';
  if (hasZamowienieHeader || hasR5Number) return 'zamowienie';

  return 'unknown';
}
