import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Navigation, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';

export default function MojaTrasa() {
  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Moja Trasa</h1>
        <StatusBadge status="oczekuje" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Navigation className="h-4 w-4 text-accent" />
            Dzisiejsze przystanki
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Brak przypisanej trasy na dziś.</p>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90">
          <MapPin className="mr-2 h-4 w-4" />
          Nawiguj
        </Button>
        <Button variant="outline" className="flex-1">
          <Phone className="mr-2 h-4 w-4" />
          Kontakt
        </Button>
      </div>
    </div>
  );
}
