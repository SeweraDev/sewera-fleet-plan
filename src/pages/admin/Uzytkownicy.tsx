import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';

export default function Uzytkownicy() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Panel Administratora</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            Zarządzanie użytkownikami
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Tutaj pojawi się lista użytkowników systemu z możliwością zarządzania rolami i kontami.</p>
        </CardContent>
      </Card>
    </div>
  );
}
