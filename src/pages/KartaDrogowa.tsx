import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { geocodeAddress, getKmProstaFromOddzial, ODDZIAL_COORDS, NAZWA_TO_KOD } from '@/lib/oddzialy-geo';
import { useAuth } from '@/hooks/useAuth';

interface KursFull {
  id: string;
  numer: string | null;
  dzien: string;
  status: string;
  nr_rej: string;
  pojazd_typ: string;
  ladownosc_kg: number;
  max_palet: number | null;
  objetosc_m3: number | null;
  kierowca_nazwa: string | null;
  kierowca_tel: string | null;
  godzina_start: string | null;
  oddzial_nazwa: string;
  oddzial_adres: string;
}

interface PrzystanekFull {
  id: string;
  kolejnosc: number;
  zl_numer: string;
  odbiorca: string;
  adres: string;
  masa_kg: number;
  objetosc_m3: number;
  ilosc_palet: number;
  numer_wz: string;
  nr_zamowienia: string;
  tel: string;
  uwagi: string;
  preferowana_godzina: string;
  km_prosta: number | null;
  klasyfikacja: string | null;
}

export default function KartaDrogowa() {
  const { kursId } = useParams<{ kursId: string }>();
  const { profile } = useAuth();
  const [kurs, setKurs] = useState<KursFull | null>(null);
  const [przystanki, setPrzystanki] = useState<PrzystanekFull[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!kursId) return;

    (async () => {
      setLoading(true);

      // 1. Pobierz kurs
      const { data: k } = await supabase
        .from('kursy')
        .select('id, numer, dzien, status, nr_rej_zewn, flota_id, kierowca_id, kierowca_nazwa, godzina_start, oddzial_id')
        .eq('id', kursId)
        .maybeSingle();

      if (!k) { setLoading(false); return; }

      // 2. Flota (wlasna lub zewnętrzna)
      let nr_rej = k.nr_rej_zewn || '';
      let pojazd_typ = '';
      let ladownosc_kg = 0;
      let max_palet: number | null = null;
      let objetosc_m3: number | null = null;

      if ((k as any).flota_id) {
        const { data: f } = await supabase
          .from('flota')
          .select('nr_rej, typ, ladownosc_kg, objetosc_m3, max_palet')
          .eq('id', (k as any).flota_id)
          .maybeSingle();
        if (f) {
          nr_rej = f.nr_rej;
          pojazd_typ = f.typ;
          ladownosc_kg = Number(f.ladownosc_kg);
          max_palet = (f as any).max_palet != null ? Number((f as any).max_palet) : null;
          objetosc_m3 = f.objetosc_m3 != null ? Number(f.objetosc_m3) : null;
        }
      } else if (k.nr_rej_zewn) {
        const { data: fz } = await supabase
          .from('flota_zewnetrzna')
          .select('typ, ladownosc_kg, objetosc_m3, max_palet')
          .eq('nr_rej', k.nr_rej_zewn)
          .maybeSingle();
        if (fz) {
          pojazd_typ = fz.typ;
          ladownosc_kg = Number(fz.ladownosc_kg);
          max_palet = (fz as any).max_palet != null ? Number((fz as any).max_palet) : null;
          objetosc_m3 = fz.objetosc_m3 != null ? Number(fz.objetosc_m3) : null;
        }
      }

      // 3. Kierowca tel
      let kierowca_tel: string | null = null;
      if (k.kierowca_id) {
        const { data: kier } = await supabase
          .from('kierowcy')
          .select('tel')
          .eq('id', k.kierowca_id)
          .maybeSingle();
        kierowca_tel = kier?.tel || null;
      }

      // 4. Oddział
      const { data: od } = await supabase
        .from('oddzialy')
        .select('nazwa')
        .eq('id', (k as any).oddzial_id)
        .maybeSingle();
      const oddzial_nazwa = (od as any)?.nazwa || '';
      const oddzialKod = NAZWA_TO_KOD[oddzial_nazwa] || '';
      const oddzial_adres = ODDZIAL_COORDS[oddzialKod]?.adres || oddzial_nazwa;

      setKurs({
        id: k.id,
        numer: (k as any).numer,
        dzien: k.dzien,
        status: k.status,
        nr_rej,
        pojazd_typ,
        ladownosc_kg,
        max_palet,
        objetosc_m3,
        kierowca_nazwa: k.kierowca_nazwa,
        kierowca_tel,
        godzina_start: (k as any).godzina_start,
        oddzial_nazwa,
        oddzial_adres,
      });

      // 5. Przystanki
      const { data: przData } = await supabase
        .from('kurs_przystanki')
        .select('id, kolejnosc, zlecenie_id')
        .eq('kurs_id', kursId)
        .order('kolejnosc');

      const zlecenieIds = (przData || []).map(p => p.zlecenie_id).filter(Boolean) as string[];
      const zlecMap = new Map<string, { numer: string; preferowana_godzina: string | null }>();
      const wzListMap = new Map<string, any[]>();

      if (zlecenieIds.length > 0) {
        const { data: zlData } = await supabase
          .from('zlecenia')
          .select('id, numer, preferowana_godzina')
          .in('id', zlecenieIds);
        (zlData || []).forEach(z => zlecMap.set(z.id, { numer: z.numer, preferowana_godzina: z.preferowana_godzina }));

        const { data: wzData } = await supabase
          .from('zlecenia_wz')
          .select('zlecenie_id, odbiorca, adres, masa_kg, objetosc_m3, ilosc_palet, numer_wz, nr_zamowienia, tel, uwagi, klasyfikacja')
          .in('zlecenie_id', zlecenieIds);
        (wzData || []).forEach(w => {
          const list = wzListMap.get(w.zlecenie_id) || [];
          list.push(w);
          wzListMap.set(w.zlecenie_id, list);
        });
      }

      const expanded: PrzystanekFull[] = [];
      (przData || []).forEach(p => {
        const zl = zlecMap.get(p.zlecenie_id || '');
        const wzList = wzListMap.get(p.zlecenie_id || '') || [];
        if (wzList.length === 0) {
          expanded.push({
            id: p.id, kolejnosc: p.kolejnosc, zl_numer: zl?.numer || '',
            odbiorca: '', adres: '', masa_kg: 0, objetosc_m3: 0, ilosc_palet: 0,
            numer_wz: '', nr_zamowienia: '', tel: '', uwagi: '',
            preferowana_godzina: zl?.preferowana_godzina || '',
            km_prosta: null,
            klasyfikacja: null,
          });
        } else {
          wzList.forEach((w: any, i) => {
            expanded.push({
              id: `${p.id}_wz${i}`,
              kolejnosc: p.kolejnosc,
              zl_numer: zl?.numer || '',
              odbiorca: w.odbiorca || '',
              adres: w.adres || '',
              masa_kg: Number(w.masa_kg) || 0,
              objetosc_m3: Number(w.objetosc_m3) || 0,
              ilosc_palet: Number(w.ilosc_palet) || 0,
              numer_wz: w.numer_wz || '',
              nr_zamowienia: w.nr_zamowienia || '',
              tel: w.tel || '',
              uwagi: w.uwagi || '',
              preferowana_godzina: zl?.preferowana_godzina || '',
              km_prosta: null,
              klasyfikacja: w.klasyfikacja || null,
            });
          });
        }
      });

      setPrzystanki(expanded);
      setLoading(false);

      // 6. Km prosta w tle (geocoding Photon)
      if (oddzial_nazwa) {
        const uniqAdresy = Array.from(new Set(expanded.map(p => p.adres).filter(a => a.length > 4)));
        const coords = new Map<string, { lat: number; lng: number } | null>();
        for (const a of uniqAdresy) coords.set(a, await geocodeAddress(a));
        setPrzystanki(prev => prev.map(p => {
          if (!p.adres || p.km_prosta != null) return p;
          const c = coords.get(p.adres);
          if (!c) return p;
          const km = getKmProstaFromOddzial(oddzial_nazwa, c.lat, c.lng);
          return km != null ? { ...p, km_prosta: km } : p;
        }));
      }
    })();
  }, [kursId]);

  if (loading) return <div className="p-6 text-center">Ładowanie karty drogowej…</div>;
  if (!kurs) return <div className="p-6 text-center text-destructive">Nie znaleziono kursu</div>;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  };

  return (
    <div className="karta-drogowa">
      {/* Toolbar widoczny tylko na ekranie, nie na wydruku */}
      <div className="no-print bg-muted border-b p-3 flex gap-2 items-center justify-between sticky top-0 z-10">
        <Link to="/dyspozytor" className="text-sm text-muted-foreground hover:underline">← Wróć do kursów</Link>
        <div className="flex gap-2">
          <Button onClick={() => window.print()}>🖨️ Drukuj / Zapisz PDF</Button>
        </div>
      </div>

      {/* Treść karty */}
      <div className="print-page p-6 max-w-[297mm] mx-auto text-[10pt]">
        <div className="flex justify-between items-start mb-3 border-b-2 border-black pb-2">
          <div>
            <h1 className="text-xl font-bold">KARTA DROGOWA</h1>
            <div className="text-xs text-muted-foreground">Sewera Polska Chemia — {kurs.oddzial_nazwa}</div>
          </div>
          <div className="text-right">
            <div className="font-mono font-bold">{kurs.numer || '—'}</div>
            <div>Data: <strong>{formatDate(kurs.dzien)}</strong></div>
          </div>
        </div>

        <table className="w-full mb-3 border-collapse karta-info">
          <tbody>
            <tr>
              <td className="font-semibold">Pojazd (nr rej.):</td>
              <td className="font-mono">{kurs.nr_rej}</td>
              <td className="font-semibold">Typ pojazdu:</td>
              <td>{kurs.pojazd_typ}</td>
            </tr>
            <tr>
              <td className="font-semibold">Kierowca:</td>
              <td>{kurs.kierowca_nazwa || '—'}</td>
              <td className="font-semibold">Telefon:</td>
              <td>{kurs.kierowca_tel || '—'}</td>
            </tr>
            <tr>
              <td className="font-semibold">Baza (wyjazd):</td>
              <td colSpan={3}>{kurs.oddzial_adres}</td>
            </tr>
            <tr>
              <td className="font-semibold">Dyspozytor:</td>
              <td>{profile?.full_name || '—'}</td>
              <td className="font-semibold">Ładowność:</td>
              <td>{kurs.ladownosc_kg} kg{kurs.max_palet ? ` · ${kurs.max_palet} pal` : ''}</td>
            </tr>
          </tbody>
        </table>

        {/* Km bazowe — wyjazd i powrót */}
        <div className="flex gap-4 mb-3 border border-black p-2 bg-gray-50">
          <div className="flex-1">
            <div className="text-xs font-semibold">Km licznika — wyjazd z bazy:</div>
            <div className="border-b border-black h-6 mt-1"></div>
          </div>
          <div className="flex-1">
            <div className="text-xs font-semibold">Km licznika — powrót do bazy:</div>
            <div className="border-b border-black h-6 mt-1"></div>
          </div>
          <div className="flex-1">
            <div className="text-xs font-semibold">Łączny przejazd (km):</div>
            <div className="border-b border-black h-6 mt-1"></div>
          </div>
        </div>

        {/* Tabela przystanków */}
        <table className="w-full border-collapse karta-table">
          <thead>
            <tr className="bg-gray-200">
              <th className="w-8">#</th>
              <th className="w-20">Godzina</th>
              <th>Odbiorca</th>
              <th className="w-32">Nr WZ / Nr zam.</th>
              <th>Adres</th>
              <th className="w-20">Linia prosta (km)</th>
              <th className="w-14">Klasyf.</th>
              <th className="w-20">Km dojazd</th>
              <th className="w-20">Km wyjazd</th>
              <th className="w-12">Kg</th>
              <th className="w-10">Pal</th>
              <th className="w-24">Telefon</th>
              <th className="col-uwagi">Uwagi</th>
            </tr>
          </thead>
          <tbody>
            {przystanki.map((p) => (
              <tr key={p.id}>
                <td className="text-center">{p.kolejnosc}</td>
                <td>{p.preferowana_godzina || '—'}</td>
                <td className="truncate-cell">{p.odbiorca}</td>
                <td className="font-mono text-[9pt]">
                  {p.numer_wz || p.zl_numer}
                  {p.nr_zamowienia && <div className="text-[8pt] text-muted-foreground">{p.nr_zamowienia}</div>}
                </td>
                <td>{p.adres}</td>
                <td className="text-right">
                  {p.km_prosta != null ? p.km_prosta.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : ''}
                </td>
                <td className="text-center font-mono font-semibold">{p.klasyfikacja || ''}</td>
                <td className="fill-cell"></td>
                <td className="fill-cell"></td>
                <td className="text-right">{Math.round(p.masa_kg)}</td>
                <td className="text-right">{p.ilosc_palet || ''}</td>
                <td className="text-[9pt]">{p.tel}</td>
                <td className="cell-uwagi">{p.uwagi}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-[8pt] text-muted-foreground mt-4 text-center">
          Wydrukowano: {new Date().toLocaleString('pl-PL')}
        </div>
      </div>

      {/* Style wydruku */}
      <style>{`
        .karta-info td { border: 1px solid #000; padding: 3px 6px; font-size: 10pt; }
        .karta-table { table-layout: auto; }
        .karta-table th, .karta-table td { border: 1px solid #000; padding: 3px 4px; font-size: 9pt; vertical-align: top; }
        .karta-table th { font-weight: 600; text-align: left; }
        .karta-table .fill-cell { height: 28px; background: white; }
        .karta-table .col-uwagi { min-width: 220px; width: 260px; }
        .karta-table .cell-uwagi {
          font-size: 9pt;
          white-space: pre-wrap;
          word-break: break-word;
          min-height: 40px;
        }
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 10mm; }
          body { margin: 0; background: white; }
          .print-page { padding: 0 !important; max-width: none !important; }
          .karta-table .fill-cell { background: white; }
          .karta-table .col-uwagi { min-width: 60mm; width: 70mm; }
        }
      `}</style>
    </div>
  );
}
