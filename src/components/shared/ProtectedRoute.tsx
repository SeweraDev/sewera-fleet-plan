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
  const { user, profile, roles, primaryRole, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || !profile) return <Navigate to="/login" replace />;
  if (roles.length === 0) return <Navigate to="/login" replace />;

  const hasRole = roles.some((r) => allowedRoles.includes(r as UserRole));
  if (!hasRole) {
    const fallback = ROLE_ROUTES[primaryRole as UserRole] || '/login';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
