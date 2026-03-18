import { useState } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { Card, CardContent } from '@/components/ui/card';

const SIDEBAR_ITEMS = [
  { id: 'kursy', label: '🚛 Kursy', badge: 0 },
  { id: 'mapa', label: '🗺️ Mapa tras' },
  { id: 'zlecenia', label: '📋 Zlecenia' },
  { id: 'plan', label: '📅 Plan floty' },
  { id: 'flota', label: '🔧 Flota' },
];

const SECTION_PLACEHOLDERS: Record<string, string> = {
  kursy: 'Tu będą kursy',
  mapa: 'Tu będzie mapa tras',
  zlecenia: 'Tu będą zlecenia',
  plan: 'Tu będzie plan floty',
  flota: 'Tu będzie zarządzanie flotą',
};

export default function DyspozytorDashboard() {
  const [activeId, setActiveId] = useState('kursy');

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <div className="flex flex-1">
        <PageSidebar items={SIDEBAR_ITEMS} activeId={activeId} onSelect={setActiveId} />
        <main className="flex-1 p-6">
          <Card className="bg-muted">
            <CardContent className="p-8 text-center text-muted-foreground">
              {SECTION_PLACEHOLDERS[activeId]}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
