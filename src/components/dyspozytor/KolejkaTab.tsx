import { useMemo } from 'react';
import {
  usePrzegladOddzialow,
  TYPY_KANONICZNE,
  TYP_BEZ_PREF,
  type TypKanoniczny,
  type PozycjaDto,
} from '@/hooks/usePrzegladOddzialow';
import { useFlotaOddzialu } from '@/hooks/useFlotaOddzialu';
import { useBlokady } from '@/hooks/useBlokady';
import { StatusBadge } from '@/components/shared/StatusBadge';

// Mapowanie typu systemowego (z flota) → kanonicznego (dla tła kolumny + sortowania)
const TYP_NORM_LOCAL: Record<string, TypKanoniczny> = {
  'Dostawczy 1,2t': 'Dostawczy 1,2t',
  'Winda 1,8t': 'Winda 1,8t',
  'Winda 6,3t': 'Winda 6,3t',
  'Winda MAX 15,8t': 'Winda MAX 15,8t',
  'HDS 8,9t': 'HDS 9,0t',
  'HDS 9,0t': 'HDS 9,0t',
  'HDS 9,1t': 'HDS 9,0t',
  'HDS 11,7t': 'HDS 12,0t',
  'HDS 12,0t': 'HDS 12,0t',
  'HDS 12T': 'HDS 12,0t',
};

const KOLUMNA_BG: Record<TypKanoniczny, string> = {
  'Dostawczy 1,2t':  'bg-slate-50 dark:bg-slate-900/30',
  'Winda 1,8t':      'bg-blue-50 dark:bg-blue-950/20',
  'Winda 6,3t':      'bg-blue-50 dark:bg-blue-950/20',
  'Winda MAX 15,8t': 'bg-blue-50 dark:bg-blue-950/20',
  'HDS 9,0t':        'bg-yellow-50 dark:bg-yellow-950/20',
  'HDS 12,0t':       'bg-yellow-50 dark:bg-yellow-950/20',
  [TYP_BEZ_PREF]:    'bg-muted/30',
};

// Kolejność typów dla sortowania kolumn
const TYP_KOLEJNOSC: Record<TypKanoniczny, number> = {
  'Dostawczy 1,2t': 1,
  'Winda 1,8t': 2,
  'Winda 6,3t': 3,
  'Winda MAX 15,8t': 4,
  'HDS 9,0t': 5,
  'HDS 12,0t': 6,
  [TYP_BEZ_PREF]: 7,
};

interface Props {
  oddzialId: number | null;
  oddzialNazwa?: string;
  dzien: string;
  dzienDo?: string;
}

interface AutoKolumna {
  id: string;
  nr_rej: string;          // raw nr_rej (bez sufiksu '(zew)')
  typ: string;             // raw typ systemowy (np. 'Winda 6,3t', 'HDS 11,7t')
  typ_kanoniczny: TypKanoniczny;
  jest_zewnetrzny: boolean;
}

