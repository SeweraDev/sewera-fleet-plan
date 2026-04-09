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
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
    { title: 'Ustawienia', url: '/admin/ustawienia', icon: Settings },
  ],
  zarzad: [
    { title: 'Dashboard', url: '/zarzad', icon: BarChart3 },
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
  ],
  dyspozytor: [
    { title: 'Dashboard', url: '/dyspozytor', icon: LayoutDashboard },
    { title: 'Mapa dostaw', url: '/mapa', icon: Map },
    { title: 'Flota', url: '/dyspozytor/flota', icon: Truck },
    { title: 'Trasy', url: '/dyspozytor/trasy', icon: MapPin },
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

export function AppSidebar() {
  const { profile, signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  if (!profile) return null;

  const role = profile.roles[0];
  const items = NAV_BY_ROLE[role] || [];

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
