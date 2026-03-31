import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface Powiadomienie {
  id: string;
  typ: string;
  tresc: string;
  zlecenie_id: string | null;
  przeczytane: boolean;
  created_at: string;
}

export function usePowiadomienia() {
  const { user } = useAuth();
  const [powiadomienia, setPowiadomienia] = useState<Powiadomienie[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('powiadomienia')
      .select('id, typ, tresc, zlecenie_id, przeczytane, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setPowiadomienia((data as Powiadomienie[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { refetch(); }, [refetch]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`powiadomienia-realtime-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'powiadomienia',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newItem = payload.new as Powiadomienie;
          setPowiadomienia(prev => [newItem, ...prev].slice(0, 20));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const markAsRead = useCallback(async (id: string) => {
    await supabase
      .from('powiadomienia')
      .update({ przeczytane: true })
      .eq('id', id);
    setPowiadomienia(prev =>
      prev.map(p => p.id === id ? { ...p, przeczytane: true } : p)
    );
  }, []);

  const unreadCount = powiadomienia.filter(p => !p.przeczytane).length;

  return { powiadomienia, loading, unreadCount, markAsRead, refetch };
}
