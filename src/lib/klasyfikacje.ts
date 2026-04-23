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

/**
 * Mapuj typ pojazdu (z TypPojazduStep, może być systemowy lub z prefiksem 'zew:')
 * na kod klasyfikacji. Zwraca null dla 'bez_preferencji', 'zewnetrzny' i pustych.
 *
 * Przykłady:
 *   'Dostawczy 1,2t'    → 'B'
 *   'Winda 6,3t'        → 'D'
 *   'HDS 12,0t'         → 'F'
 *   'zew:HDS 11,7t'     → 'F' (HDS 11,7t → HDS 12,0t)
 *   'bez_preferencji'   → null (klasyfikacja wymagana ręcznie)
 */
export function klasyfikacjaZTypu(typPojazdu: string | null | undefined): string | null {
  if (!typPojazdu) return null;
  if (typPojazdu === 'bez_preferencji' || typPojazdu === 'zewnetrzny') return null;

  // Strip prefix 'zew:' dla aut zewnętrznych
  const raw = typPojazdu.startsWith('zew:') ? typPojazdu.slice(4) : typPojazdu;

  // Mapowanie typów systemowych → cennikowych (duplikat z stawki-transportowe.ts,
  // trzymamy tu żeby nie wprowadzać cross-zależności między modułami)
  const TYP_TO_CENNIKOWY: Record<string, string> = {
    'Dostawczy 1,2t': 'do 1,2t bez windy',
    'Winda 1,8t': 'z windą do 1,8t',
    'Winda 6,3t': 'z windą do 6t',
    'Winda MAX 15,8t': 'z windą do 15t',
    'HDS 8,9t': 'HDS 9,0t',
    'HDS 9,0t': 'HDS 9,0t',
    'HDS 9,1t': 'HDS 9,0t',
    'HDS 11,7t': 'HDS 12,0t',
    'HDS 12,0t': 'HDS 12,0t',
    'HDS 12T': 'HDS 12,0t',
  };

  const cennikowy = TYP_TO_CENNIKOWY[raw] || raw;
  const k = KLASYFIKACJE.find((x) => x.typCennikowy === cennikowy);
  return k?.kod || null;
}
