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

// Mapowanie typu systemowego (z flota) → kanonicznego (używanego jako klucz kolumny).
// Takie samo jak w usePrzegladOddzialow (duplikat świadomy — unikamy circular import).
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

const KOLUMNY_META: Record<TypKanoniczny, { label: string; bg: string }> = {
  'Dostawczy 1,2t':  { label: 'Dostawczy 1,2t',  bg: 'bg-slate-50 dark:bg-slate-900/30' },
  'Winda 1,8t':      { label: 'Winda 1,8t',      bg: 'bg-blue-50 dark:bg-blue-950/20' },
  'Winda 6,3t':      { label: 'Winda 6,3t',      bg: 'bg-blue-50 dark:bg-blue-950/20' },
  'Winda MAX 15,8t': { label: 'Winda MAX 15,8t', bg: 'bg-blue-50 dark:bg-blue-950/20' },
  'HDS 9,0t':        { label: 'HDS 9,0t',        bg: 'bg-yellow-50 dark:bg-yellow-950/20' },
  'HDS 12,0t':       { label: 'HDS 12,0t',       bg: 'bg-yellow-50 dark:bg-yellow-950/20' },
  [TYP_BEZ_PREF]:    { label: 'Bez preferencji', bg: 'bg-muted/30' },
};

const KOLUMNY_KOLEJNOSC: TypKanoniczny[] = [
  'Dostawczy 1,2t',
  'Winda 1,8t',
  'Winda 6,3t',
  'Winda MAX 15,8t',
  'HDS 9,0t',
  'HDS 12,0t',
  TYP_BEZ_PREF,
];

interface Props {
  oddzialId: number | null;
  oddzialNazwa?: string;
  dzien: string;
  dzienDo?: string;
}

interface FlotaTypInfo {
  total: number;       // wszystkie auta tego typu na oddziale (wlasna + zew)
  totalWlasna: number;
  totalZew: number;
  zablokowane: number; // zablokowane na wybrany dzień (ref day)
  dostepne: number;
}

export function KolejkaTab({ oddzialId, oddzialNazwa, dzien, dzienDo }: Props) {
  const { pozycje, loading: loadingZl } = usePrzegladOddzialow(dzien, dzienDo);
  const { flota, loading: loadingFlota } = useFlotaOddzialu(oddzialId);

  // businessDays dla useBlokady — używamy zakresu
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

  // Info o flocie per typ kanoniczny — podstawa do pokazywania kolumn
  // Referencyjny dzień dla blokad = dzien (pierwszy dzień zakresu)
  const flotaPerTyp = useMemo(() => {
    const m = new Map<TypKanoniczny, FlotaTypInfo>();
    for (const v of flota) {
      const kanon = TYP_NORM_LOCAL[v.typ];
      if (!kanon) continue; // pomiń nieznane typy
      const prev = m.get(kanon) || { total: 0, totalWlasna: 0, totalZew: 0, zablokowane: 0, dostepne: 0 };
      prev.total += 1;
      if (v.jest_zewnetrzny) prev.totalZew += 1; else prev.totalWlasna += 1;
      // Blokada dla tego pojazdu na referencyjny dzień
      const typBlokady = v.jest_zewnetrzny ? 'zewnetrzny' : 'pojazd';
      const jestZablokowany = blokady.some(b => b.typ === typBlokady && b.zasob_id === v.id && b.dzien === dzien);
      if (jestZablokowany) prev.zablokowane += 1;
      prev.dostepne = prev.total - prev.zablokowane;
      m.set(kanon, prev);
    }
    return m;
  }, [flota, blokady, dzien]);

  // Które kolumny pokazać: te które oddział ma w flocie, + bez_preferencji jeśli są takie zlecenia,
  // + wszelkie typy dla których są zlecenia (nawet jeśli flota ich nie ma — "osierocone")
  const widoczneKolumny = useMemo(() => {
    const set = new Set<TypKanoniczny>();
    // Typy z floty
    flotaPerTyp.forEach((_, k) => set.add(k));
    // Typy ze zleceń (jeśli są zlecenia z takim typem, pokaż kolumnę — nawet bez floty)
    moje.forEach(p => set.add(p.typ_kanoniczny));
    return KOLUMNY_KOLEJNOSC.filter(k => set.has(k));
  }, [flotaPerTyp, moje]);

  // Zlecenia per typ (posortowane po godzinie)
  const perTyp = useMemo(() => {
    const m = new Map<TypKanoniczny, PozycjaDto[]>();
    for (const k of widoczneKolumny) m.set(k, []);
    for (const p of moje) {
      const arr = m.get(p.typ_kanoniczny);
      if (arr) arr.push(p);
    }
    m.forEach((arr) => {
      arr.sort((a, b) => {
        const ga = a.preferowana_godzina || '99:99';
        const gb = b.preferowana_godzina || '99:99';
        return ga.localeCompare(gb);
      });
    });
    return m;
  }, [moje, widoczneKolumny]);

  if (!oddzialId) {
    return <p className="text-sm text-muted-foreground p-6">Wybierz oddział u góry.</p>;
  }

  if ((loadingZl || loadingFlota) && moje.length === 0 && flota.length === 0) {
    return <p className="text-sm text-muted-foreground p-6">Ładowanie kolejki…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        📅 Podgląd zleceń dla wybranego oddziału i okresu. Tylko do odczytu. Kolumny pokazują typy pojazdów dostępne w tym oddziale (własne + zewnętrzne).
      </div>

      {widoczneKolumny.length === 0 ? (
        <div className="border rounded-md p-6 text-center text-sm text-muted-foreground">
          Ten oddział nie ma floty w systemie ani zleceń na ten okres.
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(widoczneKolumny.length, 7)}, minmax(0, 1fr))` }}
        >
          {widoczneKolumny.map(kod => {
            const meta = KOLUMNY_META[kod];
            const info = flotaPerTyp.get(kod);
            const cards = perTyp.get(kod) || [];
            const wKursach = cards.filter(c => c.w_kursie).length;
            const czekajace = cards.filter(c => !c.w_kursie).length;
            return (
              <div key={kod} className={`rounded-md border ${meta.bg} p-2 flex flex-col min-h-[140px]`}>
                <div className="mb-2 pb-1.5 border-b border-border/50">
                  <div className="flex items-center justify-between gap-1">
                    <div className="font-semibold text-xs truncate" title={meta.label}>{meta.label}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      <span className="font-semibold">{wKursach}</span>
                      <span className="mx-0.5">/</span>
                      <span className={czekajace > 0 ? 'font-semibold text-orange-600 dark:text-orange-400' : ''}>
                        {czekajace}
                      </span>
                    </div>
                  </div>
                  {info ? (
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                      <span className="tabular-nums">
                        🚛 {info.dostepne}/{info.total} aut
                      </span>
                      {info.zablokowane > 0 && (
                        <span className="text-red-600 dark:text-red-400" title={`${info.zablokowane} auto zablokowane na ${dzien}`}>
                          · 🚫 {info.zablokowane} zablok.
                        </span>
                      )}
                      {info.totalZew > 0 && (
                        <span className="text-muted-foreground/70">
                          · zew: {info.totalZew}
                        </span>
                      )}
                    </div>
                  ) : kod !== TYP_BEZ_PREF && cards.length > 0 ? (
                    <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">
                      ⚠️ brak auta w flocie
                    </div>
                  ) : null}
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
      )}
    </div>
  );
}
