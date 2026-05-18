import { supabase } from '@/integrations/supabase/client';
import type { Pozycja } from '@/components/shared/ModalImportWZ';
import { isPaletaJakoTowar, isPuchatyMaterial, isDlugiLuzny, wyliczPaletyFrakcjaPozycji, wyliczObjetoscPozycji, getMaxWymiarMm, M3_PER_PALETA } from './wzAutoFill';

/**
 * Lookup pozycji WZ w bazie katalog_towarow.
 *
 * Strategia (priorytet kluczy):
 *   1. kod (=kod_towaru z WZ) — najszybszy, PK w bazie
 *   2. kod_producenta — gdy kod Sewery nie matchuje
 *   3. ean (=kod_ean z WZ) — ostatni fallback
 *
 * Walidator m3 z bazy: ignorujemy m3_podejrzany=true (parser woli regex z opisu).
 */

export interface KatalogMatch {
  kod: string;
  m3_per_szt: number | null;
  m3_podejrzany: boolean;
  szt_na_palecie: number | null;
  m3_per_paleta: number | null;
  kg_per_szt: number | null;
  wymaga_hds: boolean;
  dzial: string | null;
}

/**
 * Wyciaga unikalne klucze z pozycji do query.
 * Filtruje puste/whitespace.
 */
function uniqKeys(pozycje: Pozycja[], field: keyof Pozycja): string[] {
  const set = new Set<string>();
  for (const p of pozycje) {
    const v = (p[field] as string | undefined)?.trim();
    if (v) set.add(v);
  }
  return [...set];
}

/**
 * Pobiera matching katalog dla wszystkich pozycji WZ w 1 query (lub max 3).
 * Zwraca Map: id_pozycji_w_WZ -> KatalogMatch (priorytet kod > kod_prod > ean).
 */
export async function wzbogacZKatalogu(
  pozycje: Pozycja[]
): Promise<Map<number, KatalogMatch>> {
  const result = new Map<number, KatalogMatch>();
  if (!pozycje || pozycje.length === 0) return result;

  const kody = uniqKeys(pozycje, 'kod_towaru');
  const kodyProd = uniqKeys(pozycje, 'kod_producenta');
  const eany = uniqKeys(pozycje, 'kod_ean');

  // Zbieramy wszystkie potencjalne matche w jednym query (OR po 3 kluczach).
  // Supabase obsluguje '.or(...)' ale skladnia trudna — robimy 3 osobne SELECTy
  // i mergeujemy w pamieci (latwiej + ten sam koszt sieciowy ~150-300ms total).
  const promises: Promise<any>[] = [];
  if (kody.length > 0) {
    promises.push(
      supabase
        .from('katalog_towarow' as any)
        .select('kod, kod_producenta, ean, m3_per_szt, m3_podejrzany, szt_na_palecie, m3_per_paleta, kg_per_szt, wymaga_hds, dzial')
        .in('kod', kody)
    );
  }
  if (kodyProd.length > 0) {
    promises.push(
      supabase
        .from('katalog_towarow' as any)
        .select('kod, kod_producenta, ean, m3_per_szt, m3_podejrzany, szt_na_palecie, m3_per_paleta, kg_per_szt, wymaga_hds, dzial')
        .in('kod_producenta', kodyProd)
    );
  }
  if (eany.length > 0) {
    promises.push(
      supabase
        .from('katalog_towarow' as any)
        .select('kod, kod_producenta, ean, m3_per_szt, m3_podejrzany, szt_na_palecie, m3_per_paleta, kg_per_szt, wymaga_hds, dzial')
        .in('ean', eany)
    );
  }

  if (promises.length === 0) return result;

  const responses = await Promise.all(promises);
  // Mergeuj wyniki do trzech map (po kazdym z 3 kluczy)
  const byKod = new Map<string, any>();
  const byKodProd = new Map<string, any>();
  const byEan = new Map<string, any>();

  responses.forEach((resp) => {
    if (resp.error || !resp.data) return;
    for (const row of resp.data as any[]) {
      if (row.kod) byKod.set(row.kod, row);
      if (row.kod_producenta) byKodProd.set(row.kod_producenta, row);
      if (row.ean) byEan.set(row.ean, row);
    }
  });

  // Per pozycja: priorytet kod > kod_prod > ean
  for (const p of pozycje) {
    const match =
      (p.kod_towaru?.trim() && byKod.get(p.kod_towaru.trim())) ||
      (p.kod_producenta?.trim() && byKodProd.get(p.kod_producenta.trim())) ||
      (p.kod_ean?.trim() && byEan.get(p.kod_ean.trim()));

    if (match) {
      result.set(p.lp, {
        kod: match.kod,
        m3_per_szt: match.m3_per_szt,
        m3_podejrzany: !!match.m3_podejrzany,
        szt_na_palecie: match.szt_na_palecie,
        m3_per_paleta: match.m3_per_paleta,
        kg_per_szt: match.kg_per_szt,
        wymaga_hds: !!match.wymaga_hds,
        dzial: match.dzial,
      });
    }
  }
  return result;
}

