import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { UserProfile, UserRole } from '@/types';
import { ROLE_ROUTES } from '@/types';
import type { User } from '@supabase/supabase-js';

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data: profileData, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !profileData) return null;

  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);

  const roles = (rolesData || []).map((r) => r.role as UserRole);

  return {
    id: profileData.id,
    full_name: profileData.full_name,
    roles,
    branch: profileData.branch,
  };
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Set up listener BEFORE getSession
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          setUser(session.user);
          setTimeout(async () => {
            const p = await fetchProfile(session.user.id);
            setProfile(p);
            setLoading(false);
          }, 0);
        } else {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        const p = await fetchProfile(session.user.id);
        setProfile(p);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      const p = await fetchProfile(authUser.id);
      if (p && p.roles.length > 0) {
        navigate(ROLE_ROUTES[p.roles[0]]);
      }
    }
  }, [navigate]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    navigate('/login');
  }, [navigate]);

  const roles = profile?.roles ?? [];
  const primaryRole = roles[0] ?? '';

  return { user, profile, roles, primaryRole, loading, signIn, signOut };
}
