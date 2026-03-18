import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface KpiDzis {
  total: number;
  aktywne: number;
  zaplanowane: number;
  zakonczone: number;
}

export interface KpiTydzien {
  total: number;
  zakonczone: number;
}

export interface ZleceniePerOddzial {
  nazwa: string;
  liczba: number;
  bez_kursu: number;
  suma_kg: number;
}

export interface ZajetoscFloty {
  nr_rej: string;
  typ: string;
  oddzial: string;
  ladownosc_kg: number;
  objetosc_m3: number;
  uz_kg: number;
  uz_m3: number;
}

export interface KosztySplit {
  kursy_wlasne: number;
  kursy_zewnetrzne: number;
}

export interface ZlecenieBezKursu {
  id: string;
  numer: string;
  typ_pojazdu: string | null;
  dzien: string;
  preferowana_godzina: string | null;
  oddzial: string;
  suma_kg: number;
}

export interface AktywnyKurs {
  id: string;
  nr_rej: string;
  kierowca: string;
  oddzial: string;
  godzina_start: string | null;
  przystanki_total: number;
  przystanki_done: number;
}

export interface ZewnetrznyPrzewoznik {
  firma: string;
  nr_rej: string;
  typ: string;
  liczba_kursow: number;
  zakonczone: number;
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

function getWeekEnd() {
  const start = getWeekStart();
  const d = new Date(start);
  d.setDate(d.getDate() + 4);
  return d.toISOString().split('T')[0];
}

function getMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

export function useZarzadKPI() {
  const [kpiDzis, setKpiDzis] = useState<KpiDzis>({ total: 0, aktywne: 0, zaplanowane: 0, zakonczone: 0 });
  const [kpiTydzien, setKpiTydzien] = useState<KpiTydzien>({ total: 0, zakonczone: 0 });
  const [zleceniaPerOddzial, setZleceniaPerOddzial] = useState<ZleceniePerOddzial[]>([]);
  const [zajetoscFloty, setZajetoscFloty] = useState<ZajetoscFloty[]>([]);
  const [kosztySplit, setKosztySplit] = useState<KosztySplit>({ kursy_wlasne: 0, kursy_zewnetrzne: 0 });
  const [zleceniaBezKursu, setZleceniaBezKursu] = useState<ZlecenieBezKursu[]>([]);
  const [aktywneKursy, setAktywneKursy] = useState<AktywnyKurs[]>([]);
  const [zewnetrzniPrzewoznicy, setZewnetrzniPrzewoznicy] = useState<ZewnetrznyPrzewoznik[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchAll = useCallback(async () => {
    const today = getToday();
    const weekStart = getWeekStart();
    const weekEnd = getWeekEnd();
    const monthStart = getMonthStart();

    try {
      // 1. Kursy dziś
      const { data: kursyDzis } = await supabase
        .from('kursy')
        .select('status')
        .eq('dzien', today);

      const kd = kursyDzis || [];
      setKpiDzis({
        total: kd.length,
        aktywne: kd.filter(k => k.status === 'aktywny').length,
        zaplanowane: kd.filter(k => k.status === 'zaplanowany').length,
        zakonczone: kd.filter(k => k.status === 'zakonczony').length,
      });

      // 2. Kursy w tygodniu
      const { data: kursyTydzien } = await supabase
        .from('kursy')
        .select('status')
        .gte('dzien', weekStart)
        .lte('dzien', weekEnd);

      const kt = kursyTydzien || [];
      setKpiTydzien({
        total: kt.length,
        zakonczone: kt.filter(k => k.status === 'zakonczony').length,
      });

      // 3. Zlecenia per oddział
      const { data: oddzialy } = await supabase.from('oddzialy').select('id, nazwa');
      const { data: zleceniaDzis } = await supabase
        .from('zlecenia')
        .select('id, oddzial_id, status, kurs_id')
        .gte('created_at', today);
      const { data: allWz } = await supabase.from('zlecenia_wz').select('zlecenie_id, masa_kg');

      const wzMap = new Map<string, number>();
      (allWz || []).forEach(wz => {
        wzMap.set(wz.zlecenie_id, (wzMap.get(wz.zlecenie_id) || 0) + Number(wz.masa_kg));
      });

      // Get kurs_przystanki to check which zlecenia have kursy
      const { data: przystanki } = await supabase.from('kurs_przystanki').select('zlecenie_id');
      const zleceniaZKursem = new Set((przystanki || []).map(p => p.zlecenie_id));

      const perOddzial = (oddzialy || []).map(o => {
        const ozl = (zleceniaDzis || []).filter(z => z.oddzial_id === o.id);
        return {
          nazwa: o.nazwa,
          liczba: ozl.length,
          bez_kursu: ozl.filter(z => z.status === 'robocza' && !zleceniaZKursem.has(z.id)).length,
          suma_kg: ozl.reduce((sum, z) => sum + (wzMap.get(z.id) || 0), 0),
        };
      });
      setZleceniaPerOddzial(perOddzial);

      // 4. Zajętość floty
      const { data: flotaData } = await supabase
        .from('flota')
        .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, oddzial_id')
        .eq('aktywny', true);
      
      const { data: kursyDzisAll } = await supabase
        .from('kursy')
        .select('id, nr_rej_zewn')
        .eq('dzien', today);

      const zajetosc: ZajetoscFloty[] = (flotaData || []).map(f => {
        const oddzial = (oddzialy || []).find(o => o.id === f.oddzial_id);
        // Find kursy using this vehicle
        const vehicleKursy = (kursyDzisAll || []).filter(k => k.nr_rej_zewn === f.nr_rej);
        const kursIds = vehicleKursy.map(k => k.id);
        
        // Get przystanki for those kursy
        const vehiclePrzystanki = (przystanki || []).filter(p => 
          kursIds.some(kid => true) // simplified - we'd need kurs_id on przystanki
        );
        
        // Sum WZ for zlecenia in those przystanki
        let uzKg = 0;
        let uzM3 = 0;
        // For now use simplified calculation
        
        return {
          nr_rej: f.nr_rej,
          typ: f.typ,
          oddzial: oddzial?.nazwa || '',
          ladownosc_kg: Number(f.ladownosc_kg),
          objetosc_m3: Number(f.objetosc_m3),
          uz_kg: uzKg,
          uz_m3: uzM3,
        };
      });
      setZajetoscFloty(zajetosc);

      // 5. Koszty własne vs zewnętrzne
      const { data: kursyMiesiac } = await supabase
        .from('kursy')
        .select('id, nr_rej_zewn')
        .gte('dzien', monthStart);
      
      const { data: flotaZewnData } = await supabase
        .from('flota_zewnetrzna')
        .select('nr_rej');
      
      const zewnNrRej = new Set((flotaZewnData || []).map(f => f.nr_rej));
      const km = kursyMiesiac || [];
      setKosztySplit({
        kursy_zewnetrzne: km.filter(k => k.nr_rej_zewn && zewnNrRej.has(k.nr_rej_zewn)).length,
        kursy_wlasne: km.filter(k => !k.nr_rej_zewn || !zewnNrRej.has(k.nr_rej_zewn)).length,
      });

      // 6. Zlecenia bez kursu
      const { data: zleceniaRobocze } = await supabase
        .from('zlecenia')
        .select('id, numer, typ_pojazdu, dzien, preferowana_godzina, oddzial_id')
        .eq('status', 'robocza');

      const bezKursu: ZlecenieBezKursu[] = (zleceniaRobocze || [])
        .filter(z => !zleceniaZKursem.has(z.id))
        .map(z => ({
          id: z.id,
          numer: z.numer,
          typ_pojazdu: z.typ_pojazdu,
          dzien: z.dzien,
          preferowana_godzina: z.preferowana_godzina,
          oddzial: (oddzialy || []).find(o => o.id === z.oddzial_id)?.nazwa || '',
          suma_kg: wzMap.get(z.id) || 0,
        }));
      setZleceniaBezKursu(bezKursu);

      // 7. Aktywne kursy (live)
      const aktywne = (kursyDzis || []).filter(k => k.status === 'aktywny');
      // Re-fetch with more details
      const { data: aktywneDetails } = await supabase
        .from('kursy')
        .select('id, nr_rej_zewn, kierowca_nazwa, oddzial_id, godzina_start')
        .eq('dzien', today)
        .eq('status', 'aktywny');

      const { data: allPrzystanki } = await supabase.from('kurs_przystanki').select('kurs_id, status');

      const aktKursy: AktywnyKurs[] = (aktywneDetails || []).map(k => {
        const kPrzystanki = (allPrzystanki || []).filter(p => p.kurs_id === k.id);
        const oddzial = (oddzialy || []).find(o => o.id === k.oddzial_id);
        return {
          id: k.id,
          nr_rej: k.nr_rej_zewn || '',
          kierowca: k.kierowca_nazwa || '',
          oddzial: oddzial?.nazwa || '',
          godzina_start: k.godzina_start,
          przystanki_total: kPrzystanki.length,
          przystanki_done: kPrzystanki.filter(p => p.status === 'zakonczony').length,
        };
      });
      setAktywneKursy(aktKursy);

      // 8. Zewnętrzni przewoźnicy (for Koszty tab)
      const przewoznicy: ZewnetrznyPrzewoznik[] = (flotaZewnData || []).map(fz => {
        const fzKursy = km.filter(k => k.nr_rej_zewn === fz.nr_rej);
        return {
          firma: '',
          nr_rej: fz.nr_rej,
          typ: '',
          liczba_kursow: fzKursy.length,
          zakonczone: 0,
        };
      });
      // Re-fetch with full data
      const { data: flotaZewnFull } = await supabase.from('flota_zewnetrzna').select('firma, nr_rej, typ');
      const { data: kursyZakonczMiesiac } = await supabase
        .from('kursy')
        .select('nr_rej_zewn')
        .gte('dzien', monthStart)
        .eq('status', 'zakonczony');

      const przewoznicyFull: ZewnetrznyPrzewoznik[] = (flotaZewnFull || []).map(fz => {
        const fzKursyAll = km.filter(k => k.nr_rej_zewn === fz.nr_rej);
        const fzZakonczone = (kursyZakonczMiesiac || []).filter(k => k.nr_rej_zewn === fz.nr_rej);
        return {
          firma: fz.firma,
          nr_rej: fz.nr_rej,
          typ: fz.typ,
          liczba_kursow: fzKursyAll.length,
          zakonczone: fzZakonczone.length,
        };
      });
      setZewnetrzniPrzewoznicy(przewoznicyFull);

      setLastUpdated(new Date());
    } catch (err) {
      console.error('useZarzadKPI fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();

    // Auto-refresh every 60s
    const interval = setInterval(fetchAll, 60000);

    // Realtime subscription on kursy
    const channel = supabase
      .channel('zarzad-kursy')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kursy' }, () => {
        fetchAll();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  return {
    kpiDzis,
    kpiTydzien,
    zleceniaPerOddzial,
    zajetoscFloty,
    kosztySplit,
    zleceniaBezKursu,
    aktywneKursy,
    zewnetrzniPrzewoznicy,
    loading,
    lastUpdated,
  };
}
