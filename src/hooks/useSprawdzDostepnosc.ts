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

export interface OccupancyResult {
  vehicles: VehicleOccupancy[];
  anyFits: boolean;
  loading: boolean;
}

function pctColor(pct: number): string {
  if (pct <= 40) return 'text-green-600 dark:text-green-400';
  if (pct <= 70) return 'text-yellow-600 dark:text-yellow-400';
  if (pct <= 95) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function pctBg(pct: number): string {
  if (pct <= 40) return 'bg-green-500';
  if (pct <= 70) return 'bg-yellow-500';
  if (pct <= 95) return 'bg-orange-500';
  return 'bg-red-500';
}

export { pctColor, pctBg };

export function useSprawdzDostepnosc() {
  const [result, setResult] = useState<OccupancyResult>({ vehicles: [], anyFits: false, loading: false });

  const check = useCallback(async (
    oddzialId: number,
    typPojazdu: string,
    dzien: string,
    newKg: number,
    newM3: number,
    newPalet: number,
  ) => {
    setResult(prev => ({ ...prev, loading: true }));

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
      setResult({ vehicles: [], anyFits: false, loading: false });
      return;
    }

    // 2. Get existing kursy for that day + their loads
    const vehicleIds = vehicles.map(v => v.id);
    const { data: kursy } = await supabase
      .from('kursy')
      .select('id, flota_id')
      .eq('dzien', dzien)
      .in('flota_id', vehicleIds);

    // 3. For each kurs, get zlecenia loads via kurs_przystanki → zlecenia → zlecenia_wz
    const kursIds = (kursy || []).map(k => k.id);
    let wzLoads: { zlecenie_id: string; masa_kg: number; objetosc_m3: number; ilosc_palet: number }[] = [];

    if (kursIds.length > 0) {
      const { data: przystanki } = await supabase
        .from('kurs_przystanki')
        .select('zlecenie_id, kurs_id')
        .in('kurs_id', kursIds);

      const zlecenieIds = (przystanki || []).filter(p => p.zlecenie_id).map(p => p.zlecenie_id!);
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
    }

    // 4. Aggregate loads per vehicle
    const kursMap = new Map<string, string>(); // kurs_id → flota_id
    (kursy || []).forEach(k => { if (k.flota_id) kursMap.set(k.id, k.flota_id); });

    const vehicleLoads = new Map<string, { kg: number; m3: number; palet: number }>();
    vehicleIds.forEach(id => vehicleLoads.set(id, { kg: 0, m3: 0, palet: 0 }));

    if (kursIds.length > 0) {
      const { data: przystanki } = await supabase
        .from('kurs_przystanki')
        .select('zlecenie_id, kurs_id')
        .in('kurs_id', kursIds);

      (przystanki || []).forEach(p => {
        if (!p.zlecenie_id) return;
        const flotaId = kursMap.get(p.kurs_id);
        if (!flotaId) return;
        const loads = wzLoads.filter(w => w.zlecenie_id === p.zlecenie_id);
        const entry = vehicleLoads.get(flotaId)!;
        loads.forEach(l => {
          entry.kg += l.masa_kg;
          entry.m3 += l.objetosc_m3;
          entry.palet += l.ilosc_palet;
        });
      });
    }

    // 5. Build result
    const occupancy: VehicleOccupancy[] = vehicles.map(v => {
      const used = vehicleLoads.get(v.id) || { kg: 0, m3: 0, palet: 0 };
      const afterKg = used.kg + newKg;
      const afterM3 = used.m3 + newM3;
      const afterPalet = used.palet + newPalet;

      const cap_kg = Number(v.ladownosc_kg) || 1;
      const cap_m3 = Number(v.objetosc_m3) || null;
      const cap_palet = v.max_palet || null;

      const pct_kg = Math.round((afterKg / cap_kg) * 100);
      const pct_m3 = cap_m3 ? Math.round((afterM3 / cap_m3) * 100) : 0;
      const pct_palet = cap_palet ? Math.round((afterPalet / cap_palet) * 100) : 0;

      // Fits if no dimension exceeds 100%
      const fits = pct_kg <= 100
        && (!cap_m3 || pct_m3 <= 100)
        && (!cap_palet || pct_palet <= 100);

      return {
        flota_id: v.id,
        nr_rej: v.nr_rej,
        typ: v.typ,
        ladownosc_kg: cap_kg,
        objetosc_m3: cap_m3,
        max_palet: cap_palet,
        used_kg: afterKg,
        used_m3: afterM3,
        used_palet: afterPalet,
        pct_kg,
        pct_m3,
        pct_palet,
        fits,
      };
    });

    occupancy.sort((a, b) => a.pct_kg - b.pct_kg);

    setResult({
      vehicles: occupancy,
      anyFits: occupancy.some(v => v.fits),
      loading: false,
    });
  }, []);

  return { ...result, check };
}
