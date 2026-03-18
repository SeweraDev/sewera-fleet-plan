import { cn } from '@/lib/utils';

type StatusVariant =
  | 'w-trasie' | 'w_trasie' | 'dostarczono' | 'dostarczona' | 'opoznienie'
  | 'oczekuje' | 'anulowano' | 'robocza' | 'potwierdzona'
  | 'zaplanowany' | 'aktywny' | 'zakonczony' | 'dostarczone' | 'nieudane';

const variants: Record<StatusVariant, string> = {
  'w-trasie': 'bg-info/15 text-info border-info/30',
  'w_trasie': 'bg-info/15 text-info border-info/30',
  'dostarczono': 'bg-success/15 text-success border-success/30',
  'dostarczona': 'bg-success/15 text-success border-success/30',
  'dostarczone': 'bg-success/15 text-success border-success/30',
  'opoznienie': 'bg-destructive/15 text-destructive border-destructive/30',
  'nieudane': 'bg-destructive/15 text-destructive border-destructive/30',
  'oczekuje': 'bg-warning/15 text-warning border-warning/30',
  'anulowano': 'bg-muted text-muted-foreground border-border',
  'robocza': 'bg-muted text-muted-foreground border-border',
  'potwierdzona': 'bg-accent/15 text-accent-foreground border-accent/30',
  'zaplanowany': 'bg-accent/15 text-accent-foreground border-accent/30',
  'aktywny': 'bg-info/15 text-info border-info/30',
  'zakonczony': 'bg-success/15 text-success border-success/30',
};

const labels: Record<StatusVariant, string> = {
  'w-trasie': 'W trasie',
  'w_trasie': 'W trasie',
  'dostarczono': 'Dostarczono',
  'dostarczona': 'Dostarczona',
  'dostarczone': 'Dostarczone',
  'opoznienie': 'Opóźnienie',
  'nieudane': 'Nieudane',
  'oczekuje': 'Oczekuje',
  'anulowano': 'Anulowano',
  'robocza': 'Robocza',
  'potwierdzona': 'Potwierdzona',
  'zaplanowany': 'Zaplanowany',
  'aktywny': 'Aktywny',
  'zakonczony': 'Zakończony',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = status as StatusVariant;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        variants[variant] || 'bg-muted text-muted-foreground border-border',
        className
      )}
    >
      {labels[variant] || status}
    </span>
  );
}
