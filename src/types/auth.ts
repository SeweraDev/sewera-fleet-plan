export type AppRole = 'admin' | 'zarzad' | 'dyspozytor' | 'sprzedawca' | 'kierowca';

export interface UserProfile {
  id: string;
  full_name: string;
  roles: AppRole[];
  branch: string | null;
}

export const ROLE_ROUTES: Record<AppRole, string> = {
  admin: '/admin',
  zarzad: '/zarzad',
  dyspozytor: '/dyspozytor',
  sprzedawca: '/sprzedawca',
  kierowca: '/kierowca',
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrator',
  zarzad: 'Zarząd',
  dyspozytor: 'Dyspozytor',
  sprzedawca: 'Sprzedawca',
  kierowca: 'Kierowca',
};
