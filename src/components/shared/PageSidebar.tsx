interface SidebarItem {
  id: string;
  label: string;
  badge?: number;
}

interface PageSidebarProps {
  items: SidebarItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function PageSidebar({ items, activeId, onSelect }: PageSidebarProps) {
  return (
    <aside className="w-[195px] shrink-0 bg-card border-r border-border">
      <nav className="py-2">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
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
