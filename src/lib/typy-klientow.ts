// Typ klienta — kategoryzacja odbiorcy zlecenia.
// Atrybut KLIENTA (firmy), nie towaru — dlatego per zlecenie (a nie per WZ),
// bo na jeden WZ jest tylko jeden klient (a w jednym zleceniu jeden klient).
//
// Wymagany przy tworzeniu zlecenia (sprzedawca/dyspozytor wybiera w Kroku 1).
// Edytowalny po stworzeniu (inline w widokach zlecen i kursow).

export interface TypKlientaOption {
  kod: string;
  opis: string;
  /** Tailwind klasa tla badge */
  bg: string;
  /** Tailwind klasa tekstu badge */
  text: string;
}

export const TYPY_KLIENTOW: TypKlientaOption[] = [
  { kod: 'R', opis: 'Redystrybucja', bg: 'bg-purple-100',  text: 'text-purple-900' },
  { kod: 'D', opis: 'Detal',         bg: 'bg-blue-100',    text: 'text-blue-900'   },
  { kod: 'P', opis: 'Pracownicy',    bg: 'bg-green-100',   text: 'text-green-900'  },
  { kod: 'W', opis: 'Wykonawcy',     bg: 'bg-orange-100',  text: 'text-orange-900' },
  { kod: 'I', opis: 'Instytucje',    bg: 'bg-slate-200',   text: 'text-slate-900'  },
  { kod: 'B', opis: 'B2C',           bg: 'bg-pink-100',    text: 'text-pink-900'   },
];

/** "R — Redystrybucja" */
export function formatTypKlientaLong(kod: string): string {
  const t = TYPY_KLIENTOW.find(x => x.kod === kod);
  return t ? `${t.kod} — ${t.opis}` : kod;
}

/** Sprawdz czy kod jest poprawny */
export function isValidTypKlienta(kod: string | null | undefined): boolean {
  if (!kod) return false;
  return TYPY_KLIENTOW.some(x => x.kod === kod);
}

/** Klasy Tailwind dla badge danego typu (do <span className={...}>) */
export function badgeClassesTypKlienta(kod: string | null | undefined): string {
  const t = TYPY_KLIENTOW.find(x => x.kod === kod);
  if (!t) return 'bg-muted text-muted-foreground';
  return `${t.bg} ${t.text}`;
}
