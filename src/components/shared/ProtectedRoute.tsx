import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LoadingScreen } from '@/components/shared/LoadingScreen';
import { ROLE_ROUTES } from '@/types';
import type { UserRole } from '@/types';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || !profile) return <Navigate to="/login" replace />;

  const hasRole = profile.roles.some((r) => allowedRoles.includes(r));
  if (!hasRole) {
    const fallback = ROLE_ROUTES[profile.roles[0]] || '/login';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