export function KolejkaTab({ oddzialId, oddzialNazwa, dzien, dzienDo }: Props) {
  const { pozycje, loading: loadingZl } = usePrzegladOddzialow(dzien, dzienDo);
  const { flota, loading: loadingFlota } = useFlotaOddzialu(oddzialId);

  // businessDays dla useBlokady
  const businessDays = useMemo(() => {
    if (!dzien) return [] as string[];
    if (!dzienDo || dzienDo === dzien) return [dzien];
    const out: string[] = [];
    const start = new Date(dzien + 'T00:00:00');
    const end = new Date(dzienDo + 'T00:00:00');
    const cur = new Date(start);
    while (cur <= end) {
      out.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [dzien, dzienDo]);

  const { blokady } = useBlokady(oddzialId, businessDays);

  // Zlecenia dla wybranego oddziału
  const moje = useMemo(
    () => (oddzialNazwa ? pozycje.filter(p => p.oddzial_nazwa === oddzialNazwa) : []),
    [pozycje, oddzialNazwa]
  );

  // Lista dostępnych aut = flota - zablokowane na dzień referencyjny (dzien)
  // Każde auto = osobna kolumna
  const dostepneAuta = useMemo(() => {
    const list: AutoKolumna[] = [];
    for (const v of flota) {
      const kanon = TYP_NORM_LOCAL[v.typ];
      if (!kanon) continue;
      const typBlokady = v.jest_zewnetrzny ? 'zewnetrzny' : 'pojazd';
      const jestZablokowany = blokady.some(b => b.typ === typBlokady && b.zasob_id === v.id && b.dzien === dzien);
      if (jestZablokowany) continue;
      list.push({
        id: v.id,
        nr_rej: v.nr_rej_raw || v.nr_rej,
        typ: v.typ,
        typ_kanoniczny: kanon,
        jest_zewnetrzny: !!v.jest_zewnetrzny,
      });
    }
    // Sortuj: po typie kanonicznym (wg kolejności), potem wlasne przed zew, potem po nr_rej
    list.sort((a, b) => {
      const ta = TYP_KOLEJNOSC[a.typ_kanoniczny] ?? 99;
      const tb = TYP_KOLEJNOSC[b.typ_kanoniczny] ?? 99;
      if (ta !== tb) return ta - tb;
      if (a.jest_zewnetrzny !== b.jest_zewnetrzny) return a.jest_zewnetrzny ? 1 : -1;
      return a.nr_rej.localeCompare(b.nr_rej);
    });
    return list;
  }, [flota, blokady, dzien]);

  // Zlecenia W KURSIE — przypisz do aut po kurs_nr_rej
  // Zlecenia CZEKAJĄCE — idą do osobnej sekcji "Czekające"
  const zlecenia = useMemo(() => {
    const wKursach = new Map<string, PozycjaDto[]>(); // klucz: nr_rej auta
    const czekajace: PozycjaDto[] = [];
    for (const p of moje) {
      if (p.w_kursie && p.kurs_nr_rej) {
        const arr = wKursach.get(p.kurs_nr_rej) || [];
        arr.push(p);
        wKursach.set(p.kurs_nr_rej, arr);
      } else {
        czekajace.push(p);
      }
    }
    // Sortuj wewnątrz kolumn: po godzinie preferowanej
    wKursach.forEach((arr) => {
      arr.sort((a, b) => (a.preferowana_godzina || '99:99').localeCompare(b.preferowana_godzina || '99:99'));
    });
    // Czekające: po typie kanonicznym, potem godzinie
    czekajace.sort((a, b) => {
      const ta = TYP_KOLEJNOSC[a.typ_kanoniczny] ?? 99;
      const tb = TYP_KOLEJNOSC[b.typ_kanoniczny] ?? 99;
      if (ta !== tb) return ta - tb;
      return (a.preferowana_godzina || '99:99').localeCompare(b.preferowana_godzina || '99:99');
    });
    return { wKursach, czekajace };
  }, [moje]);

  // Zlecenia "osierocone" — w kursie ale kurs nie ma auta z tej floty (np. usunięte auto)
  // Pokazujemy je razem z czekającymi, żeby nie znikły z oczu
  const osierocone = useMemo(() => {
    const knownNrRej = new Set(dostepneAuta.map(a => a.nr_rej));
    const sieroty: PozycjaDto[] = [];
    zlecenia.wKursach.forEach((arr, nrRej) => {
      if (!knownNrRej.has(nrRej)) sieroty.push(...arr);
    });
    return sieroty;
  }, [zlecenia.wKursach, dostepneAuta]);

  const czekajaceICorowane = useMemo(
    () => [...zlecenia.czekajace, ...osierocone],
    [zlecenia.czekajace, osierocone]
  );

  if (!oddzialId) {
    return <p className="text-sm text-muted-foreground p-6">Wybierz oddział u góry.</p>;
  }

  if ((loadingZl || loadingFlota) && moje.length === 0 && flota.length === 0) {
    return <p className="text-sm text-muted-foreground p-6">Ładowanie podglądu…</p>;
  }

  const kolumnCount = dostepneAuta.length + (czekajaceICorowane.length > 0 ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        🔍 Podgląd zleceń dla wybranego oddziału i okresu. Tylko do odczytu. Każde dostępne auto to osobna kolumna. Auta zablokowane na wybrany dzień są ukryte.
      </div>

      {kolumnCount === 0 ? (
        <div className="border rounded-md p-6 text-center text-sm text-muted-foreground">
          Brak aut dostępnych i brak zleceń dla tego oddziału/okresu.
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${kolumnCount}, minmax(180px, 1fr))` }}
        >
          {/* Kolumna per auto */}
          {dostepneAuta.map(auto => {
            const bg = KOLUMNA_BG[auto.typ_kanoniczny] || 'bg-muted/30';
            const cards = zlecenia.wKursach.get(auto.nr_rej) || [];
            return (
              <div key={auto.id} className={`rounded-md border ${bg} p-2 flex flex-col min-h-[160px]`}>
                <div className="mb-2 pb-1.5 border-b border-border/50">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono font-bold text-xs truncate" title={auto.nr_rej}>
                      {auto.nr_rej}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {cards.length}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <span className="truncate" title={auto.typ}>{auto.typ}</span>
                    {auto.jest_zewnetrzny && (
                      <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-1 rounded text-[9px] shrink-0">
                        zew
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5 flex-1">
                  {cards.length === 0 && (
                    <div className="text-[10px] text-muted-foreground italic text-center py-6">
                      brak zleceń
                    </div>
                  )}
                  {cards.map(p => (
                    <ZlecenieCard key={p.zl_id} p={p} dzien={dzien} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Kolumna "Czekające" — na końcu */}
          {czekajaceICorowane.length > 0 && (
            <div className="rounded-md border bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900 p-2 flex flex-col min-h-[160px]">
              <div className="mb-2 pb-1.5 border-b border-border/50">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-xs">⏳ Czekające</span>
                  <span className="text-[10px] text-orange-600 dark:text-orange-400 tabular-nums font-semibold shrink-0">
                    {czekajaceICorowane.length}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  bez kursu
                </div>
              </div>
              <div className="space-y-1.5 flex-1">
                {czekajaceICorowane.map(p => (
                  <ZlecenieCard key={p.zl_id} p={p} dzien={dzien} pokazTyp />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ZlecenieCard({ p, dzien, pokazTyp }: { p: PozycjaDto; dzien: string; pokazTyp?: boolean }) {
  return (
    <div
      className={`rounded border text-[11px] p-1.5 ${p.w_kursie ? 'bg-background' : 'bg-background border-orange-200 dark:border-orange-900'}`}
    >
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="font-mono font-semibold truncate" title={p.zl_numer}>{p.zl_numer}</span>
        {p.preferowana_godzina && (
          <span className="text-[10px] font-semibold text-muted-foreground shrink-0">
            {p.preferowana_godzina}
          </span>
        )}
      </div>
      <div className="truncate font-medium" title={p.odbiorca || ''}>
        {p.odbiorca || '—'}
      </div>
      <div className="truncate text-[10px] text-muted-foreground" title={p.adres || ''}>
        {p.adres || '—'}
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px] gap-1">
        <span className="text-muted-foreground tabular-nums shrink-0">
          {Math.round(p.suma_kg)} kg{p.suma_palet > 0 ? ` · ${p.suma_palet} pal` : ''}
        </span>
        {p.w_kursie ? (
          <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
            {p.kurs_numer}
          </span>
        ) : (
          <StatusBadge status={p.status} />
        )}
      </div>
      {pokazTyp && !p.w_kursie && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          typ: {p.typ_raw || 'bez preferencji'}
        </div>
      )}
      {p.dzien !== dzien && (
        <div className="text-[9px] text-muted-foreground mt-0.5">
          {p.dzien}
        </div>
      )}
    </div>
  );
}
