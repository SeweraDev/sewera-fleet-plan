import React, { createContext, useContext, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserProfile, AppRole } from '@/types/auth';
import { ROLE_ROUTES } from '@/types/auth';

// Mock profiles for development (remove when Lovable Cloud is enabled)
const MOCK_PROFILES: Record<string, UserProfile> = {
  admin: { id: '1', full_name: 'Jan Kowalski', roles: ['admin'], branch: null },
  zarzad: { id: '2', full_name: 'Anna Nowak', roles: ['zarzad'], branch: null },
  dyspozytor: { id: '3', full_name: 'Piotr Wiśniewski', roles: ['dyspozytor'], branch: 'Warszawa' },
  sprzedawca: { id: '4', full_name: 'Maria Zielińska', roles: ['sprzedawca'], branch: 'Kraków' },
  kierowca: { id: '5', full_name: 'Tomasz Lewandowski', roles: ['kierowca'], branch: 'Warszawa' },
};

interface AuthContextType {
  user: { id: string; email: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading] = useState(false);
  const navigate = useNavigate();

  const signIn = useCallback(async (email: string, _password: string) => {
    // Mock: extract role from email prefix (e.g. admin@sewera.pl)
    const role = email.split('@')[0] as AppRole;
    const mockProfile = MOCK_PROFILES[role];
    
    if (!mockProfile) {
      throw new Error('Nieprawidłowy email lub hasło');
    }

    setUser({ id: mockProfile.id, email });
    setProfile(mockProfile);
    
    const redirectPath = ROLE_ROUTES[mockProfile.roles[0]];
    navigate(redirectPath);
  }, [navigate]);

  const signOut = useCallback(() => {
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
