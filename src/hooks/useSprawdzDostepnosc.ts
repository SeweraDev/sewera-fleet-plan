import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VehicleOccupancy {
  flota_id: string;
  nr_rej: string;
  typ: string;
  ladownosc_kg: number;
  objetosc_m3: number | null;
  max_palet: number | null;
  used_kg: number;
  used_m3: number;
  used_palet: number;
  pct_kg: number;
  pct_m3: number;
  pct_palet: number;
  fits: boolean;
}

export interface NextAvailable {
  dzien: string;
  nr_rej: string;
  typ: string;
  pct_kg: number;
  pct_m3: number;
  pct_palet: number;
}

export interface OccupancyResult {
  vehicles: VehicleOccupancy[];
  anyFits: boolean;
  loading: boolean;
  nextAvailable: NextAvailable | null;
  searchingNext: boolean;
}

function pctColor(pct: number): string {
  if (pct <= 70) return 'text-green-600 dark:text-green-400';
  if (pct <= 90) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function pctBg(pct: number): string {
  if (pct <= 70) return 'bg-green-500';
  if (pct <= 90) return 'bg-orange-500';
  return 'bg-red-500';
}

export { pctColor, pctBg };

// Helper: calculate vehicle loads for a set of days
async function getVehicleLoads(vehicleIds: string[], days: string[]) {
  const { data: kursy } = await supabase
    .from('kursy')
    .select('id, flota_id, dzien')
    .in('flota_id', vehicleIds)
    .in('dzien', days);

  if (!kursy || kursy.length === 0) return new Map<string, Map<string, { kg: number; m3: number; palet: number }>>();

  const kursIds = kursy.map(k => k.id);
  const { data: przystanki } = await supabase
    .from('kurs_przystanki')
    .select('zlecenie_id, kurs_id')
    .in('kurs_id', kursIds);

  const zlecenieIds = (przystanki || []).filter(p => p.zlecenie_id).map(p => p.zlecenie_id!);
  let wzLoads: { zlecenie_id: string; masa_kg: number; objetosc_m3: number; ilosc_palet: number }[] = [];

  if (zlecenieIds.length > 0) {
    const { data: wz } = await supabase
      .from('zlecenia_wz')
      .select('zlecenie_id, masa_kg, objetosc_m3, ilosc_palet')
      .in('zlecenie_id', zlecenieIds);
    wzLoads = (wz || []).map(w => ({
      zlecenie_id: w.zlecenie_id,
      masa_kg: Number(w.masa_kg) || 0,
      objetosc_m3: Number(w.objetosc_m3) || 0,
      ilosc_palet: Number(w.ilosc_palet) || 0,
    }));
  }

  // Build: vehicleId → day → loads
  const result = new Map<string, Map<string, { kg: number; m3: number; palet: number }>>();
  vehicleIds.forEach(vid => {
    const dayMap = new Map<string, { kg: number; m3: number; palet: number }>();
    days.forEach(d => dayMap.set(d, { kg: 0, m3: 0, palet: 0 }));
    result.set(vid, dayMap);
  });

  const kursMap = new Map<string, { flota_id: string; dzien: string }>();
  kursy.forEach(k => { if (k.flota_id) kursMap.set(k.id, { flota_id: k.flota_id, dzien: k.dzien }); });

  (przystanki || []).forEach(p => {
    if (!p.zlecenie_id) return;
    const kurs = kursMap.get(p.kurs_id);
    if (!kurs) return;
    const loads = wzLoads.filter(w => w.zlecenie_id === p.zlecenie_id);
    const entry = result.get(kurs.flota_id)?.get(kurs.dzien);
    if (!entry) return;
    loads.forEach(l => {
      entry.kg += l.masa_kg;
      entry.m3 += l.objetosc_m3;
      entry.palet += l.ilosc_palet;
    });
  });

  return result;
}

// Helper: get blocked vehicle+day pairs
async function getBlokady(vehicleIds: string[], days: string[]): Promise<Set<string>> {
  const { data } = await supabase
    .from('dostepnosc_blokady')
    .select('zasob_id, dzien')
    .eq('typ', 'flota')
    .in('zasob_id', vehicleIds)
    .in('dzien', days);

  const blocked = new Set<string>();
  (data || []).forEach(b => blocked.add(`${b.zasob_id}_${b.dzien}`));
  return blocked;
}

// Helper: generate date strings for N days from start
function generateDays(startDzien: string, count: number): string[] {
  const days: string[] = [];
  const start = new Date(startDzien);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    // Skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

export function useSprawdzDostepnosc() {
  const [result, setResult] = useState<OccupancyResult>({
    vehicles: [], anyFits: false, loading: false,
    nextAvailable: null, searchingNext: false,
  });

  const check = useCallback(async (
    oddzialId: number,
    typPojazdu: string,
    dzien: string,
    newKg: number,
    newM3: number,
    newPalet: number,
  ) => {
    setResult(prev => ({ ...prev, loading: true, nextAvailable: null, searchingNext: false }));

    // 1. Get matching vehicles
    const isAny = !typPojazdu || typPojazdu === 'bez_preferencji' || typPojazdu === 'zewnetrzny';
    let query = supabase
      .from('flota')
      .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
      .eq('oddzial_id', oddzialId)
      .eq('aktywny', true);
    if (!isAny) {
      query = query.eq('typ', typPojazdu);
    }
    const { data: vehicles } = await query;
    if (!vehicles || vehicles.length === 0) {
      setResult({ vehicles: [], anyFits: false, loading: false, nextAvailable: null, searchingNext: false });
      return;
    }

    const vehicleIds = vehicles.map(v => v.id);

    // 2. Get loads + blokady for the requested day
    const loadsMap = await getVehicleLoads(vehicleIds, [dzien]);
    const blocked = await getBlokady(vehicleIds, [dzien]);

    // 3. Build occupancy
    const occupancy: VehicleOccupancy[] = vehicles
      .filter(v => !blocked.has(`${v.id}_${dzien}`))
      .map(v => {
        const used = loadsMap.get(v.id)?.get(dzien) || { kg: 0, m3: 0, palet: 0 };
        const afterKg = used.kg + newKg;
        const afterM3 = used.m3 + newM3;
        const afterPalet = used.palet + newPalet;

        const cap_kg = Number(v.ladownosc_kg) || 1;
        const cap_m3 = Number(v.objetosc_m3) || null;
        const cap_palet = v.max_palet || null;

        const pct_kg = Math.round((afterKg / cap_kg) * 100);
        const pct_m3 = cap_m3 ? Math.round((afterM3 / cap_m3) * 100) : 0;
        const pct_palet = cap_palet ? Math.round((afterPalet / cap_palet) * 100) : 0;

        const fits = pct_kg <= 100
          && (!cap_m3 || pct_m3 <= 100)
          && (!cap_palet || pct_palet <= 100);

        return {
          flota_id: v.id, nr_rej: v.nr_rej, typ: v.typ,
          ladownosc_kg: cap_kg, objetosc_m3: cap_m3, max_palet: cap_palet,
          used_kg: afterKg, used_m3: afterM3, used_palet: afterPalet,
          pct_kg, pct_m3, pct_palet, fits,
        };
      });

    occupancy.sort((a, b) => a.pct_kg - b.pct_kg);
    const anyFits = occupancy.some(v => v.fits);

    setResult({ vehicles: occupancy, anyFits, loading: false, nextAvailable: null, searchingNext: !anyFits });

    // 4. If nothing fits → search next 14 working days in background
    if (!anyFits && vehicles.length > 0) {
      const futureDays = generateDays(dzien, 21).filter(d => d !== dzien); // 21 calendar = ~14 working
      if (futureDays.length === 0) {
        setResult(prev => ({ ...prev, searchingNext: false }));
        return;
      }

      const futureLoads = await getVehicleLoads(vehicleIds, futureDays);
      const futureBlocked = await getBlokady(vehicleIds, futureDays);

      for (const day of futureDays) {
        for (const v of vehicles) {
          if (futureBlocked.has(`${v.id}_${day}`)) continue;

          const used = futureLoads.get(v.id)?.get(day) || { kg: 0, m3: 0, palet: 0 };
          const afterKg = used.kg + newKg;
          const afterM3 = used.m3 + newM3;
          const afterPalet = used.palet + newPalet;

          const cap_kg = Number(v.ladownosc_kg) || 1;
          const cap_m3 = Number(v.objetosc_m3) || null;
          const cap_palet = v.max_palet || null;

          const pct_kg = Math.round((afterKg / cap_kg) * 100);
          const pct_m3 = cap_m3 ? Math.round((afterM3 / cap_m3) * 100) : 0;
          const pct_palet = cap_palet ? Math.round((afterPalet / cap_palet) * 100) : 0;

          const fits = pct_kg <= 100
            && (!cap_m3 || pct_m3 <= 100)
            && (!cap_palet || pct_palet <= 100);

          if (fits) {
            setResult(prev => ({
              ...prev,
              searchingNext: false,
              nextAvailable: { dzien: day, nr_rej: v.nr_rej, typ: v.typ, pct_kg, pct_m3, pct_palet },
            }));
            return;
          }
        }
      }

      // Nothing found in 14 working days
      setResult(prev => ({ ...prev, searchingNext: false, nextAvailable: null }));
    }
  }, []);

  return { ...result, check };
}
