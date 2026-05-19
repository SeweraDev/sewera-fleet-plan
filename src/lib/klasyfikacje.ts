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
 * Sugeruj klasyfikację na podstawie wagi/objętości/palet/HDS — najmniejszy
 * typ pojazdu który pomieści ładunek. Używane po imporcie WZ gdy user nie wybrał
 * jeszcze typu pojazdu (Krok 2 nieukończony), ale chcemy wstępnie zasugerować.
 *
 * Pojemności:
 *   B - Dostawczy 1,2t:    1200 kg / 18,5 m³ / 7 palet
 *   C - Winda 1,8t:        1800 kg / 18 m³ / 7 palet
 *   D - Winda 6,3t:        6300 kg / 32 m³ / 13 palet
 *   E - Winda MAX 15,8t:   15800 kg / 60 m³ / 22 palet
 *   H - HDS 9,0t:          9000 kg / - / 12 palet
 *   F - HDS 12,0t:         11700 kg / - / 12 palet (przyjete jak 12000 dla sugestii)
 *
 * Gdy wymagaHds=true (>=1 pozycja w katalog_towarow ma wymaga_hds) ORAZ:
 *   - paletyGips > 1 (plyty gipsowe > 1 paleta producenta) LUB
 *   - paletyInneHds > 2 (pozostale HDS-materialy > 2 palety na aucie)
 * → sugerujemy H/F (HDS) zamiast B/C/D/E.
 *
 * Dla mniejszych zlecen (np. 1 paleta plyt gipsowych + welna + klej) HDS to
 * overkill — wystarczy winda. Decyzja 15.05.2026 noc.
 *
 * @returns kod klasyfikacji lub null gdy zaden pojazd nie pomiesci
 */
