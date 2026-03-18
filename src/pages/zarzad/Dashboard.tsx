import { useState } from 'react';
import { Topbar } from '@/components/shared/Topbar';
import { PageSidebar } from '@/components/shared/PageSidebar';
import { LoadingScreen } from '@/components/shared/LoadingScreen';
import { useZarzadKPI } from '@/hooks/useZarzadKPI';
import { KpiTab } from '@/components/zarzad/KpiTab';
import { KosztyTab } from '@/components/zarzad/KosztyTab';
import { RaportyTab } from '@/components/zarzad/RaportyTab';

const SIDEBAR_ITEMS = [
  { id: 'kpi', label: '📊 KPI' },
  { id: 'koszty', label: '💰 Koszty' },
  { id: 'raporty', label: '📈 Raporty' },
];

export default function ZarzadDashboard() {
  const [activeId, setActiveId] = useState('kpi');
  const kpi = useZarzadKPI();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Topbar />
      <div className="flex flex-1">
        <PageSidebar items={SIDEBAR_ITEMS} activeId={activeId} onSelect={setActiveId} />
        <main className="flex-1 p-6 overflow-auto">
          {kpi.loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Ładowanie danych...</p>
            </div>
          ) : (
            <>
              {activeId === 'kpi' && (
                <KpiTab
                  kpiDzis={kpi.kpiDzis}
                  zajetoscFloty={kpi.zajetoscFloty}
                  kosztySplit={kpi.kosztySplit}
                  aktywneKursy={kpi.aktywneKursy}
                  zleceniaPerOddzial={kpi.zleceniaPerOddzial}
                  zleceniaBezKursu={kpi.zleceniaBezKursu}
                  lastUpdated={kpi.lastUpdated}
                />
              )}
              {activeId === 'koszty' && (
                <KosztyTab
                  kosztySplit={kpi.kosztySplit}
                  zewnetrzniPrzewoznicy={kpi.zewnetrzniPrzewoznicy}
                />
              )}
              {activeId === 'raporty' && <RaportyTab />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
