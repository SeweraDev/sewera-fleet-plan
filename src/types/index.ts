export type UserRole = 'sprzedawca' | 'dyspozytor' | 'kierowca' | 'zarzad' | 'admin';

export interface UserProfile {
  id: string;
  full_name: string;
  roles: UserRole[];
  branch: string | null;
}

export const ROLE_ROUTES: Record<UserRole, string> = {
  admin: '/admin',
  zarzad: '/zarzad',
  dyspozytor: '/dyspozytor',
  sprzedawca: '/sprzedawca',
  kierowca: '/kierowca',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  zarzad: 'Zarząd',
  dyspozytor: 'Dyspozytor',
  sprzedawca: 'Sprzedawca',
  kierowca: 'Kierowca',
};
