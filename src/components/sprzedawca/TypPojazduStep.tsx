import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const ERP_TYPES = [
  { kod: 'B', opis: 'Bez windy do 1,2t', typ: 'Dostawczy 1,2t' },
  { kod: 'C', opis: 'Winda do 1,8t', typ: 'Winda 1,8t' },
  { kod: 'D', opis: 'Winda do 6t', typ: 'Winda 6,3t' },
  { kod: 'E', opis: 'Winda duża MAX 15,8t', typ: 'Winda MAX 15,8t' },
  { kod: 'F', opis: 'HDS duży', typ: 'HDS 12,0t' },
  { kod: 'G', opis: 'HDS duży + przyczepa', typ: 'HDS 12,0t' },
  { kod: 'H', opis: 'HDS średni', typ: 'HDS 9,0t' },
  { kod: 'I', opis: 'HDS średni + przyczepa', typ: 'HDS 9,0t' },
];

interface TypPojazduStepProps {
  oddzialId: number | null;
  setOddzialId: (v: number | null) => void;
  typPojazdu: string;
  setTypPojazdu: (v: string) => void;
  oddzialy: { id: number; nazwa: string }[];
  loadingOddzialy: boolean;
  flota: { typ: string }[];
  loadingFlota: boolean;
  onNext: () => void;
}

export function TypPojazduStep({
  oddzialId, setOddzialId,
  typPojazdu, setTypPojazdu,
  oddzialy, loadingOddzialy,
  flota, loadingFlota,
  onNext,
}: TypPojazduStepProps) {
  const uniqueTypes = [...new Set(flota.map(f => f.typ))];
  const [tab, setTab] = useState('pojazd');

  // Pobierz typy aut zewnętrznych dla wybranego oddziału
  const [zewTypy, setZewTypy] = useState<string[]>([]);
  useEffect(() => {
    if (!oddzialId) { setZewTypy([]); return; }
    supabase
      .from('flota_zewnetrzna')
      .select('typ')
      .eq('oddzial_id', oddzialId)
      .eq('aktywny', true)
      .then(({ data }) => {
        const typy = [...new Set((data || []).map(f => f.typ))];
        setZewTypy(typy);
      });
  }, [oddzialId]);

  return (
    <div className="space-y-4">
      <div>
        <Label>Oddział</Label>
        <Select onValueChange={v => setOddzialId(Number(v))} value={oddzialId?.toString() || ''}>
          <SelectTrigger><SelectValue placeholder={loadingOddzialy ? 'Ładowanie...' : 'Wybierz oddział'} /></SelectTrigger>
          <SelectContent>
            {oddzialy.map(o => <SelectItem key={o.id} value={o.id.toString()}>{o.nazwa}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Typ pojazdu</Label>
        <Tabs value={tab} onValueChange={setTab} className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="pojazd" className="flex-1 text-xs">🚛 Wybierz pojazd</TabsTrigger>
            <TabsTrigger value="kod" className="flex-1 text-xs">📋 Kod A-I</TabsTrigger>
          </TabsList>

          <TabsContent value="pojazd">
            {loadingFlota ? (
              <p className="text-sm text-muted-foreground py-2">Ładowanie floty...</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setTypPojazdu('bez_preferencji')}
                  className={cn(
                    'col-span-2 flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-left transition-colors',
                    typPojazdu === 'bez_preferencji'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-muted-foreground/30 hover:border-muted-foreground/50'
                  )}
                >
                  <span className="text-xl">🔀</span>
                  <div>
                    <div className="font-medium text-sm">Bez preferencji</div>
                    <div className="text-xs text-muted-foreground">Dyspozytor dobierze auto</div>
                  </div>
                </button>

                {uniqueTypes.map(typ => (
                  <button
                    key={typ}
                    type="button"
                    onClick={() => setTypPojazdu(typ)}
                    className={cn(
                      'rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors',
                      typPojazdu === typ
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-muted-foreground/50'
                    )}
                  >
                    {typ}
                  </button>
                ))}

                {zewTypy.length > 0 ? (
                  zewTypy.map(typ => (
                    <button
                      key={`zew-${typ}`}
                      type="button"
                      onClick={() => setTypPojazdu(`zew:${typ}`)}
                      className={cn(
                        'rounded-lg border-2 px-4 py-3 text-left transition-colors',
                        typPojazdu === `zew:${typ}`
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-muted-foreground/50'
                      )}
                    >
                      <div className="text-sm font-medium">Zew. {typ}</div>
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    onClick={() => setTypPojazdu('zewnetrzny')}
                    className={cn(
                      'rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-colors',
                      typPojazdu === 'zewnetrzny'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-muted-foreground/50'
                    )}
                  >
                    Zewnętrzny
                  </button>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="kod">
            <div className="space-y-1 mt-2">
              {ERP_TYPES.map(e => (
                <button
                  key={e.kod}
                  type="button"
                  onClick={() => setTypPojazdu(e.typ)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition-colors',
                    typPojazdu === e.typ
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <span className={cn(
                    'w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold',
                    typPojazdu === e.typ ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}>
                    {e.kod}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{e.opis}</div>
                    <div className="text-xs text-muted-foreground">{e.typ}</div>
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Button onClick={onNext} disabled={!oddzialId || !typPojazdu}>Dalej →</Button>
    </div>
  );
}
