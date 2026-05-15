import {
  LayoutDashboard,
  Truck,
  Users,
  ShoppingCart,
  BarChart3,
  Settings,
  MapPin,
  Map,
  LogOut,
  Calculator,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/hooks/useAuth';
import type { UserRole } from '@/types';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  admin: [
    { title: 'Użytkownicy', url: '/admin', icon: Users },
    { title: 'Statystyki wyceny', url: '/admin/statystyki-wyceny', icon: BarChart3 },
    { title: 'Katalog towarów', url: '/admin/katalog-towarow', icon: ShoppingCart },
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
    { title: 'Ustawienia', url: '/admin/ustawienia', icon: Settings },
  ],
  zarzad: [
    { title: 'Dashboard', url: '/zarzad', icon: BarChart3 },
    { title: 'Rozliczenie kosztów', url: '/rozliczenie-kosztow', icon: Calculator },
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
  ],
  dyspozytor: [
    { title: 'Dashboard', url: '/dyspozytor', icon: LayoutDashboard },
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
  ],
  sprzedawca: [
    { title: 'Dashboard', url: '/sprzedawca', icon: LayoutDashboard },
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
    { title: 'Zlecenia', url: '/sprzedawca/zlecenia', icon: ShoppingCart },
  ],
  kierowca: [
    { title: 'Moja trasa', url: '/kierowca', icon: MapPin },
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
  ],
};

const ROLE_ORDER: UserRole[] = ['admin', 'zarzad', 'dyspozytor', 'sprzedawca', 'kierowca'];

export function AppSidebar() {
  const { profile, signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  if (!profile) return null;

  // Multi-role: agreguj nawigacje ze wszystkich rol usera, dedup po url
  // (pierwszy URL wg ROLE_ORDER wygrywa). Dzieki temu user z wieloma rolami
  // widzi w sidebarze sumę sekcji.
  const userRoles = ROLE_ORDER.filter((r) => profile.roles.includes(r));
  const seen = new Set<string>();
  const items: NavItem[] = [];
  for (const r of userRoles) {
    for (const item of NAV_BY_ROLE[r] || []) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="flex items-center gap-2 px-4 py-4">
          <Truck className="h-6 w-6 text-sidebar-primary shrink-0" />
          {!collapsed && (
            <span className="text-lg font-bold text-sidebar-foreground tracking-tight">
              Sewera
            </span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/60">
            {!collapsed && 'Nawigacja'}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut} className="hover:bg-sidebar-accent/50">
              <LogOut className="mr-2 h-4 w-4 shrink-0" />
              {!collapsed && <span>Wyloguj</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
