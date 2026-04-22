import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { ModalImportWZ, type WZImportData } from '@/components/shared/ModalImportWZ';
import { generateNumerZlecenia } from '@/lib/generateNumerZlecenia';
import { PrzekazDoOddzialuModal } from '@/components/dyspozytor/PrzekazDoOddzialuModal';
import { KLASYFIKACJE } from '@/lib/klasyfikacje';

const STATUSY = [
  { value: 'robocza', label: 'Robocza' },
  { value: 'potwierdzona', label: 'Potwierdzona' },
  { value: 'w_trasie', label: 'W trasie' },
  { value: 'dostarczona', label: 'Dostarczona' },
  { value: 'anulowana', label: 'Anulowana' },
  { value: 'do_weryfikacji', label: 'Do weryfikacji' },
];

const GODZINY = [
  { value: 'do 8:00', label: 'do 8:00' },
  { value: 'do 10:00', label: 'do 10:00' },
  { value: 'do 12:00', label: 'do 12:00' },
  { value: 'do 14:00', label: 'do 14:00' },
  { value: 'do 16:00', label: 'do 16:00' },
  { value: 'dowolna', label: 'Dowolna' },
];

interface Props {
  zlecenieId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const TYPY_POJAZDOW = [
  'Dostawczy 1,2t', 'Winda 1,8t', 'Winda 6,3t', 'Winda MAX 15,8t',
  'HDS 9,0t', 'HDS 12,0t',
];

interface ZlData {
  numer: string;
  status: string;
  dzien: string;
  preferowana_godzina: string | null;
  typ_pojazdu: string | null;
  nadawca_id: string | null;
  oddzial_id: number | null;
}

interface WzData {
  id: string;
  odbiorca: string;
  adres: string;
  tel: string;
  masa_kg: number;
  objetosc_m3: number;
  ilosc_palet: number;
  uwagi: string;
  numer_wz: string;
  nr_zamowienia: string;
  klasyfikacja: string;
}

export function EdytujZlecenieModal({ zlecenieId, open, onClose, onSaved }: Props) {
  const [zlecenie, setZlecenie] = useState<ZlData | null>(null);
  const [wzList, setWzList] = useState<WzData[]>([]);
  const [status, setStatus] = useState('');
  const [dzien, setDzien] = useState('');
  const [godzina, setGodzina] = useState('');
  const [typPojazdu, setTypPojazdu] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nadawcaNazwa, setNadawcaNazwa] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showResztaChoice, setShowResztaChoice] = useState(false);
  const [showPrzekaz, setShowPrzekaz] = useState(false);
  const originalWzRef = useRef<WzData[]>([]);

  // Pojemność pojazdu z kursu
  const [capacity, setCapacity] = useState<{ kg: number; m3: number; pal: number }>({ kg: 0, m3: 0, pal: 0 });
  const [otherLoad, setOtherLoad] = useState<{ kg: number; m3: number; pal: number }>({ kg: 0, m3: 0, pal: 0 });

  useEffect(() => {
    if (!open || !zlecenieId) return;
    setLoading(true);

    Promise.all([
      supabase.from('zlecenia').select('numer, status, dzien, preferowana_godzina, typ_pojazdu, nadawca_id, oddzial_id').eq('id', zlecenieId).single(),
      supabase.from('zlecenia_wz').select('id, odbiorca, adres, tel, masa_kg, objetosc_m3, ilosc_palet, uwagi, numer_wz, nr_zamowienia, klasyfikacja').eq('zlecenie_id', zlecenieId),
    ]).then(async ([zlRes, wzRes]) => {
      const zl = zlRes.data;
      if (zl) {
        setZlecenie(zl as ZlData);
        setStatus(zl.status);
        setDzien(zl.dzien || '');
        setGodzina(zl.preferowana_godzina || 'dowolna');
        setTypPojazdu(zl.typ_pojazdu || 'brak');
        if (zl.nadawca_id) {
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', zl.nadawca_id).single();
          setNadawcaNazwa(prof?.full_name || '—');
        } else {
          setNadawcaNazwa('—');
        }
      }
      const wzData = (wzRes.data || []).map((w: any) => ({
        id: w.id,
        odbiorca: w.odbiorca || '',
        adres: w.adres || '',
        tel: w.tel || '',
        masa_kg: Number(w.masa_kg) || 0,
        objetosc_m3: Number(w.objetosc_m3) || 0,
        ilosc_palet: Number(w.ilosc_palet) || 0,
        uwagi: w.uwagi || '',
        numer_wz: w.numer_wz || '',
        nr_zamowienia: w.nr_zamowienia || '',
        klasyfikacja: w.klasyfikacja || '',
      }));
      setWzList(wzData);
      originalWzRef.current = wzData.map(w => ({ ...w }));
      setLoading(false);
    });
  }, [open, zlecenieId]);

  // Pobierz pojemność pojazdu i obciążenie innych zleceń w kursie
  useEffect(() => {
    if (!open || !zlecenieId) return;
    setCapacity({ kg: 0, m3: 0, pal: 0 });
    setOtherLoad({ kg: 0, m3: 0, pal: 0 });

    (async () => {
      // 1. Znajdź kurs_id z kurs_przystanki
      const { data: przystanki } = await supabase
        .from('kurs_przystanki')
        .select('kurs_id')
        .eq('zlecenie_id', zlecenieId)
        .limit(1);
      const kursId = przystanki?.[0]?.kurs_id;
      if (!kursId) return; // Zlecenie nie jest w kursie

      // 2. Pobierz kurs z flotem
      const { data: kurs } = await supabase
        .from('kursy')
        .select('flota_id, nr_rej_zewn')
        .eq('id', kursId)
        .single();
      if (!kurs) return;

      // 3. Pojemność z floty wewnętrznej lub zewnętrznej
      let cap = { kg: 0, m3: 0, pal: 0 };
      if (kurs.flota_id) {
        const { data: f } = await supabase
          .from('flota')
          .select('ladownosc_kg, objetosc_m3, max_palet')
          .eq('id', kurs.flota_id)
          .single();
        if (f) cap = { kg: Number(f.ladownosc_kg) || 0, m3: Number(f.objetosc_m3) || 0, pal: Number(f.max_palet) || 0 };
      } else if (kurs.nr_rej_zewn) {
        const { data: fz } = await supabase
          .from('flota_zewnetrzna')
          .select('ladownosc_kg, objetosc_m3, max_palet')
          .eq('nr_rej', kurs.nr_rej_zewn)
          .single();
        if (fz) cap = { kg: Number(fz.ladownosc_kg) || 0, m3: Number(fz.objetosc_m3) || 0, pal: Number(fz.max_palet) || 0 };
      }
      setCapacity(cap);

      // 4. Obciążenie INNYCH zleceń w tym kursie (bez bieżącego)
      // kurs_przystanki nie ma kg/m3/pal — trzeba pobrać z zlecenia_wz
      const { data: allPrz } = await supabase
        .from('kurs_przystanki')
        .select('zlecenie_id')
        .eq('kurs_id', kursId);
      if (allPrz) {
        const otherZlIds = allPrz
          .map(p => p.zlecenie_id)
          .filter((id): id is string => !!id && id !== zlecenieId);
        const uniqueOtherIds = [...new Set(otherZlIds)];
        if (uniqueOtherIds.length > 0) {
          const { data: otherWz } = await supabase
            .from('zlecenia_wz')
            .select('masa_kg, objetosc_m3, ilosc_palet')
            .in('zlecenie_id', uniqueOtherIds);
          if (otherWz) {
            const other = otherWz.reduce((acc, w) => ({
              kg: acc.kg + (Number(w.masa_kg) || 0),
              m3: acc.m3 + (Number(w.objetosc_m3) || 0),
              pal: acc.pal + (Number(w.ilosc_palet) || 0),
            }), { kg: 0, m3: 0, pal: 0 });
            setOtherLoad(other);
          }
        }
      }
    })();
  }, [open, zlecenieId]);

  // Oblicz przekroczenie na bieżąco
  const editedLoad = useMemo(() => wzList.reduce(
    (acc, w) => ({ kg: acc.kg + (Number(w.masa_kg) || 0), m3: acc.m3 + (Number(w.objetosc_m3) || 0), pal: acc.pal + (Number(w.ilosc_palet) || 0) }),
    { kg: 0, m3: 0, pal: 0 }
  ), [wzList]);

  const totalLoad = useMemo(() => ({
    kg: otherLoad.kg + editedLoad.kg,
    m3: otherLoad.m3 + editedLoad.m3,
    pal: otherLoad.pal + editedLoad.pal,
  }), [otherLoad, editedLoad]);

  const overKg = capacity.kg > 0 && totalLoad.kg > capacity.kg;
  const overM3 = capacity.m3 > 0 && totalLoad.m3 > capacity.m3;
  const overPal = capacity.pal > 0 && totalLoad.pal > capacity.pal;
  const isOverloaded = overKg || overM3 || overPal;

  const updateWz = (idx: number, field: keyof WzData, value: string | number) => {
    setWzList(prev => prev.map((w, i) => i === idx ? { ...w, [field]: value } : w));
  };

  const handleImportWz = useCallback((data: WZImportData[]) => {
    if (data.length > 0) {
      const d = data[0];
      // Wypełnij pierwszy WZ importowanymi danymi
      if (wzList.length > 0) {
        const updated = { ...wzList[0] };
        if (d.odbiorca) updated.odbiorca = d.odbiorca;
        if (d.adres) updated.adres = d.adres;
        if (d.tel) updated.tel = d.tel;
        if (d.masa_kg) updated.masa_kg = d.masa_kg;
        if (d.ilosc_palet) updated.ilosc_palet = d.ilosc_palet;
        if (d.objetosc_m3) updated.objetosc_m3 = d.objetosc_m3;
        if (d.uwagi) updated.uwagi = d.uwagi;
        setWzList(prev => [updated, ...prev.slice(1)]);
      }
    }
  }, [wzList]);

  // Oblicz reszty (różnice po zmniejszeniu)
  const computeReszty = () => {
    const reszty: { odbiorca: string; adres: string; tel: string; masa_kg: number; objetosc_m3: number; ilosc_palet: number; uwagi: string; numer_wz: string; nr_zamowienia: string; klasyfikacja: string }[] = [];
    for (const w of wzList) {
      const orig = originalWzRef.current.find(o => o.id === w.id);
      if (!orig) continue;
      const diffKg = orig.masa_kg - w.masa_kg;
      const diffM3 = orig.objetosc_m3 - w.objetosc_m3;
      const diffPal = orig.ilosc_palet - w.ilosc_palet;
      if (diffKg > 0 || diffM3 > 0 || diffPal > 0) {
        reszty.push({
          odbiorca: w.odbiorca, adres: w.adres, tel: w.tel,
          masa_kg: Math.max(0, diffKg), objetosc_m3: Math.max(0, diffM3), ilosc_palet: Math.max(0, diffPal),
          uwagi: 'Reszta z ' + (zlecenie?.numer || ''), numer_wz: w.numer_wz, nr_zamowienia: w.nr_zamowienia,
          klasyfikacja: w.klasyfikacja || '',
        });
      }
    }
    return reszty;
  };

  const handleSave = async (createReszta: boolean) => {
    if (!zlecenieId) return;
    setShowResztaChoice(false);
    setSaving(true);

    const { error: zlErr } = await supabase
      .from('zlecenia')
      .update({
        dzien: dzien || zlecenie?.dzien,
        preferowana_godzina: godzina === 'dowolna' ? null : godzina,
        typ_pojazdu: typPojazdu === 'brak' ? null : typPojazdu,
      })
      .eq('id', zlecenieId);

    // Zapisz wszystkie WZ
    for (const w of wzList) {
      await supabase
        .from('zlecenia_wz')
        .update({
          odbiorca: w.odbiorca,
          adres: w.adres,
          tel: w.tel || null,
          masa_kg: w.masa_kg || 0,
          objetosc_m3: w.objetosc_m3 || 0,
          ilosc_palet: w.ilosc_palet || 0,
          uwagi: w.uwagi || null,
          klasyfikacja: w.klasyfikacja || null,
        })
        .eq('id', w.id);
    }

    // Utwórz zlecenie z resztą jeśli dyspozytor wybrał tę opcję
    if (createReszta && zlecenie?.oddzial_id) {
      const reszty = computeReszty();
      if (reszty.length > 0) {
        try {
          const numer = await generateNumerZlecenia(zlecenie.oddzial_id);
          const { data: noweZl } = await supabase
            .from('zlecenia')
            .insert({
              numer,
              oddzial_id: zlecenie.oddzial_id,
              dzien: dzien || zlecenie.dzien,
              preferowana_godzina: godzina === 'dowolna' ? null : godzina,
              typ_pojazdu: typPojazdu === 'brak' ? null : typPojazdu,
              status: 'robocza',
              nadawca_id: zlecenie.nadawca_id,
            })
            .select('id')
            .single();
          if (noweZl) {
            for (const r of reszty) {
              await supabase.from('zlecenia_wz').insert({
                zlecenie_id: noweZl.id,
                odbiorca: r.odbiorca, adres: r.adres, tel: r.tel || null,
                masa_kg: r.masa_kg, objetosc_m3: r.objetosc_m3, ilosc_palet: r.ilosc_palet,
                uwagi: r.uwagi, numer_wz: r.numer_wz, nr_zamowienia: r.nr_zamowienia,
                klasyfikacja: r.klasyfikacja || null,
              });
            }
            toast({ title: 'Utworzono zlecenie z resztą: ' + numer });
          }
        } catch (e) {
          console.warn('Nie udalo sie utworzyc zlecenia z reszta', e);
        }
      }
    }

    setSaving(false);
    if (zlErr) {
      toast({ title: 'Błąd', description: zlErr.message, variant: 'destructive' });
    } else {
      toast({ title: 'Zlecenie zaktualizowane' });
      onSaved();
      onClose();
    }
  };

  // Sprawdź czy są zmniejszenia → pokaż dialog wyboru
  const handleSaveClick = () => {
    const reszty = computeReszty();
    if (reszty.length > 0) {
      setShowResztaChoice(true);
    } else {
      handleSave(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Edycja zlecenia {zlecenie?.numer || ''}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="text-center text-muted-foreground py-6">Ładowanie...</p>
          ) : zlecenie && ['dostarczona', 'w_trasie', 'anulowana'].includes(zlecenie.status) ? (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm font-medium">Zlecenie ma status: <strong>{zlecenie.status === 'dostarczona' ? 'Dostarczone' : zlecenie.status === 'w_trasie' ? 'W trasie' : 'Anulowane'}</strong></p>
              <p className="text-sm text-muted-foreground">Zrealizowanych zleceń nie można edytować.</p>
              <Button variant="outline" onClick={onClose}>Zamknij</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info + dzień edytowalny */}
              <div className="grid grid-cols-4 gap-3 p-3 rounded-lg bg-muted/50">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Numer</p>
                  <p className="text-sm font-mono font-medium">{zlecenie?.numer}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Nadawca</p>
                  <p className="text-sm">{nadawcaNazwa}</p>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground uppercase">Dzień</Label>
                  <Input type="date" className="h-8 text-sm" value={dzien} onChange={e => setDzien(e.target.value)} />
                </div>
              </div>

              {/* Godzina + typ pojazdu */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Godzina dostawy</Label>
                  <Select value={godzina} onValueChange={setGodzina}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GODZINY.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Typ pojazdu</Label>
                  <Select value={typPojazdu} onValueChange={setTypPojazdu}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brak">Nie wybrano</SelectItem>
                      {TYPY_POJAZDOW.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* WZ list */}
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Dokumenty WZ ({wzList.length})</Label>
                <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
                  Importuj z WZ
                </Button>
              </div>

              {wzList.map((w, idx) => (
                <Card key={w.id} className="p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      WZ #{idx + 1} {w.numer_wz && <span className="font-mono">({w.numer_wz})</span>}
                    </span>
                    {w.nr_zamowienia && <span className="text-xs text-muted-foreground">Zam: {w.nr_zamowienia}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Odbiorca</Label>
                      <Input className="h-8 text-sm" value={w.odbiorca} onChange={e => updateWz(idx, 'odbiorca', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Adres</Label>
                      <Input className="h-8 text-sm" value={w.adres} onChange={e => updateWz(idx, 'adres', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Telefon</Label>
                      <Input className="h-8 text-sm" value={w.tel} onChange={e => updateWz(idx, 'tel', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <Label className="text-xs">Kg</Label>
                        <Input className="h-8 text-sm" type="number" value={w.masa_kg || ''} onChange={e => updateWz(idx, 'masa_kg', Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-xs">m3</Label>
                        <Input className="h-8 text-sm" type="number" value={w.objetosc_m3 || ''} onChange={e => updateWz(idx, 'objetosc_m3', Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-xs">Pal.</Label>
                        <Input className="h-8 text-sm" type="number" value={w.ilosc_palet || ''} onChange={e => updateWz(idx, 'ilosc_palet', Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Klasyfikacja transportu *</Label>
                    <Select value={w.klasyfikacja || ''} onValueChange={(v) => updateWz(idx, 'klasyfikacja', v)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Wybierz klasyfikację…" />
                      </SelectTrigger>
                      <SelectContent>
                        {KLASYFIKACJE.map(k => (
                          <SelectItem key={k.kod} value={k.kod}>{k.kod} — {k.opis}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Uwagi</Label>
                    <Input className="h-8 text-sm" value={w.uwagi} onChange={e => updateWz(idx, 'uwagi', e.target.value)} />
                  </div>
                </Card>
              ))}
            </div>
          )}

          {isOverloaded && (
            <div className="p-3 rounded-md text-sm bg-red-100 dark:bg-red-950/50 border border-red-400">
              <div className="font-semibold text-red-600 mb-1">⚠️ Przekroczona pojemność pojazdu!</div>
              {overKg && <div className="text-red-600">Waga: {Math.round(totalLoad.kg)} / {capacity.kg} kg (+{Math.round(totalLoad.kg - capacity.kg)} kg)</div>}
              {overM3 && <div className="text-red-600">Objętość: {totalLoad.m3.toFixed(1)} / {capacity.m3} m³ (+{(totalLoad.m3 - capacity.m3).toFixed(1)})</div>}
              {overPal && <div className="text-red-600">Palety: {totalLoad.pal} / {capacity.pal} pal (+{totalLoad.pal - capacity.pal})</div>}
            </div>
          )}

          {/* Dialog wyboru: korekta vs reszta */}
          {showResztaChoice && (() => {
            const reszty = computeReszty();
            const rKg = reszty.reduce((s, r) => s + r.masa_kg, 0);
            const rM3 = reszty.reduce((s, r) => s + r.objetosc_m3, 0);
            const rPal = reszty.reduce((s, r) => s + r.ilosc_palet, 0);
            return (
              <div className="p-4 rounded-lg border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/30 space-y-3">
                <p className="text-sm font-semibold">Zmniejszono ilości — co zrobić z różnicą?</p>
                <p className="text-xs text-muted-foreground">
                  Różnica: {rKg > 0 ? Math.round(rKg) + ' kg' : ''}{rM3 > 0 ? ' · ' + rM3.toFixed(1) + ' m³' : ''}{rPal > 0 ? ' · ' + rPal + ' pal' : ''}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleSave(false)}>
                    ✏️ Tylko skoryguj
                  </Button>
                  <Button size="sm" onClick={() => handleSave(true)}>
                    📦 Utwórz zlecenie z resztą
                  </Button>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Anuluj</Button>
            {zlecenie && !['dostarczona', 'w_trasie', 'anulowana'].includes(zlecenie.status) && (
              <Button variant="secondary" onClick={() => setShowPrzekaz(true)} disabled={saving || loading}>
                ↗ Przekaż do oddziału
              </Button>
            )}
            <Button onClick={handleSaveClick} disabled={saving || loading || showResztaChoice} variant={isOverloaded ? 'destructive' : 'default'}>
              {saving ? 'Zapisywanie...' : isOverloaded ? `⚠️ Zapisz mimo przekroczenia (${wzList.length} WZ)` : `Zapisz zmiany (${wzList.length} WZ)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModalImportWZ
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImportWz}
      />

      <PrzekazDoOddzialuModal
        zlecenieId={zlecenieId}
        zlecenieNumer={zlecenie?.numer}
        obecnyOddzialId={zlecenie?.oddzial_id ?? null}
        open={showPrzekaz}
        onClose={() => setShowPrzekaz(false)}
        onDone={() => {
          onSaved();
          onClose();
        }}
      />
    </>
  );
}
