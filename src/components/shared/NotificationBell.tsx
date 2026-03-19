import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { usePowiadomienia } from '@/hooks/usePowiadomienia';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'teraz';
  if (mins < 60) return `${mins} min temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} godz. temu`;
  const days = Math.floor(hrs / 24);
  return `${days} dn. temu`;
}

export function NotificationBell() {
  const { powiadomienia, unreadCount, markAsRead } = usePowiadomienia();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleClick = (p: typeof powiadomienia[0]) => {
    if (!p.przeczytane) markAsRead(p.id);
    setOpen(false);
    if (p.zlecenie_id) {
      navigate('/dyspozytor');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative flex items-center justify-center text-primary-foreground/80 hover:text-primary-foreground transition-colors">
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
              {unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 max-h-96 overflow-auto" align="end">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-semibold">Powiadomienia</p>
        </div>
        {powiadomienia.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Brak powiadomień</p>
        ) : (
          powiadomienia.map(p => (
            <button
              key={p.id}
              onClick={() => handleClick(p)}
              className={`w-full text-left px-3 py-2.5 border-b last:border-0 hover:bg-muted/50 transition-colors ${
                !p.przeczytane ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''
              }`}
            >
              <div className="flex gap-2 items-start">
                <span className="text-sm mt-0.5">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug">{p.tresc}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(p.created_at)}</p>
                </div>
              </div>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
