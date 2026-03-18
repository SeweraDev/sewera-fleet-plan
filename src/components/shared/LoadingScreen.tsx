import { Truck } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <Truck className="h-12 w-12 text-primary animate-pulse" />
      <p className="text-muted-foreground text-sm font-medium tracking-wide">Ładowanie...</p>
    </div>
  );
}
