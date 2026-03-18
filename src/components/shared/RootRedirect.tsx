import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_ROUTES } from '@/types';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

export function RootRedirect() {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || !profile || profile.roles.length === 0) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={ROLE_ROUTES[profile.roles[0]]} replace />;
}
