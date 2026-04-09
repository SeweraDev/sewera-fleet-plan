import { useMemo, useState } from 'react';
import { computeSuggestions, computeTypeSummary } from '@/lib/suggestRoutes';

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

interface Props {
  orders: Order[];
  availableTypes?: string[];
}

export function SuggestionPanel({ orders, availableTypes }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const warnings = useMemo(
    () => computeSuggestions(orders, availableTypes),
    [orders, availableTypes]
  );

  const typeSummary = useMemo(
    () => computeTypeSummary(orders),
    [orders]
  );

  if (warnings.length === 0 && typeSummary.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="font-semibold text-sm">
          Podsumowanie
        </span>
        {warnings.length > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
            {warnings.length} {warnings.length === 1 ? 'ostrzeżenie' : warnings.length < 5 ? 'ostrzeżenia' : 'ostrzeżeń'}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {collapsed ? '▶' : '▼'}
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Ostrzeżenia */}
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((s, i) => (
                <div
                  key={i}
                  className="rounded-md border px-3 py-2 text-sm bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                >
                  <span>⚠️ {s.message}</span>
                </div>
              ))}
            </div>
          )}

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
        </>
      )}
    </div>
  );
}
