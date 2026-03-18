import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { UserProfile, AppRole } from '@/types/auth';
import { ROLE_ROUTES } from '@/types/auth';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError || !profileData) return null;

  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);

  const roles = (rolesData || []).map((r) => r.role as AppRole);

  return {
    id: profileData.id,
    full_name: profileData.full_name,
    roles,
    branch: profileData.branch,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Set up auth listener BEFORE getSession
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          // Use setTimeout to avoid Supabase deadlock
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

    // Then check existing session
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

    // Profile will be loaded by onAuthStateChange, but we need to navigate
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

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
