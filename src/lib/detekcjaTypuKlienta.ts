/**
 * Auto-detekcja typu klienta po imporcie WZ (sesja 14.05.2026).
 *
 * Priorytet:
 *  1. R — kod klienta z PDF ("Nr ewid.: 11000452") jest w tabeli klienci_redystrybucja
 *  2. B — uwagi zawierają "B2C"
 *  3. D — odbiorca to osoba fizyczna (imię + nazwisko bez NIP/słów firmowych)
 *  4. W — default (Wykonawca; W+I połączone wg decyzji 14.05 — instytucje też klasyfikujemy jako W)
 *
 * Pracownik (P) NIE jest auto-detektowany — to margines (manualnie jeśli kiedyś).
 */

import { supabase } from '@/integrations/supabase/client';

export type TypKlientaDetected = 'R' | 'B' | 'D' | 'W';

interface DetekcjaInput {
  kodKlienta?: string | null;
  odbiorca?: string | null;
  uwagi?: string | null;
}

/** Czy nazwa odbiorcy wygląda jak osoba fizyczna (D detaliczny)?
 *  Heurystyka: 2-4 słowa, każde z dużej litery, BEZ słów organizacyjnych.
 */
function isOsobaFizyczna(odbiorca: string): boolean {
  const STOP_WORDS = /\b(SP[ÓO]ŁKA|S\.?A\.?|SP\.?\s*Z\s*O\.?\s*O\.?|PHU|FH|F\.H\.|FHU|F\.H\.U\.|PRZEDSI[ĘE]BIORSTWO|FIRMA|ZAK[ŁL]AD|US[ŁL]UGI|KANCELARIA|HURTOWNIA|SKLEP|MAGAZYN|CENTRUM|SP[ÓO]LDZIELNIA|STOWARZYSZENIE|FUNDACJA|GMINA|MIASTO|URZ[ĄA]D|S\.J\.|SJ|JAWNA|KOMANDYTOWA|SC|S\.C\.|TRANSPORT|HANDEL|PRODUKCJA|GROUP|TEAM)\b/i;
  if (STOP_WORDS.test(odbiorca)) return false;
  const slowa = odbiorca.trim().split(/\s+/).filter(s => s.length > 0);
  if (slowa.length < 2 || slowa.length > 4) return false;
  // Każde słowo musi zaczynać się z dużej litery (lub apostrof + duża)
  return slowa.every(s => /^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(s));
}

/** Detekcja typu klienta z danych WZ. Async bo R wymaga query do bazy. */
export async function detektujTypKlienta(input: DetekcjaInput): Promise<TypKlientaDetected> {
  // 1. R — kod klienta w bazie redystrybucji
  if (input.kodKlienta) {
    const kod = String(input.kodKlienta).trim();
    if (kod.length > 0) {
      try {
        const { data } = await supabase
          .from('klienci_redystrybucja' as any)
          .select('kod_kontrahenta')
          .eq('kod_kontrahenta', kod)
          .maybeSingle();
        if (data) return 'R';
      } catch (err) {
        // Tabela może jeszcze nie istnieć (migracja niewykonana) — silent fallback
        console.warn('[detektujTypKlienta] klienci_redystrybucja query failed:', err);
      }
    }
  }
  // 2. B — uwagi zawierają "B2C"
  if (input.uwagi && /\bB2C\b/i.test(input.uwagi)) {
    return 'B';
  }
  // 3. D — osoba fizyczna
  if (input.odbiorca && isOsobaFizyczna(input.odbiorca)) {
    return 'D';
  }
  // 4. Default W
  return 'W';
}
