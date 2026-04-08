import { useMemo, useState } from 'react';
import { computeSuggestions, computeTypeSummary, type RouteSuggestion } from '@/lib/suggestRoutes';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Order {
  id: string;
  numer: string;
  typ_pojazdu: string | null;
  suma_kg: number;
  suma_m3: number;
  suma_palet: number;
  adres: string | null;
  lat: number | null;
  lng: number | null;
  dystans_km: number | null;
}

interface FlotaItem {
  id: string;
  nr_rej: string;
  typ: string;
  ladownosc_kg: number;
}

const STYLES: Record<RouteSuggestion['type'], { bg: string; border: string; icon: string }> = {
  overweight: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
    icon: '⚠️',
  },
  merge: {
    bg: 'bg-green-50 dark:bg-green-950/30',
    border: 'border-green-200 dark:border-green-800',
    icon: '🔗',
  },
  no_type: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    border: 'border-yellow-200 dark:border-yellow-800',
    icon: '💡',
  },
};

// Utwórz kurs z podanych zleceń
async function createKurs(
  oddzialId: number, dzien: string, zlecenieIds: string[], flotaId?: string | null
) {
  const { data: kurs, error: err1 } = await supabase
    .from('kursy')
    .insert({ oddzial_id: oddzialId, dzien, flota_id: flotaId || null, status: 'zaplanowany' })
    .select('id, numer')
    .single();
  if (err1 || !kurs) throw new Error(err1?.message || 'Blad tworzenia kursu');

  const przystanki = zlecenieIds.map((zId, i) => ({
    kurs_id: kurs.id, zlecenie_id: zId, kolejnosc: i + 1, status: 'oczekuje',
  }));
  const { error: err2 } = await supabase.from('kurs_przystanki').insert(przystanki);
  if (err2) throw new Error(err2.message);

  await supabase.from('zlecenia').update({ status: 'potwierdzona', kurs_id: kurs.id } as any).in('id', zlecenieIds);
  return kurs;
}

interface Props {
  orders: Order[];
  availableTypes?: string[];
  flota?: FlotaItem[];
  oddzialId: number;
  dzien: string;
  oddzialCoords?: { lat: number; lng: number } | null;
  onRefresh: () => void;
}

