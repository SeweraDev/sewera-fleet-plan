// Rozliczenie kółka (jeden kurs) — orkiestracja algorytmu:
// 1. Dla każdego punktu: linia prosta oddział → adres (Haversine)
// 2. Udział % = linia_prosta / Σ linii prostych
// 3. km_punktu = udział × km_kolka
// 4. koszt_punktu = kosztKolka(km_punktu, klasyfikacja_punktu)
// 5. Jeśli adres ma wiele WZ: koszt_WZ = (wartosc_WZ / Σ wartości) × koszt_punktu
//
// Spec: memory/project_rozliczenie_kosztow_transportu.md

import { kosztKolka, isKlasyfikacjaRozliczalna, type KlasyfikacjaKod } from './stawki-rozliczenie';

export interface WzDoRozliczenia {
  id: string;
  numer_wz: string;
  odbiorca: string;
  adres: string;
  klasyfikacja: string | null;
  wartosc_netto: number | null;
  /** Indeks „przystanku" w kursie — WZ z tą samą kolejnoscia są na tym samym adresie */
  kolejnosc: number;
  /** Linia prosta oddział → adres (km, Haversine). Null gdy nie udało się zgeocodować. */
  km_prosta: number | null;
}

export interface RozliczeniePunkt {
  kolejnosc: number;
  adres: string;
  klasyfikacja: KlasyfikacjaKod;
  km_prosta: number;
  udzial_proc: number;      // np. 0.5086 (51%)
  km_punktu: number;        // udział × km_kolka
  koszt_punktu: number;     // wg taryfikatora
  /** Rozpis per WZ (gdy adres ma ich więcej) */
  wz: {
    id: string;
    numer_wz: string;
    wartosc_netto: number | null;
    udzial_wartosci: number; // 0..1, null-value WZ otrzymują równy udział
    koszt_wz: number;
  }[];
}

export interface RozliczenieKursu {
  km_kolka: number;
  suma_linii_prostych: number;
  koszt_calkowity: number;
  punkty: RozliczeniePunkt[];
  /** Ostrzeżenia dla UI (brak klasyfikacji, brak wartości, brak linii prostej itp.) */
  ostrzezenia: string[];
}

/**
 * Rozlicz jeden kurs (kółko) — zwraca podział kosztów per punkt i per WZ.
 *
 * @param kmKolka liczba km kółka (z OSRM lub drogomierza kierowcy)
 * @param wzList wszystkie WZ w kursie, pogrupowane niejawnie po `kolejnosc`
 */
export function rozliczKurs(kmKolka: number, wzList: WzDoRozliczenia[]): RozliczenieKursu {
  const ostrzezenia: string[] = [];

  // Grupuj WZ per punkt (kolejnosc = ten sam adres)
  const punktyMap = new Map<number, WzDoRozliczenia[]>();
  wzList.forEach(wz => {
    const g = punktyMap.get(wz.kolejnosc) || [];
    g.push(wz);
    punktyMap.set(wz.kolejnosc, g);
  });

  // Suma linii prostych — podstawa do procentów
  const punktyList = Array.from(punktyMap.entries())
    .map(([kolejnosc, wzy]) => {
      // Linia prosta per punkt — bierzemy pierwszą dostępną (powinny być te same na tym samym adresie)
      const kmProsta = wzy.find(w => w.km_prosta != null)?.km_prosta ?? null;
      return { kolejnosc, wzy, kmProsta };
    })
    .sort((a, b) => a.kolejnosc - b.kolejnosc);

  const sumaProstych = punktyList.reduce((sum, p) => sum + (p.kmProsta ?? 0), 0);

  if (sumaProstych === 0) {
    ostrzezenia.push('Brak linii prostych — nie można policzyć udziałów.');
    return { km_kolka: kmKolka, suma_linii_prostych: 0, koszt_calkowity: 0, punkty: [], ostrzezenia };
  }

  const punkty: RozliczeniePunkt[] = [];
  let kosztCalkowity = 0;

  for (const p of punktyList) {
    if (p.kmProsta == null) {
      ostrzezenia.push(`Punkt #${p.kolejnosc} (${p.wzy[0]?.odbiorca || '?'}): brak linii prostej — pominięty.`);
      continue;
    }

    // Klasyfikacja — założenie: wszystkie WZ na jednym adresie mają tę samą
    const klasyfikacjaRaw = p.wzy[0]?.klasyfikacja;
    if (!isKlasyfikacjaRozliczalna(klasyfikacjaRaw)) {
      ostrzezenia.push(`Punkt #${p.kolejnosc} (${p.wzy[0]?.odbiorca || '?'}): brak lub nieprawidłowa klasyfikacja (${klasyfikacjaRaw ?? 'null'}) — pominięty.`);
      continue;
    }
    const klasyfikacja = klasyfikacjaRaw as KlasyfikacjaKod;

    // Sprawdź spójność klasyfikacji w grupie
    const inneKlasyfikacje = p.wzy.filter(w => w.klasyfikacja !== klasyfikacja).map(w => w.klasyfikacja);
    if (inneKlasyfikacje.length > 0) {
      ostrzezenia.push(`Punkt #${p.kolejnosc}: mieszane klasyfikacje na jednym adresie (${[klasyfikacja, ...inneKlasyfikacje].join(', ')}) — używam ${klasyfikacja}.`);
    }

    const udzial = p.kmProsta / sumaProstych;
    const kmPunktu = udzial * kmKolka;
    const kosztPunktu = kosztKolka(kmPunktu, klasyfikacja);
    kosztCalkowity += kosztPunktu;

    // Rozdział per WZ — po wartości netto, fallback równy
    const wzzWartoscia = p.wzy.filter(w => w.wartosc_netto != null && w.wartosc_netto > 0);
    const sumaWartosci = wzzWartoscia.reduce((s, w) => s + (w.wartosc_netto || 0), 0);

    const wzRozpis = p.wzy.map(w => {
      let udzialW: number;
      if (sumaWartosci > 0 && w.wartosc_netto != null && w.wartosc_netto > 0) {
        udzialW = w.wartosc_netto / sumaWartosci;
      } else {
        udzialW = 1 / p.wzy.length; // równy podział gdy brak wartości
        if (sumaWartosci > 0 && (w.wartosc_netto == null || w.wartosc_netto <= 0)) {
          ostrzezenia.push(`WZ ${w.numer_wz}: brak wartości netto — dzielę koszt adresu równo.`);
        }
      }
      return {
        id: w.id,
        numer_wz: w.numer_wz,
        wartosc_netto: w.wartosc_netto,
        udzial_wartosci: udzialW,
        koszt_wz: Math.round(kosztPunktu * udzialW * 100) / 100,
      };
    });

    if (p.wzy.length > 1 && sumaWartosci === 0) {
      ostrzezenia.push(`Punkt #${p.kolejnosc}: brak wartości netto dla wszystkich WZ — podział równy.`);
    }

    punkty.push({
      kolejnosc: p.kolejnosc,
      adres: p.wzy[0]?.adres || '',
      klasyfikacja,
      km_prosta: p.kmProsta,
      udzial_proc: udzial,
      km_punktu: kmPunktu,
      koszt_punktu: kosztPunktu,
      wz: wzRozpis,
    });
  }

  return {
    km_kolka: kmKolka,
    suma_linii_prostych: sumaProstych,
    koszt_calkowity: Math.round(kosztCalkowity * 100) / 100,
    punkty,
    ostrzezenia,
  };
}
