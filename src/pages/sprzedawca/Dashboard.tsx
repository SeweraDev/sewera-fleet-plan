import { useState } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const SIDEBAR_ITEMS = [
  { id: 'nowe', label: '➕ Nowe zlecenie' },
  { id: 'moje', label: '📋 Moje zlecenia' },
];

export default function SprzedawcaDashboard() {
  const [activeId, setActiveId] = useState('nowe');

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar
        extra={
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 text-xs">
            + Nowe zlecenie
          </Button>
        }
      />
      <div className="flex flex-1">
        <PageSidebar items={SIDEBAR_ITEMS} activeId={activeId} onSelect={setActiveId} />
        <main className="flex-1 p-6">
          <Card className="bg-muted">
            <CardContent className="p-8 text-center text-muted-foreground">
              {activeId === 'nowe'
                ? 'Tu będzie formularz zlecenia'
                : 'Tu będą moje zlecenia'}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
