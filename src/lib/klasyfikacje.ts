// Klasyfikacja transportu — oznacza typ pojazdu po którym rozliczany jest klient.
// Może różnić się od faktycznego pojazdu użytego do dostawy (np. klient zamówił
// HDS dla lekkiego towaru — rozliczamy wg HDS mimo że technicznie mogła jechać dostawcza).
//
// Ustawiane per WZ (zlecenia_wz.klasyfikacja) — dyspozytor lub sprzedawca wybiera
// przy tworzeniu zlecenia, klasyfikacja jest obowiązkowa.

export interface KlasyfikacjaOption {
  kod: string;
  opis: string;
  /** Odpowiadający typ cennikowy (dla referencji / ewentualnego automapowania) */
  typCennikowy: string;
}

export const KLASYFIKACJE: KlasyfikacjaOption[] = [
  { kod: 'A', opis: 'BEZ WINDY DO 700 KG',          typCennikowy: 'do 700kg' },
  { kod: 'B', opis: 'BEZ WINDY DO 1,2 T',           typCennikowy: 'do 1,2t bez windy' },
  { kod: 'C', opis: 'WINDA DO 1,8 T',               typCennikowy: 'z windą do 1,8t' },
  { kod: 'D', opis: 'WINDA DO 6 T',                 typCennikowy: 'z windą do 6t' },
  { kod: 'E', opis: 'WINDA DUŻA — MAX 15,8 T',      typCennikowy: 'z windą do 15t' },
  { kod: 'F', opis: 'HDS DUŻY (12,0t)',             typCennikowy: 'HDS 12,0t' },
  { kod: 'H', opis: 'HDS ŚREDNI (9,0t)',            typCennikowy: 'HDS 9,0t' },
];

/** Format rozszerzony do dropdowna: "B — BEZ WINDY DO 1,2 T" */
export function formatKlasyfikacjaLong(kod: string): string {
  const k = KLASYFIKACJE.find((x) => x.kod === kod);
  return k ? `${k.kod} — ${k.opis}` : kod;
}

/** Sprawdź czy kod jest poprawną klasyfikacją */
export function isValidKlasyfikacja(kod: string | null | undefined): boolean {
  if (!kod) return false;
  return KLASYFIKACJE.some((x) => x.kod === kod);
}
