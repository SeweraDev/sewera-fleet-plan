import { useMemo, useState } from 'react';
import { computeSuggestions, type RouteSuggestion } from '@/lib/suggestRoutes';

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

export function SuggestionPanel({ orders }: { orders: Order[] }) {
  const [collapsed, setCollapsed] = useState(false);

  const suggestions = useMemo(
    () => computeSuggestions(orders),
    [orders]
  );

  if (suggestions.length === 0) return null;

  const warnings = suggestions.filter(s => s.type === 'overweight').length;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
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
    </div>
  );
}
