import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Truck, MapPin, AlertTriangle, CheckCircle } from 'lucide-react';

export default function DyspozytorDashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Panel Dyspozytora</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Pojazdy aktywne', value: '—', icon: Truck },
          { label: 'Trasy na dziś', value: '—', icon: MapPin },
          { label: 'Opóźnienia', value: '—', icon: AlertTriangle },
          { label: 'Ukończone', value: '—', icon: CheckCircle },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