/**
 * Wyliczanie m3 i palet z bazy + pozycji WZ. Zwraca agregaty dla calej WZ.
 *
 * Priorytet wyliczenia per pozycja:
 *   1. m3_per_szt z bazy (jesli nie podejrzany) -> uzyj wprost: m3 = m3_per_szt * ilosc
 *   2. szt_na_palecie z bazy -> wylicz palety: ceil(ilosc / szt_na_palecie),
 *      m3 = palety * m3_per_paleta (domyslnie 1.1)
 *   3. Brak danych w bazie -> pomin (parser opisu zadziala fallback)
 *
 * Detekcja HDS: ≥1 pozycja z wymaga_hds=true w bazie.
 */
export interface KatalogAgregat {
  m3_total: number;
  palet_total: number;
  wymaga_hds: boolean;
  pozycji_z_baza: number;
  pozycji_bez_baza: number;
  dzialy_hds: string[]; // unikalna lista dzialow ktore wymagaja HDS (dla bannera)
  /** Suma palet producenta dla plyt gipsowych (gdy m.dzial zawiera GIPS).
   *  Liczone jako ceil(ilosc/perPaleta) BEZ × 2 dla dlugich palet — bo prog HDS
   *  oparty o ilosc fizycznych palet od producenta, nie miejsc na aucie.
   *  Decyzja 15.05.2026: HDS gdy palety_gips > 1 (czyli >=2 palety producenta). */
  palety_gips: number;
  /** Suma palet (miejsc na aucie) dla pozycji wymaga_hds=true NIE-gipsowych.
   *  Decyzja 15.05.2026: HDS gdy palety_inne_hds > 2. */
  palety_inne_hds: number;
}

