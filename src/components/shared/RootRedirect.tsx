import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_ROUTES } from '@/types';
import type { UserRole } from '@/types';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

export function RootRedirect() {
  const { user, primaryRole, roles, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || roles.length === 0) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={ROLE_ROUTES[primaryRole as UserRole] || '/login'} replace />;
}
