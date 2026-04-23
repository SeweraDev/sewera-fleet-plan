import { useMemo } from 'react';
import {
  usePrzegladOddzialow,
  TYPY_KANONICZNE,
  TYP_BEZ_PREF,
  type TypKanoniczny,
  type PozycjaDto,
} from '@/hooks/usePrzegladOddzialow';
import { StatusBadge } from '@/components/shared/StatusBadge';

const KOLUMNY: Array<{ kod: TypKanoniczny; label: string; bg: string }> = [
  { kod: 'Dostawczy 1,2t',  label: 'Dostawczy 1,2t',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
  { kod: 'Winda 1,8t',      label: 'Winda 1,8t',      bg: 'bg-blue-50 dark:bg-blue-950/20' },
  { kod: 'Winda 6,3t',      label: 'Winda 6,3t',      bg: 'bg-blue-50 dark:bg-blue-950/20' },
  { kod: 'Winda MAX 15,8t', label: 'Winda MAX 15,8t', bg: 'bg-blue-50 dark:bg-blue-950/20' },
  { kod: 'HDS 9,0t',        label: 'HDS 9,0t',        bg: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { kod: 'HDS 12,0t',       label: 'HDS 12,0t',       bg: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { kod: TYP_BEZ_PREF,      label: 'Bez preferencji', bg: 'bg-muted/30' },
];

interface Props {
  oddzialId: number | null;
  oddzialNazwa?: string;
  dzien: string;
  dzienDo?: string;
}

export function KolejkaTab({ oddzialId, oddzialNazwa, dzien, dzienDo }: Props) {
  const { pozycje, loading } = usePrzegladOddzialow(dzien, dzienDo);

  // Filtruj pozycje do wybranego oddziału (po nazwie — pozycje niosą oddzial_nazwa,
  // a Dashboard przekazuje nazwę oddziału w propsie).
  const moje = useMemo(
    () => (oddzialNazwa ? pozycje.filter(p => p.oddzial_nazwa === oddzialNazwa) : []),
    [pozycje, oddzialNazwa]
  );

  // Agregacja per typ
  const perTyp = useMemo(() => {
    const m = new Map<TypKanoniczny, PozycjaDto[]>();
    for (const k of KOLUMNY) m.set(k.kod, []);
    for (const p of moje) {
      const arr = m.get(p.typ_kanoniczny);
      if (arr) arr.push(p);
    }
    // Sortuj: preferowana_godzina asc (bez godziny na końcu)
    m.forEach((arr) => {
      arr.sort((a, b) => {
        const ga = a.preferowana_godzina || '99:99';
        const gb = b.preferowana_godzina || '99:99';
        return ga.localeCompare(gb);
      });
    });
    return m;
  }, [moje]);

  if (loading && pozycje.length === 0) {
    return <p className="text-sm text-muted-foreground p-6">Ładowanie kolejki…</p>;
  }

  if (!oddzialId) {
    return <p className="text-sm text-muted-foreground p-6">Wybierz oddział u góry.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        📅 Podgląd zleceń dla wybranego oddziału i okresu. Widok tylko do odczytu — pozwala sprawdzić, co jest już zaplanowane na dany dzień.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {KOLUMNY.map(kol => {
          const cards = perTyp.get(kol.kod) || [];
          const wKursach = cards.filter(c => c.w_kursie).length;
          const czekajace = cards.filter(c => !c.w_kursie).length;
          return (
            <div key={kol.kod} className={`rounded-md border ${kol.bg} p-2 flex flex-col min-h-[120px]`}>
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border/50">
                <div className="font-semibold text-xs">{kol.label}</div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  <span className="font-semibold">{wKursach}</span>
                  <span className="mx-0.5">/</span>
                  <span className={czekajace > 0 ? 'font-semibold text-orange-600 dark:text-orange-400' : ''}>
                    {czekajace}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 flex-1">
                {cards.length === 0 && (
                  <div className="text-[10px] text-muted-foreground italic text-center py-6">
                    brak zleceń
                  </div>
                )}
                {cards.map(p => (
                  <div
                    key={p.zl_id}
                    className={`rounded border text-[11px] p-1.5 ${p.w_kursie ? 'bg-background' : 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900'}`}
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
                    <div className="flex items-center justify-between mt-1 text-[10px]">
                      <span className="text-muted-foreground tabular-nums">
                        {Math.round(p.suma_kg)} kg{p.suma_palet > 0 ? ` · ${p.suma_palet} pal` : ''}
                      </span>
                      {p.w_kursie ? (
                        <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          🚛 {p.kurs_numer}
                        </span>
                      ) : (
                        <StatusBadge status={p.status} />
                      )}
                    </div>
                    {p.dzien !== dzien && (
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        {p.dzien}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
