import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/shared/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  usePrzegladOddzialow,
  TYPY_KANONICZNE,
  TYP_BEZ_PREF,
  type PozycjaDto,
  type TypKanoniczny,
} from '@/hooks/usePrzegladOddzialow';
import { ODDZIAL_COORDS, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';

const ODDZIAL_COLORS: Record<string, string> = {
  KAT: '#dc2626', R: '#7c3aed', SOS: '#1e40af', GL: '#059669',
  DG: '#ea580c', TG: '#0891b2', CH: '#be185d', OS: '#ca8a04',
};

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

const KOLUMNY: Array<{ kod: TypKanoniczny; label: string }> = [
  { kod: 'Dostawczy 1,2t',   label: 'Dost. 1,2t' },
  { kod: 'Winda 1,8t',       label: 'W. 1,8t' },
  { kod: 'Winda 6,3t',       label: 'W. 6,3t' },
  { kod: 'Winda MAX 15,8t',  label: 'W. MAX' },
  { kod: 'HDS 9,0t',         label: 'HDS 9,0t' },
  { kod: 'HDS 12,0t',        label: 'HDS 12,0t' },
  { kod: TYP_BEZ_PREF,       label: 'bez pref.' },
];

export default function PrzegladOddzialow() {
  const today = new Date().toISOString().split('T')[0];
  const [dzien, setDzien] = useState(today);
  const [tydzien, setTydzien] = useState(false);

  const dzienDo = tydzien ? addDays(dzien, 6) : dzien;
  const { pozycje, loading } = usePrzegladOddzialow(dzien, dzienDo);

  // Aktywne oddziały (tylko te, które pojawiły się w danych)
  const oddzialyAktywne = useMemo(() => {
    const map = new Map<string, string>(); // kod → nazwa
    pozycje.forEach(p => {
      if (p.oddzial_kod && !map.has(p.oddzial_kod)) map.set(p.oddzial_kod, p.oddzial_nazwa);
    });
    // Posortuj wg stałej kolejności kodów z ODDZIAL_COLORS
    const order = Object.keys(ODDZIAL_COLORS);
    return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [pozycje]);

  // Agregacja: [kod oddziału][typ] = { wKursach, czekajace }
  const agregacja = useMemo(() => {
    const m = new Map<string, Map<TypKanoniczny, { wKursach: number; czekajace: number }>>();
    pozycje.forEach(p => {
      if (!p.oddzial_kod) return;
      if (!m.has(p.oddzial_kod)) m.set(p.oddzial_kod, new Map());
      const oddzMap = m.get(p.oddzial_kod)!;
      const prev = oddzMap.get(p.typ_kanoniczny) || { wKursach: 0, czekajace: 0 };
      if (p.w_kursie) prev.wKursach += 1; else prev.czekajace += 1;
      oddzMap.set(p.typ_kanoniczny, prev);
    });
    return m;
  }, [pozycje]);

  // Drawer state
  const [drawer, setDrawer] = useState<{ kod: string; nazwa: string; typ: TypKanoniczny } | null>(null);
  const drawerPozycje = useMemo(() => {
    if (!drawer) return [];
    return pozycje
      .filter(p => p.oddzial_kod === drawer.kod && p.typ_kanoniczny === drawer.typ)
      .sort((a, b) => {
        // Czekające na górze, potem w kursie; w grupach po preferowana_godzina
        if (a.w_kursie !== b.w_kursie) return a.w_kursie ? 1 : -1;
        return (a.preferowana_godzina || '').localeCompare(b.preferowana_godzina || '');
      });
  }, [drawer, pozycje]);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold">📊 Podgląd oddziałów</h1>
          <Link to="/mapa" className="text-sm text-muted-foreground hover:underline">
            → Mapa dostaw
          </Link>
        </div>

        {/* Kontrolki daty + zakresu */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setDzien(addDays(dzien, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={dzien}
            onChange={e => setDzien(e.target.value)}
            className="h-9 w-auto"
          />
          <Button variant="outline" size="sm" onClick={() => setDzien(addDays(dzien, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant={tydzien ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTydzien(!tydzien)}
          >
            📅 {tydzien ? 'Tydzień' : 'Dzień'}
          </Button>
          <span className="text-xs text-muted-foreground ml-2">
            {tydzien ? `${formatDate(dzien)} – ${formatDate(dzienDo)}` : formatDate(dzien)}
          </span>
          {loading && <span className="text-xs text-muted-foreground ml-2">Ładowanie…</span>}
        </div>

        <div className="text-xs text-muted-foreground">
          Komórka: <strong>X / Y</strong> — <strong>X</strong> = zlecenia w kursach · <strong>Y</strong> = czekające (bez kursu). Klik w komórkę pokaże listę zleceń.
        </div>

        {/* Tabela krzyżowa */}
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2 sticky left-0 bg-muted z-10 min-w-[140px]">Oddział</th>
                {KOLUMNY.map(k => (
                  <th key={k.kod} className="text-center p-2 min-w-[80px] font-medium">{k.label}</th>
                ))}
                <th className="text-center p-2 bg-muted/70 font-semibold">Suma</th>
              </tr>
            </thead>
            <tbody>
              {oddzialyAktywne.length === 0 && !loading && (
                <tr>
                  <td colSpan={KOLUMNY.length + 2} className="text-center text-muted-foreground p-6 text-sm">
                    Brak zleceń dla {tydzien ? 'tego tygodnia' : 'tego dnia'}.
                  </td>
                </tr>
              )}
              {oddzialyAktywne.map(([kod, nazwa]) => {
                const oddzMap = agregacja.get(kod);
                const color = ODDZIAL_COLORS[kod] || '#6b7280';
                let sumWKursach = 0;
                let sumCzekajace = 0;
                return (
                  <tr key={kod} className="border-t hover:bg-muted/20">
                    <td className="p-2 sticky left-0 bg-background z-10 font-medium">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                          style={{ background: color }}
                        >
                          {kod}
                        </span>
                        <span>{nazwa}</span>
                      </div>
                    </td>
                    {KOLUMNY.map(kol => {
                      const val = oddzMap?.get(kol.kod);
                      const w = val?.wKursach || 0;
                      const c = val?.czekajace || 0;
                      sumWKursach += w;
                      sumCzekajace += c;
                      const empty = w === 0 && c === 0;
                      return (
                        <td
                          key={kol.kod}
                          className={`text-center p-2 tabular-nums ${empty ? 'text-muted-foreground/40' : 'cursor-pointer hover:bg-primary/10'}`}
                          onClick={empty ? undefined : () => setDrawer({ kod, nazwa, typ: kol.kod })}
                        >
                          {empty ? '—' : (
                            <span>
                              <span className="font-semibold">{w}</span>
                              <span className="text-muted-foreground mx-0.5">/</span>
                              <span className={c > 0 ? 'font-semibold text-orange-600 dark:text-orange-400' : ''}>{c}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center p-2 tabular-nums bg-muted/30 font-bold">
                      {sumWKursach} / {sumCzekajace}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer — lista zleceń dla klikniętej komórki */}
      <Sheet open={!!drawer} onOpenChange={(open) => { if (!open) setDrawer(null); }}>
        <SheetContent className="w-[100vw] sm:max-w-xl overflow-y-auto">
          {drawer && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base flex items-center gap-2">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ background: ODDZIAL_COLORS[drawer.kod] || '#6b7280' }}
                  >
                    {drawer.kod}
                  </span>
                  {drawer.nazwa} · {KOLUMNY.find(k => k.kod === drawer.typ)?.label || drawer.typ}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-2">
                {drawerPozycje.length === 0 && (
                  <p className="text-sm text-muted-foreground">Brak zleceń.</p>
                )}
                {drawerPozycje.map(p => (
                  <div
                    key={p.zl_id}
                    className={`border rounded-md p-3 text-xs ${p.w_kursie ? 'bg-muted/40' : 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800'}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-semibold">{p.zl_numer}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.w_kursie
                        ? <>🚛 Kurs {p.kurs_numer} · {p.kurs_nr_rej} · {p.typ_raw}</>
                        : <>⏳ Czeka · preferowany: {p.typ_raw || 'bez preferencji'}</>
                      }
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      <div><strong>{p.odbiorca || '—'}</strong></div>
                      <div className="text-muted-foreground">{p.adres || '—'}</div>
                      <div className="text-muted-foreground">
                        {Math.round(p.suma_kg)} kg
                        {p.suma_palet > 0 && ` · ${p.suma_palet} pal`}
                        {p.preferowana_godzina && ` · ${p.preferowana_godzina}`}
                        {p.dzien !== dzien && ` · ${formatDate(p.dzien)}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
