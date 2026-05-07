/**
 * Wspolny entry point parserow dokumentow Sewery.
 *
 * Wykrywa typ dokumentu (WZ vs Zamowienie) i wywoluje wlasciwy parser.
 * Zwraca strukture WZImportData (zachowujemy spojnosc dla UI preview).
 *
 * Uzycie:
 *   const { type, data } = await parseDocument(rawText);
 *   if (type === 'unknown') ... // pokazac warning
 *
 * Manualne wymuszenie typu (gdy auto-detekcja sie pomyli):
 *   const { data } = await parseDocument(rawText, { forceType: 'zamowienie' });
 */

import type { WZImportData } from '@/components/shared/ModalImportWZ';
import { detectDocumentType, type DocumentType } from './detect';
import { parseZamowienieText } from './zamowienie';

export type { DocumentType } from './detect';

export interface ParseResult {
  /** Wykryty (lub wymuszony) typ dokumentu */
  type: DocumentType;
  /** Sparsowane dane (te same pola dla WZ i zamowienia, niektore moga byc null) */
  data: WZImportData;
  /** Czy typ zostal auto-wykryty czy wymuszony przez usera */
  autoDetected: boolean;
}

export interface ParseOptions {
  /** Wymus konkretny typ (omija auto-detekcje) */
  forceType?: DocumentType;
}

export async function parseDocument(rawText: string, opts: ParseOptions = {}): Promise<ParseResult> {
  const detected = opts.forceType ?? detectDocumentType(rawText);
  const autoDetected = !opts.forceType;

  if (detected === 'zamowienie') {
    return { type: 'zamowienie', data: parseZamowienieText(rawText), autoDetected };
  }

  // WZ (lub unknown - traktujemy jak WZ, bo to historyczny default)
  // parseWZText importujemy dynamicznie zeby nie ladowac calego ModalImportWZ przy starcie
  const { parseWZText } = await import('@/components/shared/ModalImportWZ');
  return {
    type: detected === 'unknown' ? 'wz' : 'wz',
    data: parseWZText(rawText),
    autoDetected,
  };
}
