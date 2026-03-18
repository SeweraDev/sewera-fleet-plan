import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/AuthProvider';
import { ROLE_ROUTES } from '@/types/auth';
import { useNavigate } from 'react-router-dom';

export default function UnauthorizedPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <ShieldX className="h-16 w-16 text-destructive" />
      <h1 className="text-2xl font-bold text-foreground">Brak dostępu</h1>
      <p className="text-muted-foreground">Nie masz uprawnień do tej strony.</p>
      <div className="flex gap-2">
        {profile && (
          <Button onClick={() => navigate(ROLE_ROUTES[profile.roles[0]])}>
            Mój panel
          </Button>
        )}
        <Button variant="outline" onClick={signOut}>
          Wyloguj
        </Button>
      </div>
    </div>
  );
}
