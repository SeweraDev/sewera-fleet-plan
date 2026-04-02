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
}

export interface SlotInfo {
  godzina: string;
  totalKg: number;
  totalPalet: number;
  zlecenCount: number;
}

export interface OccupancyResult {
  vehicles: VehicleOccupancy[];
  anyFits: boolean;
  loading: boolean;
  nextAvailable: NextAvailable | null;
  searchingNext: boolean;
  freeSlots: string[];
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

// Generuj dni robocze (pomijaj weekendy) od startDate + 1
function generateWorkdays(startDate: string, count: number): string[] {
  const days: string[] = [];
  const d = new Date(startDate);
  while (days.length < count) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

export function useSprawdzDostepnosc() {
  const [result, setResult] = useState<OccupancyResult>({ vehicles: [], anyFits: false, loading: false, nextAvailable: null, searchingNext: false, freeSlots: [] });

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

    // 2. Pobierz WSZYSTKIE zlecenia na ten dzień (przypisane + robocze bez kursu)
    const vehicleIds = vehicles.map(v => v.id);

    // 2a. Zlecenia przypisane do kursów (per pojazd)
    const { data: kursy } = await supabase
      .from('kursy')
      .select('id, flota_id')
      .eq('dzien', dzien)
      .in('flota_id', vehicleIds)
      .neq('status', 'usuniety');

    const kursIds = (kursy || []).map(k => k.id);
    const kursMap = new Map<string, string>(); // kurs_id → flota_id
    (kursy || []).forEach(k => { if (k.flota_id) kursMap.set(k.id, k.flota_id); });

    const vehicleLoads = new Map<string, { kg: number; m3: number; palet: number }>();
    vehicleIds.forEach(id => vehicleLoads.set(id, { kg: 0, m3: 0, palet: 0 }));

    if (kursIds.length > 0) {
      const { data: prz } = await supabase.from('kurs_przystanki').select('zlecenie_id, kurs_id').in('kurs_id', kursIds);
      const zlIds = (prz || []).filter(p => p.zlecenie_id).map(p => p.zlecenie_id!);
      if (zlIds.length > 0) {
        const { data: wz } = await supabase.from('zlecenia_wz').select('zlecenie_id, masa_kg, objetosc_m3, ilosc_palet').in('zlecenie_id', zlIds);
        (prz || []).forEach(p => {
          if (!p.zlecenie_id) return;
          const fid = kursMap.get(p.kurs_id);
          if (!fid) return;
          const entry = vehicleLoads.get(fid)!;
          (wz || []).filter(w => w.zlecenie_id === p.zlecenie_id).forEach(w => {
            entry.kg += Number(w.masa_kg) || 0;
            entry.m3 += Number(w.objetosc_m3) || 0;
            entry.palet += Number(w.ilosc_palet) || 0;
          });
        });
      }
    }

    // 2b. Nieprzypisane zlecenia (robocze/do_weryfikacji) na ten dzień — dodaj do ogólnego obciążenia
    // Te nie mają przypisanego pojazdu, więc obciążają WSZYSTKIE pojazdy danego typu równomiernie
    const { data: unassigned } = await supabase
      .from('zlecenia')
      .select('id, typ_pojazdu')
      .eq('oddzial_id', oddzialId)
      .eq('dzien', dzien)
      .in('status', ['robocza', 'do_weryfikacji']);

    const unassignedIds = (unassigned || []).map(z => z.id);
    let unassignedLoad = { kg: 0, m3: 0, palet: 0 };
    if (unassignedIds.length > 0) {
      const { data: uwz } = await supabase.from('zlecenia_wz').select('masa_kg, objetosc_m3, ilosc_palet').in('zlecenie_id', unassignedIds);
      (uwz || []).forEach(w => {
        unassignedLoad.kg += Number(w.masa_kg) || 0;
        unassignedLoad.m3 += Number(w.objetosc_m3) || 0;
        unassignedLoad.palet += Number(w.ilosc_palet) || 0;
      });
    }

    // 4b. Sprawdź wolne przedziały — policz obciążenie per slot
    const ALL_SLOTS = ['do 8:00', 'do 10:00', 'do 12:00', 'do 14:00', 'do 16:00'];
    const slotLoad = new Map<string, { kg: number; palet: number }>();
    ALL_SLOTS.forEach(s => slotLoad.set(s, { kg: 0, palet: 0 }));
    (unassigned || []).forEach(z => {
      const slot = (z as any).preferowana_godzina || 'dowolna';
      if (slotLoad.has(slot)) {
        // Obciążenie tego slotu = suma WZ tego zlecenia
        const wzForZl = unassignedIds.includes(z.id) ? true : false;
      }
    });
    // Pobierz obciążenie per slot z unassigned zleceń
    if (unassignedIds.length > 0) {
      const { data: uzlFull } = await supabase
        .from('zlecenia')
        .select('id, preferowana_godzina')
        .in('id', unassignedIds);
      const { data: uwzFull } = await supabase
        .from('zlecenia_wz')
        .select('zlecenie_id, masa_kg, ilosc_palet')
        .in('zlecenie_id', unassignedIds);
      (uzlFull || []).forEach(z => {
        const slot = z.preferowana_godzina || 'dowolna';
        const entry = slotLoad.get(slot) || { kg: 0, palet: 0 };
        (uwzFull || []).filter(w => w.zlecenie_id === z.id).forEach(w => {
          entry.kg += Number(w.masa_kg) || 0;
          entry.palet += Number(w.ilosc_palet) || 0;
        });
        slotLoad.set(slot, entry);
      });
    }
    // Wolne sloty: te gdzie zmieści się nowe zlecenie (per najlepszy pojazd)
    const bestVehicle = vehicles.reduce((best, v) => (Number(v.ladownosc_kg) > Number(best.ladownosc_kg) ? v : best), vehicles[0]);
    const bestCap = { kg: Number(bestVehicle.ladownosc_kg) || 1, palet: bestVehicle.max_palet ? Number(bestVehicle.max_palet) : null };
    const freeSlots = ALL_SLOTS.filter(slot => {
      const load = slotLoad.get(slot) || { kg: 0, palet: 0 };
      const fitKg = (load.kg + newKg) <= bestCap.kg;
      const fitPal = !bestCap.palet || (load.palet + newPalet) <= bestCap.palet;
      return fitKg && fitPal;
    });

    // 5. Build result — dodaj obciążenie z nieprzypisanych zleceń (rozłóż na pojazdy)
    const numVehicles = vehicles.length || 1;
    const occupancy: VehicleOccupancy[] = vehicles.map(v => {
      const assigned = vehicleLoads.get(v.id) || { kg: 0, m3: 0, palet: 0 };
      // Nieprzypisane obciążenie: najgorszy scenariusz — cały ładunek trafia na ten pojazd
      const used = {
        kg: assigned.kg + unassignedLoad.kg,
        m3: assigned.m3 + unassignedLoad.m3,
        palet: assigned.palet + unassignedLoad.palet,
      };
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

    const anyFits = occupancy.some(v => v.fits);
    setResult({
      vehicles: occupancy,
      anyFits,
      loading: false,
      nextAvailable: null,
      searchingNext: !anyFits,
      freeSlots,
    });

    // Jeśli nic nie pasuje — szukaj następnego wolnego terminu w tle
    if (!anyFits) {
      findNextAvailable(oddzialId, typPojazdu, dzien, newKg, newM3, newPalet);
    }
  }, []);

  const findNextAvailable = useCallback(async (
    oddzialId: number, typPojazdu: string, startDzien: string,
    newKg: number, newM3: number, newPalet: number,
  ) => {
    const days = generateWorkdays(startDzien, 14);
    const isAny = !typPojazdu || typPojazdu === 'bez_preferencji' || typPojazdu === 'zewnetrzny';

    // Pobierz pojazdy (raz)
    let vQuery = supabase.from('flota').select('id, nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
      .eq('oddzial_id', oddzialId).eq('aktywny', true);
    if (!isAny) vQuery = vQuery.eq('typ', typPojazdu);
    const { data: vehicles } = await vQuery;
    if (!vehicles?.length) { setResult(prev => ({ ...prev, searchingNext: false })); return; }

    const vehicleIds = vehicles.map(v => v.id);

    for (const day of days) {
      // Pobierz kursy tego dnia
      const { data: kursy } = await supabase.from('kursy').select('id, flota_id').eq('dzien', day).in('flota_id', vehicleIds).neq('status', 'usuniety');
      const kursIds = (kursy || []).map(k => k.id);

      // Pobierz obciążenia
      const vehicleLoads = new Map<string, { kg: number; m3: number; palet: number }>();
      vehicleIds.forEach(id => vehicleLoads.set(id, { kg: 0, m3: 0, palet: 0 }));

      if (kursIds.length > 0) {
        const kursFlotaMap = new Map<string, string>();
        (kursy || []).forEach(k => { if (k.flota_id) kursFlotaMap.set(k.id, k.flota_id); });

        const { data: prz } = await supabase.from('kurs_przystanki').select('zlecenie_id, kurs_id').in('kurs_id', kursIds);
        const zlIds = (prz || []).filter(p => p.zlecenie_id).map(p => p.zlecenie_id!);

        if (zlIds.length > 0) {
          const { data: wz } = await supabase.from('zlecenia_wz').select('zlecenie_id, masa_kg, objetosc_m3, ilosc_palet').in('zlecenie_id', zlIds);
          (prz || []).forEach(p => {
            if (!p.zlecenie_id) return;
            const fid = kursFlotaMap.get(p.kurs_id);
            if (!fid) return;
            const loads = (wz || []).filter(w => w.zlecenie_id === p.zlecenie_id);
            const entry = vehicleLoads.get(fid)!;
            loads.forEach(l => { entry.kg += Number(l.masa_kg) || 0; entry.m3 += Number(l.objetosc_m3) || 0; entry.palet += Number(l.ilosc_palet) || 0; });
          });
        }
      }

      // Sprawdź czy któryś pojazd pasuje
      for (const v of vehicles) {
        const used = vehicleLoads.get(v.id) || { kg: 0, m3: 0, palet: 0 };
        const capKg = Number(v.ladownosc_kg) || 1;
        const capM3 = Number(v.objetosc_m3) || null;
        const capPal = v.max_palet ? Number(v.max_palet) : null;
        const pctKg = Math.round(((used.kg + newKg) / capKg) * 100);
        const pctM3 = capM3 ? Math.round(((used.m3 + newM3) / capM3) * 100) : 0;
        const pctPal = capPal ? Math.round(((used.palet + newPalet) / capPal) * 100) : 0;
        const fits = pctKg <= 100 && (!capM3 || pctM3 <= 100) && (!capPal || pctPal <= 100);

        if (fits) {
          setResult(prev => ({
            ...prev,
            searchingNext: false,
            nextAvailable: { dzien: day, nr_rej: v.nr_rej, typ: v.typ, pct_kg: pctKg },
          }));
          return;
        }
      }
    }

    // Nie znaleziono w 14 dniach
    setResult(prev => ({ ...prev, searchingNext: false }));
  }, []);

  return { ...result, check };
}
