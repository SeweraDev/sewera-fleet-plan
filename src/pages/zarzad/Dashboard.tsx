import { useState } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { Card, CardContent } from '@/components/ui/card';

const SIDEBAR_ITEMS = [
  { id: 'kpi', label: '📊 KPI' },
  { id: 'koszty', label: '💰 Koszty' },
  { id: 'raporty', label: '📈 Raporty' },
];

const SECTION_PLACEHOLDERS: Record<string, string> = {
  kpi: 'Tu będą dashboardy zarządcze — wkrótce',
  koszty: 'Tu będą koszty — wkrótce',
  raporty: 'Tu będą raporty — wkrótce',
};

export default function ZarzadDashboard() {
  const [activeId, setActiveId] = useState('kpi');

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
