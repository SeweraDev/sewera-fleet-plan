import { Topbar } from '@/components/shared/Topbar';
import { Card, CardContent } from '@/components/ui/card';

export default function AdminUzytkownicy() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <main className="flex-1 p-6">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Panel administracyjny — zarządzanie kontami — wkrótce
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
