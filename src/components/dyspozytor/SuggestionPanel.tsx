import { useMemo, useState } from 'react';
import { computeSuggestions, computeTypeSummary, type RouteSuggestion } from '@/lib/suggestRoutes';

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

interface Props {
  orders: Order[];
  availableTypes?: string[];
}

export function SuggestionPanel({ orders, availableTypes }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const suggestions = useMemo(
    () => computeSuggestions(orders, availableTypes),
    [orders, availableTypes]
  );

  const typeSummary = useMemo(
    () => computeTypeSummary(orders),
    [orders]
  );

  if (suggestions.length === 0 && typeSummary.length === 0) return null;

  const warnings = suggestions.filter(s => s.type === 'overweight').length;

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
              {typeSummary.map(ts => (
                <div
                  key={ts.typ}
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
                    <span className={'ml-auto font-medium '
                      + (ts.minKursy > 1 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400')}>
                      min. {ts.minKursy} {ts.minKursy === 1 ? 'kurs' : ts.minKursy < 5 ? 'kursy' : 'kursow'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Podpowiedzi szczegółowe */}
          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              {suggestions.map((s, i) => {
                const style = STYLES[s.type];
                return (
                  <div
                    key={i}
                    className={'rounded-md border px-3 py-2 text-sm ' + style.bg + ' ' + style.border}
                  >
                    <span>{style.icon} {s.message}</span>
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