export function SuggestionPanel({ orders, availableTypes, flota, oddzialId, dzien, oddzialCoords, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const suggestions = useMemo(
    () => computeSuggestions(orders, availableTypes),
    [orders, availableTypes]
  );

  const typeSummary = useMemo(
    () => computeTypeSummary(orders, oddzialCoords?.lat, oddzialCoords?.lng),
    [orders, oddzialCoords?.lat, oddzialCoords?.lng]
  );

  if (suggestions.length === 0 && typeSummary.length === 0) return null;

  const warnings = suggestions.filter(s => s.type === 'overweight').length;

  // Znajdź pojazd danego typu z floty
  const findFlotaByType = (typ: string): FlotaItem | null => {
    if (!flota) return null;
    return flota.find(f => f.typ === typ) || null;
  };

  // Akceptuj sugestię merge — utwórz kurs
  const handleAcceptMerge = async (s: RouteSuggestion) => {
    const key = 'merge-' + s.orderIds.join(',');
    setBusy(key);
    try {
      // Znajdź typ z zamówień (pierwszy z typem)
      const typedOrder = orders.find(o => s.orderIds.includes(o.id) && o.typ_pojazdu);
      const typ = typedOrder?.typ_pojazdu || null;
      const vehicle = typ ? findFlotaByType(typ) : null;

      const kurs = await createKurs(oddzialId, dzien, s.orderIds, vehicle?.id);
      toast.success('Kurs ' + (kurs.numer || '') + ' utworzony (' + s.orderIds.length + ' zl.)');
      onRefresh();
    } catch (e: any) {
      toast.error('Blad: ' + e.message);
    }
    setBusy(null);
  };

  // Akceptuj sugestię no_type — przypisz typ
  const handleAcceptType = async (s: RouteSuggestion) => {
    const key = 'type-' + s.orderIds[0];
    setBusy(key);
    try {
      // Wyciągnij sugerowany typ z message
      const match = s.message.match(/sugerowany (.+?) \(/);
      const typ = match ? match[1] : null;
      if (typ) {
        await supabase.from('zlecenia').update({ typ_pojazdu: typ } as any).in('id', s.orderIds);
        toast.success('Typ ' + typ + ' przypisany do ' + s.orderNumbers.join(', '));
        onRefresh();
      }
    } catch (e: any) {
      toast.error('Blad: ' + e.message);
    }
    setBusy(null);
  };

  // Utwórz kursy wg zaplanowanych tras (z kierunkami)
  const handleCreateKursyFromRoutes = async (ts: import('@/lib/suggestRoutes').TypeSummary) => {
    const key = 'kursy-' + ts.typ;
    setBusy(key);
    try {
      const vehicle = findFlotaByType(ts.typ);
      let created = 0;
      for (const route of ts.routes) {
        await createKurs(oddzialId, dzien, route.orderIds, vehicle?.id);
        created++;
      }
      toast.success(created + ' ' + (created === 1 ? 'kurs' : 'kursy') + ' ' + ts.label + ' utworzone');
      onRefresh();
    } catch (e: any) {
      toast.error('Blad: ' + e.message);
    }
    setBusy(null);
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="font-semibold text-sm">
          Podpowiedzi ({suggestions.length})
        </span>
        {warnings > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
            {warnings} ostrz.
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {collapsed ? '▶' : '▼'}
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Podsumowanie per typ pojazdu */}
          {typeSummary.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Zlecenia per typ pojazdu:</p>
              {typeSummary.map(ts => {
                const busyKey = 'kursy-' + ts.typ;
                const SECTOR_ARROWS: Record<string, string> = {
                  N: '↑', NE: '↗', E: '→', SE: '↘', S: '↓', SW: '↙', W: '←', NW: '↖', '?': '?'
                };
                return (
                  <div key={ts.typ} className="space-y-1">
                    <div
                      className={'rounded-md border px-3 py-2 text-sm flex items-center gap-3 flex-wrap '
                        + (ts.typ === '_brak'
                          ? 'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700'
                          : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700')}
                    >
                      <span className="font-semibold min-w-[120px]">
                        {ts.typ === '_brak' ? '❓' : '🚛'} {ts.label}
                      </span>
                      <span className="text-muted-foreground">{ts.count} zl.</span>
                      <span>{Math.round(ts.totalKg).toLocaleString('pl-PL')} kg</span>
                      {ts.totalM3 > 0 && <span>{Math.round(ts.totalM3 * 10) / 10} m3</span>}
                      {ts.totalPal > 0 && <span>{ts.totalPal} pal</span>}
                      {ts.totalKm > 0 && <span className="text-muted-foreground">~{Math.round(ts.totalKm)} km</span>}
                      {ts.capacity && (
                        <span className={'font-medium '
                          + (ts.minKursy > 1 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400')}>
                          {ts.minKursy} {ts.minKursy === 1 ? 'kurs' : ts.minKursy < 5 ? 'kursy' : 'kursow'}
                        </span>
                      )}
                      {ts.typ !== '_brak' && ts.routes.length > 0 && (
                        <button
                          type="button"
                          disabled={busy === busyKey}
                          onClick={() => handleCreateKursyFromRoutes(ts)}
                          className="ml-auto px-2 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                          {busy === busyKey ? 'Tworzenie...' : 'Utwórz ' + ts.routes.length + ' ' + (ts.routes.length === 1 ? 'kurs' : 'kursy')}
                        </button>
                      )}
                    </div>
                    {/* Rozpisanie tras per kurs */}
                    {ts.routes.length > 1 && ts.routes.map((r, ri) => (
                      <div key={ri} className="ml-6 rounded border border-dashed px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {SECTOR_ARROWS[r.sector] || ''} Kurs {ri + 1}:
                        </span>
                        <span>{r.orderNumbers.join(' + ')}</span>
                        <span>{Math.round(r.totalKg).toLocaleString('pl-PL')} kg</span>
                        {r.totalM3 > 0 && <span>{Math.round(r.totalM3 * 10) / 10} m3</span>}
                        {r.totalKm > 0 && <span>~{Math.round(r.totalKm)} km</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Podpowiedzi szczegółowe */}
          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              {suggestions.map((s, i) => {
                const style = STYLES[s.type];
                const mergeKey = 'merge-' + s.orderIds.join(',');
                const typeKey = 'type-' + s.orderIds[0];
                return (
                  <div
                    key={i}
                    className={'rounded-md border px-3 py-2 text-sm flex items-center gap-2 ' + style.bg + ' ' + style.border}
                  >
                    <span className="flex-1">{style.icon} {s.message}</span>
                    {s.type === 'merge' && (
                      <button
                        type="button"
                        disabled={busy === mergeKey}
                        onClick={() => handleAcceptMerge(s)}
                        className="shrink-0 px-2 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {busy === mergeKey ? '...' : 'Polacz w kurs'}
                      </button>
                    )}
                    {s.type === 'no_type' && (
                      <button
                        type="button"
                        disabled={busy === typeKey}
                        onClick={() => handleAcceptType(s)}
                        className="shrink-0 px-2 py-1 rounded text-xs font-medium bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50"
                      >
                        {busy === typeKey ? '...' : 'Przypisz typ'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