export function sugerujKlasyfikacjeWg(
  masa_kg: number,
  m3: number,
  palet: number,
  wymagaHds = false,
  paletyGips = 0,
  paletyInneHds = 0,
): string | null {
  // Prog HDS: plyty gipsowe > 1 paleta producenta LUB inne HDS-materialy > 2 palety
  const przekraczaProgHds = paletyGips > 1 || paletyInneHds > 2;
  // Gdy wymaga HDS i przekracza prog — preferuj F/H zamiast windy
  if (wymagaHds && przekraczaProgHds) {
    const HDS_POJAZDY: [number, number, string][] = [
      [9000, 12, 'H'],   // HDS sredni
      [12000, 12, 'F'],  // HDS duzy
    ];
    for (const [maxKg, maxPal, kod] of HDS_POJAZDY) {
      if (masa_kg <= maxKg && palet <= maxPal) {
        return kod;
      }
    }
    // Przekracza HDS — user dzieli ladunek (lub wybiera 2 kursy)
    return null;
  }

  // (max_kg, max_m3, max_pal, kod) — posortowane od najmniejszego
  const POJAZDY: [number, number, number, string][] = [
    [1200, 18.5, 7, 'B'],
    [1800, 18, 7, 'C'],
    [6300, 32, 13, 'D'],
    [15800, 60, 22, 'E'],
  ];
  for (const [maxKg, maxM3, maxPal, kod] of POJAZDY) {
    if (masa_kg <= maxKg && m3 <= maxM3 && palet <= maxPal) {
      return kod;
    }
  }
  return null; // przekracza wszystkie — user musi recznie wybrac F/H (HDS) lub podzielic
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

// ─── Wyrównywanie klasyfikacji w obrębie tego samego klienta+adresu+dnia+oddziału ───
//
// Reguła biznesowa: gdy 2+ WZ tego samego klienta jadą pod ten sam adres tego samego
// dnia z tego samego oddziału — wszystkie WZ muszą mieć tę samą klasyfikację (najwyższą
// w grupie). Powód: klient nie może rozbijać dostawy na małe WZ żeby finalnie pojechało
// auto większe a klient zapłacił za małe.
//
// Grupy traktowane OSOBNO:
//   - winda (B/C/D/E) — wyrównanie między tymi klasami
//   - HDS (H/F) — wyrównanie między tymi klasami
// Jeśli adres ma 1× HDS + 1× winda → dwie osobne sprawy, nie mieszamy.
//
// Wywoływane po INSERT/UPDATE WZ. Match klient+adres po prostym normalize
// (lowercase + trim) — A z 19.05.2026.

const HIER_WINDA: Record<string, number> = { B: 1, C: 2, D: 3, E: 4 };
const HIER_HDS: Record<string, number> = { H: 1, F: 2 };

function normKey(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

function maxKlasyfikacja(klasy: string[], hierarchia: Record<string, number>): string | null {
  if (klasy.length === 0) return null;
  let best = klasy[0];
  for (const k of klasy.slice(1)) {
    if ((hierarchia[k] ?? 0) > (hierarchia[best] ?? 0)) best = k;
  }
  return best;
}

export interface WyrownanieKlasResult {
  /** Ile WZ zostało zmienione w tej grupie. */
  zmienione: number;
  /** Reprezentatywna nazwa klienta z grupy (pierwszy WZ). */
  klient: string;
  /** Reprezentatywny adres z grupy. */
  adres: string;
  /** Klasa do której wyrównano. */
  klasaPo: string;
  /** "winda" lub "hds" — informacyjnie. */
  grupa: 'winda' | 'hds';
}

/**
 * Wyrównuje klasyfikację WZ w obrębie grupy (klient + adres + dzień + oddział)
 * do najwyższej w grupie. Wywoływane po INSERT/UPDATE WZ.
 *
 * Skanuje WSZYSTKIE zlecenia (nie tylko obecne) z tego dnia/oddziału, żeby wyrównać
 * cross-order (zlecenie A miało B, dodano zlecenie B z D → oba lecą do D).
 *
 * @returns lista zmian per grupa — pusta gdy nic nie wymagało wyrównania
 */
export async function wyrownajKlasyfikacjeZlecenia(
  zlecenieId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<WyrownanieKlasResult[]> {
  // 1. Pobierz kontekst zlecenia (dzień + oddział + status)
  const { data: zlecenie, error: e1 } = await supabase
    .from('zlecenia')
    .select('id, dzien, oddzial_id, status')
    .eq('id', zlecenieId)
    .single();
  if (e1 || !zlecenie) return [];
  if (zlecenie.status === 'anulowane') return [];

  // 2. Pobierz WZ tego zlecenia (kluczyki do grupowania)
  const { data: ourWz, error: e2 } = await supabase
    .from('zlecenia_wz')
    .select('id, odbiorca, adres, klasyfikacja')
    .eq('zlecenie_id', zlecenieId);
  if (e2 || !ourWz || ourWz.length === 0) return [];

  // 3. Zbierz unikalne klucze (klient+adres) z tego zlecenia
  const klucze = new Set<string>();
  for (const w of ourWz) {
    if (!w.klasyfikacja || !w.odbiorca || !w.adres) continue;
    klucze.add(`${normKey(w.odbiorca)}|${normKey(w.adres)}`);
  }
  if (klucze.size === 0) return [];

  // 4. Pobierz id wszystkich zleceń z tego dnia+oddziału (nieanulowane)
  const { data: zleceniaList, error: e3 } = await supabase
    .from('zlecenia')
    .select('id')
    .eq('dzien', zlecenie.dzien)
    .eq('oddzial_id', zlecenie.oddzial_id)
    .neq('status', 'anulowane');
  if (e3 || !zleceniaList || zleceniaList.length === 0) return [];

  const zlecenieIds = zleceniaList.map((z: { id: string }) => z.id);

  // 5. Pobierz wszystkie WZ z tych zleceń (z klasyfikacją)
  const { data: allWz, error: e4 } = await supabase
    .from('zlecenia_wz')
    .select('id, odbiorca, adres, klasyfikacja')
    .in('zlecenie_id', zlecenieIds)
    .not('klasyfikacja', 'is', null);
  if (e4 || !allWz) return [];

  // 6. Dla każdego klucza znajdź grupę, podziel HDS/Winda, wyrównaj do MAX
  const wyniki: WyrownanieKlasResult[] = [];

  for (const klucz of klucze) {
    const [klientN, adresN] = klucz.split('|');
    const grupa = (allWz as Array<{ id: string; odbiorca: string; adres: string; klasyfikacja: string }>)
      .filter(w => normKey(w.odbiorca) === klientN && normKey(w.adres) === adresN);

    if (grupa.length < 2) continue;

    const koszyki: Array<{ list: typeof grupa; hier: Record<string, number>; label: 'winda' | 'hds' }> = [
      { list: grupa.filter(w => ['B', 'C', 'D', 'E'].includes(w.klasyfikacja)), hier: HIER_WINDA, label: 'winda' },
      { list: grupa.filter(w => ['H', 'F'].includes(w.klasyfikacja)), hier: HIER_HDS, label: 'hds' },
    ];

    for (const k of koszyki) {
      if (k.list.length < 2) continue;
      const klasy = k.list.map(w => w.klasyfikacja);
      const maxK = maxKlasyfikacja(klasy, k.hier);
      if (!maxK) continue;

      const toUpdate = k.list.filter(w => w.klasyfikacja !== maxK);
      if (toUpdate.length === 0) continue;

      const ids = toUpdate.map(w => w.id);
      const { error: eUpd } = await supabase
        .from('zlecenia_wz')
        .update({ klasyfikacja: maxK })
        .in('id', ids);
      if (eUpd) {
        console.warn('[wyrownajKlasyfikacje] update failed:', eUpd.message);
        continue;
      }

      wyniki.push({
        zmienione: ids.length,
        klient: k.list[0].odbiorca,
        adres: k.list[0].adres,
        klasaPo: maxK,
        grupa: k.label,
      });
    }
  }

  return wyniki;
}