export function agregujZKatalogu(
  pozycje: Pozycja[],
  matches: Map<number, KatalogMatch>
): KatalogAgregat {
  let m3Total = 0;
  let paletFrac = 0;
  let hdsCount = 0;
  let zBaza = 0;
  let bezBaza = 0;
  let paletyGips = 0;
  let paletyInneHds = 0;
  const dzialyHds = new Set<string>();

  for (const p of pozycje) {
    // Pomijaj palety jako towar (zwrotne) — nawet gdy są w katalog_towarow,
    // nie zajmują dodatkowego miejsca na aucie (są pod innym towarem z WZ).
    if (isPaletaJakoTowar(p)) {
      continue;
    }
    const paletyZOpisu = wyliczPaletyFrakcjaPozycji(p);
    const m3FromWym = wyliczObjetoscPozycji(p);
    const puchaty = isPuchatyMaterial(p);
    // Dlugi towar (wym>2000mm): plyty gipsowe 1200x2600, OSB 1250x2500. Leza plasko,
    // nie wystaja wysoko — m3 z wymiarow (a nie palety × 1,1) odzwierciedla realne miejsce.
    // Ponadto zajmuja 2 standardowe miejsca paletowe na aucie (nie miesci sie na euro 1200x800).
    // Rozszerzenie 18.05.2026: getMaxWymiarMm szuka tez w nazwie towaru (OSB "18mmx1250x2500").
    const maxWymiarMm = getMaxWymiarMm(p);
    const dlugiTowar = maxWymiarMm > 2000;

    const dlugiLuzny = isDlugiLuzny(p);

    const m = matches.get(p.lp);
    if (!m) {
      // Pozycja nie ma matchu w katalog_towarow — bierzemy palety/m3 z opisu (regex).
      // Bez tego pozycje od mniej popularnych producentow (np. WIENERBERGER bez Nr ewid.)
      // sa pomijane w sumie, mimo ze opis ma "paleta=Xszt" + "wym XxY".
      if (puchaty && m3FromWym && m3FromWym > 0) {
        // Puchaty: m3 fizyczne, 0 palet (lezy na innym towarze)
        m3Total += m3FromWym;
      } else if (dlugiLuzny && m3FromWym && m3FromWym > 0) {
        // Dlugi luzny (nadproza, belki >2000mm bez palety producenta): m3 fizyczne,
        // 0 palet (towar luzem/wiazkami na podlodze auta). Decyzja 18.05.2026.
        m3Total += m3FromWym;
      } else if (paletyZOpisu > 0) {
        paletFrac += paletyZOpisu;
        // Dlugi towar → m3 z wymiarow (plyty na plasko), inaczej palety × 1,1
        m3Total += (dlugiTowar && m3FromWym) ? m3FromWym : (m3FromWym ?? (paletyZOpisu * M3_PER_PALETA));
      } else if (m3FromWym && m3FromWym > 0) {
        m3Total += m3FromWym;
        paletFrac += m3FromWym / M3_PER_PALETA;
      }
      bezBaza++;
      continue;
    }
    zBaza++;

    if (m.wymaga_hds) {
      hdsCount++;
      if (m.dzial) dzialyHds.add(m.dzial);
      // Rozroznienie plyt gipsowych (GIPS w dziale) od pozostalych HDS-materialow.
      // Plyty gipsowe: liczymy palety PRODUCENTA (ceil bez × 2 dla dlugich), prog > 1.
      // Pozostale (cegly, bloczki, dachowki): liczymy palety MIEJSC na aucie, prog > 2.
      const isGips = m.dzial && /GIPS/i.test(m.dzial);
      const opisP = p.nazwa_dodatkowa || '';
      const pM = opisP.match(/(?:^|[\s(])(?:paleta|p)\s*=\s*(\d+)/i);
      if (isGips && pM) {
        const perPaleta = parseInt(pM[1], 10);
        if (perPaleta > 0) paletyGips += Math.ceil(p.ilosc / perPaleta);
      } else if (!isGips) {
        paletyInneHds += paletyZOpisu;
      }
    }

    // PUCHATY material (wełna, styropian) — m3 fizyczne, 0 palet
    if (puchaty) {
      if (m3FromWym && m3FromWym > 0) {
        m3Total += m3FromWym;
      } else if (m.m3_per_szt != null && !m.m3_podejrzany) {
        m3Total += m.m3_per_szt * p.ilosc;
      }
      continue;
    }

    // PRIORYTET PALET: opis pozycji "paleta=Xszt" / "p=Xopak" — info od producenta
    // jest najbardziej autorytatywne (rzeczywiste pakowanie, uwzglednia wage/limity).
    // Dlugie palety (wym>2000) leza plasko → m3 z wymiarow (nie palety × 1,1).
    // Reszta → palety × 1,1 (typowe upakowanie cegiel/bloczkow z powietrzem miedzy).
    if (paletyZOpisu > 0) {
      paletFrac += paletyZOpisu;
      if (dlugiTowar && m3FromWym && m3FromWym > 0) {
        m3Total += m3FromWym;
      } else {
        m3Total += paletyZOpisu * (m.m3_per_paleta ?? M3_PER_PALETA);
      }
      continue;
    }

    // Priorytet 1: m3 per szt (jesli nie podejrzany)
    if (m.m3_per_szt != null && !m.m3_podejrzany) {
      const m3Pozycji = m.m3_per_szt * p.ilosc;
      m3Total += m3Pozycji;
      // Frakcja palety: m3_pozycji / m3_per_paleta (domyslnie 1.1).
      // Dlugi towar (>2000mm) — ceil palet producenta × 2 (jak plyty gipsowe/OSB:
      // paleta nie miesci sie na euro 1200x800, zajmuje 2 miejsca na podlodze auta).
      // Decyzja 18.05.2026 (OSB-3 1250x2500 — 17 szt = 1 paleta producenta = 2 miejsca).
      const fracPalety = m3Pozycji / (m.m3_per_paleta ?? 1.1);
      paletFrac += dlugiTowar ? Math.max(1, Math.ceil(fracPalety)) * 2 : fracPalety;
      continue;
    }

    // Priorytet 2: szt_na_palecie z bazy
    if (m.szt_na_palecie != null && m.szt_na_palecie > 0) {
      const frac = p.ilosc / m.szt_na_palecie;
      m3Total += frac * (m.m3_per_paleta ?? 1.1);
      // Dlugi towar — ceil × 2 (jak Priorytet 1).
      paletFrac += dlugiTowar ? Math.max(1, Math.ceil(frac)) * 2 : frac;
    }
    // jezeli oba puste, pozycja nie wnosi do m3/palet — fallback do regex z opisu
    // bedzie w wyliczObjetoscZPozycji() obok agregatu z bazy.
  }

  // Ceil palet z progiem 0.2 (spojne z wzAutoFill.klasyfikujLadunek)
  const fullPalet = Math.floor(paletFrac);
  const remainder = paletFrac - fullPalet;
  const palet = paletFrac === 0 ? 0 : Math.max(1, fullPalet + (remainder > 0.2 ? 1 : 0));

  return {
    m3_total: Math.round(m3Total * 100) / 100,
    palet_total: palet,
    wymaga_hds: hdsCount > 0,
    pozycji_z_baza: zBaza,
    pozycji_bez_baza: bezBaza,
    dzialy_hds: [...dzialyHds],
    palety_gips: paletyGips,
    palety_inne_hds: Math.ceil(paletyInneHds * 10) / 10,
  };
}
