import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { LoadingScreen } from '@/components/shared/LoadingScreen';
import { ROLE_ROUTES } from '@/types/auth';
import type { AppRole } from '@/types/auth';

interface ProtectedRouteProps {
  allowedRoles: AppRole[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || !profile) return <Navigate to="/login" replace />;

  const hasRole = profile.roles.some((r) => allowedRoles.includes(r));
  if (!hasRole) {
    const fallback = ROLE_ROUTES[profile.roles[0]] || '/login';
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}
