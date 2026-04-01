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

export function pctColor(pct: number): string {
  if (pct <= 70) return 'text-green-600 dark:text-green-400';
  if (pct <= 90) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

export function pctBg(pct: number): string {
  if (pct <= 70) return 'bg-green-500';
  if (pct <= 90) return 'bg-orange-500';
  return 'bg-red-500';
}

async function getLoadsForDay(vehicleIds: string[], dzien: string) {
  const loads = new Map<string, { kg: number; m3: number; palet: number }>();
  vehicleIds.forEach(id => loads.set(id, { kg: 0, m3: 0, palet: 0 }));

  if (vehicleIds.length === 0) return loads;

  const { data: kursy } = await supabase
    .from('kursy')
    .select('id, flota_id')
    .eq('dzien', dzien)
    .in('flota_id', vehicleIds);

  if (!kursy || kursy.length === 0) return loads;

  const kursIds = kursy.map(k => k.id);
  const kursFlota = new Map<string, string>();
  kursy.forEach(k => { if (k.flota_id) kursFlota.set(k.id, k.flota_id); });

  const { data: przystanki } = await supabase
    .from('kurs_przystanki')
    .select('zlecenie_id, kurs_id')
    .in('kurs_id', kursIds);

  const zids = (przystanki || []).filter(p => p.zlecenie_id).map(p => p.zlecenie_id as string);
  if (zids.length === 0) return loads;

  const { data: wz } = await supabase
    .from('zlecenia_wz')
    .select('zlecenie_id, masa_kg, objetosc_m3, ilosc_palet')
    .in('zlecenie_id', zids);

  (przystanki || []).forEach(p => {
    if (!p.zlecenie_id) return;
    const fid = kursFlota.get(p.kurs_id);
    if (!fid) return;
    const entry = loads.get(fid);
    if (!entry) return;
    const items = (wz || []).filter(w => w.zlecenie_id === p.zlecenie_id);
    items.forEach(w => {
      entry.kg += Number(w.masa_kg) || 0;
      entry.m3 += Number(w.objetosc_m3) || 0;
      entry.palet += Number(w.ilosc_palet) || 0;
    });
  });

  return loads;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function isWeekday(dateStr: string): boolean {
  const d = new Date(dateStr);
  return d.getDay() !== 0 && d.getDay() !== 6;
}

export function useSprawdzDostepnosc() {
  const [result, setResult] = useState<OccupancyResult>({
    vehicles: [], anyFits: false, loading: false,
    nextAvailable: null, searchingNext: false,
  });

  const check = useCallback(async (
    oddzialId: number, typPojazdu: string, dzien: string,
    newKg: number, newM3: number, newPalet: number,
  ) => {
    setResult(prev => ({ ...prev, loading: true, nextAvailable: null, searchingNext: false }));

    const isAny = !typPojazdu || typPojazdu === 'bez_preferencji' || typPojazdu === 'zewnetrzny';
    let query = supabase.from('flota')
      .select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
      .eq('oddzial_id', oddzialId).eq('aktywny', true);
    if (!isAny) query = query.eq('typ', typPojazdu);
    const { data: vehicles } = await query;

    if (!vehicles || vehicles.length === 0) {
      setResult({ vehicles: [], anyFits: false, loading: false, nextAvailable: null, searchingNext: false });
      return;
    }

    const vids = vehicles.map(v => v.id);
    const loads = await getLoadsForDay(vids, dzien);

    const occupancy: VehicleOccupancy[] = vehicles.map(v => {
      const used = loads.get(v.id) || { kg: 0, m3: 0, palet: 0 };
      const cap_kg = Number(v.ladownosc_kg) || 1;
      const cap_m3 = v.objetosc_m3 ? Number(v.objetosc_m3) : null;
      const cap_palet = v.max_palet ? Number(v.max_palet) : null;
      const pct_kg = Math.round(((used.kg + newKg) / cap_kg) * 100);
      const pct_m3 = cap_m3 ? Math.round(((used.m3 + newM3) / cap_m3) * 100) : 0;
      const pct_palet = cap_palet ? Math.round(((used.palet + newPalet) / cap_palet) * 100) : 0;
      const fits = pct_kg <= 100 && (!cap_m3 || pct_m3 <= 100) && (!cap_palet || pct_palet <= 100);
      return {
        flota_id: v.id, nr_rej: v.nr_rej, typ: v.typ,
        ladownosc_kg: cap_kg, objetosc_m3: cap_m3, max_palet: cap_palet,
        used_kg: used.kg + newKg, used_m3: used.m3 + newM3, used_palet: used.palet + newPalet,
        pct_kg, pct_m3, pct_palet, fits,
      };
    }).sort((a, b) => a.pct_kg - b.pct_kg);

    const anyFits = occupancy.some(v => v.fits);
    setResult({ vehicles: occupancy, anyFits, loading: false, nextAvailable: null, searchingNext: !anyFits });

    // If nothing fits, search next 14 working days
    if (!anyFits) {
      for (let i = 1; i <= 21; i++) {
        const day = addDays(dzien, i);
        if (!isWeekday(day)) continue;

        const dayLoads = await getLoadsForDay(vids, day);
        for (const v of vehicles) {
          const used = dayLoads.get(v.id) || { kg: 0, m3: 0, palet: 0 };
          const cap_kg = Number(v.ladownosc_kg) || 1;
          const cap_m3 = v.objetosc_m3 ? Number(v.objetosc_m3) : null;
          const cap_palet = v.max_palet ? Number(v.max_palet) : null;
          const pk = Math.round(((used.kg + newKg) / cap_kg) * 100);
          const pm = cap_m3 ? Math.round(((used.m3 + newM3) / cap_m3) * 100) : 0;
          const pp = cap_palet ? Math.round(((used.palet + newPalet) / cap_palet) * 100) : 0;
          if (pk <= 100 && (!cap_m3 || pm <= 100) && (!cap_palet || pp <= 100)) {
            setResult(prev => ({
              ...prev, searchingNext: false,
              nextAvailable: { dzien: day, nr_rej: v.nr_rej, typ: v.typ, pct_kg: pk, pct_m3: pm, pct_palet: pp },
            }));
            return;
          }
        }
      }
      setResult(prev => ({ ...prev, searchingNext: false }));
    }
  }, []);

  return { ...result, check };
}
