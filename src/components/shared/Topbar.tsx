import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABELS } from '@/types';
import type { UserRole } from '@/types';
import { LogOut } from 'lucide-react';

const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  sprzedawca: 'bg-[hsl(var(--role-sprzedawca))]',
  dyspozytor: 'bg-[hsl(var(--role-dyspozytor))]',
  kierowca: 'bg-[hsl(var(--role-kierowca))]',
  zarzad: 'bg-[hsl(var(--role-zarzad))]',
  admin: 'bg-[hsl(var(--role-admin))]',
};

interface TopbarProps {
  extra?: React.ReactNode;
}

export function Topbar({ extra }: TopbarProps) {
  const { profile, signOut } = useAuth();

  const role = profile?.roles[0];

  return (
    <header className="h-[52px] flex items-center bg-primary px-5 shrink-0">
      <span className="text-[15px] font-bold text-primary-foreground tracking-tight">
        🚛 TRANSPORT
      </span>

      {extra && <div className="ml-4">{extra}</div>}

      <div className="flex-1" />

      {profile && role && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-primary-foreground/90">
            {profile.full_name}
          </span>
          <span
            className={`text-xs text-white px-2.5 py-0.5 rounded-full font-medium ${ROLE_BADGE_COLORS[role]}`}
          >
            {ROLE_LABELS[role]}
          </span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs text-primary-foreground/70 hover:text-primary-foreground transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Wyloguj
          </button>
        </div>
      )}
    </header>
  );
}
