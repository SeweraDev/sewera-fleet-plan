import { Topbar } from '@/components/shared/Topbar';
import { Card, CardContent } from '@/components/ui/card';

function formatDate() {
  const d = new Date();
  const days = ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${day} ${dd}.${mm}`;
}

export default function KierowcaMojaTrasa() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <main className="flex-1 w-full max-w-[480px] mx-auto px-5 py-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-foreground">🚛 Moje kursy</h1>
          <span className="text-sm text-muted-foreground">{formatDate()}</span>
        </div>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Brak kursów na dziś
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
