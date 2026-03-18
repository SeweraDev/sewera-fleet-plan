import { cn } from '@/lib/utils';

type StatusVariant = 'w-trasie' | 'dostarczono' | 'opoznienie' | 'oczekuje' | 'anulowano';

const variants: Record<StatusVariant, string> = {
  'w-trasie': 'bg-info/15 text-info border-info/30',
  'dostarczono': 'bg-success/15 text-success border-success/30',
  'opoznienie': 'bg-destructive/15 text-destructive border-destructive/30',
  'oczekuje': 'bg-warning/15 text-warning border-warning/30',
  'anulowano': 'bg-muted text-muted-foreground border-border',
};

const labels: Record<StatusVariant, string> = {
  'w-trasie': 'W trasie',
  'dostarczono': 'Dostarczono',
  'opoznienie': 'Opóźnienie',
  'oczekuje': 'Oczekuje',
  'anulowano': 'Anulowano',
};

interface StatusBadgeProps {
  status: StatusVariant;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        variants[status],
        className
      )}
    >
      {labels[status]}
    </span>
  );
}
