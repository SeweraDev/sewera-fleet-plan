import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABELS } from '@/types';
import { Badge } from '@/components/ui/badge';

export function Topbar() {
  const { profile } = useAuth();

  return (
    <header className="h-14 flex items-center border-b bg-card px-4 gap-3">
      <SidebarTrigger className="shrink-0" />
      <div className="flex-1" />
      {profile && (
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs">
            {ROLE_LABELS[profile.roles[0]]}
          </Badge>
          <span className="text-sm font-medium text-foreground">
            {profile.full_name}
          </span>
        </div>
      )}
    </header>
  );
}
