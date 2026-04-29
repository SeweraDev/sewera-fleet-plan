import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { generateNumerZlecenia } from '@/lib/generateNumerZlecenia';
import type { ImportRow } from '@/lib/parseImportZlecen';

/**
 * Hook do bulk importu zlecen z CSV.
 *
 * Workflow:
 *   1. checkDuplicates() — pre-check kt\u00f3re numer_wz juz istnieja w DB
 *   2. importZlecenia() — bulk INSERT zlecenia + zlecenia_wz, status do_weryfikacji
 *
 * Geocoding NIE jest robiony tutaj — istniejacy mechanizm useMapaZlecen
 * geokoduje w tle gdy user otworzy mape lub auto-plan.
 */

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

/**
 * Sprawdz ktore z numerow WZ juz istnieja w bazie (zlecenia_wz.numer_wz).
 * Zwraca Set numerow ktore sa duplikatami.
 */
export async function checkDuplicates(numeryWz: string[]): Promise<Set<string>> {
  if (numeryWz.length === 0) return new Set();
  const { data, error } = await supabase
    .from('zlecenia_wz')
    .select('numer_wz')
    .in('numer_wz', numeryWz);
  if (error) {
    console.error('[useImportZlecenCsv] checkDuplicates error:', error);
    return new Set();
  }
  return new Set((data || []).map((d) => d.numer_wz).filter((v): v is string => !!v));
}

export function useImportZlecenCsv() {
  const [importing, setImporting] = useState(false);

  /**
   * Importuj wybrane wiersze.
   * Per row: generuj numer zlecenia + INSERT zlecenia + INSERT zlecenia_wz.
   *
   * @param rows tylko wiersze z status='ok' lub te ktore user explicit zaznaczyl
   * @param dzien dzien dostawy (YYYY-MM-DD) — taki sam dla wszystkich
   * @param oddzialId id oddzialu (kazde zlecenie ma swoj numer)
   * @param userId id usera (nadawca_id)
   */
  const importZlecenia = async (
    rows: ImportRow[],
    dzien: string,
    oddzialId: number,
    userId: string
  ): Promise<ImportResult> => {
    setImporting(true);
    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      duplicates: 0,
      errors: [],
    };

    try {
      for (const row of rows) {
        if (row.status !== 'ok') {
          result.skipped++;
          continue;
        }

        try {
          // Generuj numer zlecenia (ZL-KOD/YY/MM/NNN)
          const numer = await generateNumerZlecenia(oddzialId);

          // INSERT zlecenia
          const { data: zlecenie, error: errZl } = await supabase
            .from('zlecenia')
            .insert({
              numer,
              oddzial_id: oddzialId,
              typ_pojazdu: '', // puste — dyspozytor uzupelni
              dzien,
              preferowana_godzina: '', // puste
              nadawca_id: userId,
              status: 'do_weryfikacji',
            })
            .select('id')
            .single();

          if (errZl || !zlecenie) {
            result.errors.push(`${row.numer_wz}: ${errZl?.message || 'INSERT zlecenia nieudany'}`);
            continue;
          }

          // INSERT zlecenia_wz
          const { error: errWz } = await supabase
            .from('zlecenia_wz')
            .insert({
              zlecenie_id: zlecenie.id,
              numer_wz: row.numer_wz,
              nr_zamowienia: row.nr_zamowienia,
              odbiorca: row.odbiorca,
              adres: row.adres,
              tel: null, // puste — dyspozytor uzupelni
              masa_kg: row.masa_kg,
              objetosc_m3: 0, // puste — auto-plan uzywa proxy z wagi
              ilosc_palet: 0,
              uwagi: row.uwagi,
              klasyfikacja: null, // puste — dyspozytor uzupelni
              wartosc_netto: row.wartosc_netto,
            });

          if (errWz) {
            // Rollback: usun zlecenie
            await supabase.from('zlecenia').delete().eq('id', zlecenie.id);
            result.errors.push(`${row.numer_wz}: ${errWz.message}`);
            continue;
          }

          result.imported++;
        } catch (e: any) {
          result.errors.push(`${row.numer_wz}: ${e?.message || 'nieznany blad'}`);
        }
      }
    } finally {
      setImporting(false);
    }

    return result;
  };

  return { importZlecenia, importing };
}
