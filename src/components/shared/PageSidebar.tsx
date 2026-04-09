import { useNavigate } from 'react-router-dom';

interface SidebarItem {
  id: string;
  label: string;
  badge?: number;
  url?: string;
}

interface PageSidebarProps {
  items: SidebarItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function PageSidebar({ items, activeId, onSelect }: PageSidebarProps) {
  const navigate = useNavigate();

  return (
    <aside className="w-[195px] shrink-0 bg-card border-r border-border flex flex-col">
      <nav className="py-2 flex-1">
        {items.map((item) => {
          const isActive = !item.url && item.id === activeId;
          return (
            <button
              key={item.id}
              onClick={() => item.url ? navigate(item.url) : onSelect(item.id)}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors border-l-[3px] ${
                isActive
                  ? 'border-primary bg-secondary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <span>{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="bg-accent text-accent-foreground text-xs font-medium rounded-full px-2 py-0.5 min-w-[20px] text-center">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
