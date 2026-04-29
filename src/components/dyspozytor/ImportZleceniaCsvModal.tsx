import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { parseCsvFile, type ImportRow, type ImportParseResult } from '@/lib/parseImportZlecen';
import { useImportZlecenCsv, checkDuplicates } from '@/hooks/useImportZlecenCsv';

interface Props {
  open: boolean;
  onClose: () => void;
  oddzialId: number;
  oddzialNazwa: string;
  /** Callback po imporcie — Dashboard refetchuje listy. */
  onImported?: () => void;
}

/**
 * Modal importu zlecen z pliku CSV (export z systemu magazynowego).
 *
 * Stages:
 *   1. config — date picker + file input (drag-drop)
 *   2. preview — tabela wczytanych wierszy z checkbox'ami i statusem
 *   3. importing — spinner z progress
 */
export function ImportZleceniaCsvModal({ open, onClose, oddzialId, oddzialNazwa, onImported }: Props) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<'config' | 'preview' | 'importing'>('config');
  const [dzien, setDzien] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  /** Set numerow WZ ktore sa duplikatami w DB. */
  const [duplikaty, setDuplikaty] = useState<Set<string>>(new Set());
  /** Map numer_wz -> czy zaznaczony do importu (default: status='ok' && nie-duplikat). */
  const [zaznaczone, setZaznaczone] = useState<Map<string, boolean>>(new Map());
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { importZlecenia, importing } = useImportZlecenCsv();

  // Reset stanu po zamknieciu
  useEffect(() => {
    if (!open) {
      setStage('config');
      setParseResult(null);
      setDuplikaty(new Set());
      setZaznaczone(new Map());
      setError(null);
      setParsing(false);
    }
  }, [open]);

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const result = await parseCsvFile(file);
      // Pre-check duplikatow w DB
      const numery = result.rows
        .filter((r) => r.status === 'ok')
        .map((r) => r.numer_wz);
      const dups = await checkDuplicates(numery);

      // Default zaznaczenia: 'ok' i nie-duplikat
      const newZaznaczone = new Map<string, boolean>();
      for (const row of result.rows) {
        const isDup = dups.has(row.numer_wz);
        newZaznaczone.set(row.numer_wz, row.status === 'ok' && !isDup);
      }

      setParseResult(result);
      setDuplikaty(dups);
      setZaznaczone(newZaznaczone);
      setStage('preview');
    } catch (e: any) {
      setError('Błąd wczytywania pliku: ' + (e?.message || 'nieznany'));
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const toggleZaznaczone = (numerWz: string) => {
    setZaznaczone((prev) => {
      const n = new Map(prev);
      n.set(numerWz, !n.get(numerWz));
      return n;
    });
  };

  const liczbaZaznaczonych = Array.from(zaznaczone.values()).filter(Boolean).length;

  const handleImport = async () => {
    if (!parseResult || !user) return;
    if (liczbaZaznaczonych === 0) {
      toast.error('Nic nie zaznaczono do importu');
      return;
    }
    setStage('importing');
    const wybrane = parseResult.rows.filter((r) => zaznaczone.get(r.numer_wz));
    const result = await importZlecenia(wybrane, dzien, oddzialId, user.id);
    if (result.imported > 0) {
      toast.success(
        `Zaimportowano ${result.imported} zleceń` +
          (result.errors.length > 0 ? `, ${result.errors.length} bledow` : '')
      );
      onImported?.();
    }
    if (result.errors.length > 0) {
      console.error('[Import CSV] errors:', result.errors);
      toast.error(
        `${result.errors.length} bledow przy imporcie. Sprawdz konsole F12 (linie '[Import]').`
      );
    }
    onClose();
  };

  const renderPodsumowanie = () => {
    if (!parseResult) return null;
    const dupOk = parseResult.rows.filter((r) => r.status === 'ok' && duplikaty.has(r.numer_wz)).length;
    const ok = parseResult.rows.filter((r) => r.status === 'ok' && !duplikaty.has(r.numer_wz)).length;
    const skipPusta = parseResult.rows.filter((r) => r.status === 'skip_pusta_dostawa').length;
    return (
      <div className="text-sm text-muted-foreground space-y-1">
        <div>📊 Wczytano <b>{parseResult.totalRows}</b> wierszy z pliku CSV.</div>
        <div className="flex flex-wrap gap-3">
          <span className="text-green-700">✅ {ok} gotowych do importu</span>
          {dupOk > 0 && <span className="text-orange-600">⚠ {dupOk} duplikatów (już w bazie)</span>}
          {skipPusta > 0 && <span className="text-gray-600">⊘ {skipPusta} odbiorów własnych/kuriera</span>}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>📥 Import zleceń z CSV — {oddzialNazwa}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">
            ❌ {error}
          </div>
        )}

        {/* === STAGE: config === */}
        {stage === 'config' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dzien-importu">Dzień dostawy (dla wszystkich zleceń)</Label>
              <Input
                id="dzien-importu"
                type="date"
                value={dzien}
                onChange={(e) => setDzien(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Można edytować per zlecenie po imporcie (każde zlecenie trafi ze statusem „do weryfikacji").
              </p>
            </div>

            <div className="space-y-2">
              <Label>Plik CSV (eksport z systemu magazynowego)</Label>
              <div
                className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/30 p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div className="text-3xl mb-2">📁</div>
                <p className="text-sm font-medium">
                  {parsing ? 'Wczytywanie...' : 'Kliknij lub przeciągnij plik CSV'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Eksport „Zestawienie" z Promak/Ekonom (encoding Windows-1250)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                />
              </div>
            </div>
          </div>
        )}

        {/* === STAGE: preview === */}
        {stage === 'preview' && parseResult && (
          <div className="space-y-3">
            {renderPodsumowanie()}

            <div className="text-xs text-muted-foreground">
              Dzień dostawy: <b>{dzien}</b>. Status: <b>do weryfikacji</b>.
              Brakujące pola (m³, palety, klasyfikacja, telefon, typ pojazdu) uzupełnisz po imporcie per zlecenie.
            </div>

            <div className="border rounded-lg max-h-[50vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="border-b">
                    <th className="p-2 text-left w-8"></th>
                    <th className="p-2 text-left">Numer WZ</th>
                    <th className="p-2 text-left">Odbiorca</th>
                    <th className="p-2 text-left">Adres</th>
                    <th className="p-2 text-right">kg</th>
                    <th className="p-2 text-right">Wartość</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.rows.map((row) => {
                    const isDup = duplikaty.has(row.numer_wz);
                    const isSkip = row.status !== 'ok';
                    const isChecked = zaznaczone.get(row.numer_wz) ?? false;
                    const rowClass = isSkip
                      ? 'bg-gray-50 text-gray-400'
                      : isDup
                      ? 'bg-orange-50'
                      : '';
                    return (
                      <tr key={row.numer_wz + row.lp} className={`border-b ${rowClass}`}>
                        <td className="p-2">
                          <Checkbox
                            checked={isChecked}
                            disabled={isSkip}
                            onCheckedChange={() => toggleZaznaczone(row.numer_wz)}
                          />
                        </td>
                        <td className="p-2 font-mono">{row.numer_wz}</td>
                        <td className="p-2 truncate max-w-[200px]">{row.odbiorca}</td>
                        <td className="p-2 truncate max-w-[300px]">{row.adres || '—'}</td>
                        <td className="p-2 text-right">{row.masa_kg.toFixed(1)}</td>
                        <td className="p-2 text-right">
                          {row.wartosc_netto != null ? row.wartosc_netto.toFixed(2) : '—'}
                        </td>
                        <td className="p-2">
                          {row.status === 'skip_pusta_dostawa' && <span className="text-gray-500">odbiór własny</span>}
                          {row.status === 'skip_brak_numeru' && <span className="text-red-600">brak numeru</span>}
                          {row.status === 'ok' && isDup && <span className="text-orange-600">duplikat w DB</span>}
                          {row.status === 'ok' && !isDup && <span className="text-green-700">OK</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {parseResult.errors.length > 0 && (
              <div className="text-xs text-red-600">
                Błędy parsowania: {parseResult.errors.length}. Sprawdź konsolę F12.
              </div>
            )}
          </div>
        )}

        {/* === STAGE: importing === */}
        {stage === 'importing' && (
          <div className="py-8 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Importowanie {liczbaZaznaczonych} zleceń...</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {stage === 'config' && (
            <>
              <Button variant="outline" onClick={onClose}>Anuluj</Button>
              <Button disabled>Wczytaj plik najpierw</Button>
            </>
          )}
          {stage === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStage('config')}>← Wróć</Button>
              <Button variant="outline" onClick={onClose}>Anuluj</Button>
              <Button onClick={handleImport} disabled={liczbaZaznaczonych === 0 || importing}>
                ✅ Importuj {liczbaZaznaczonych} zleceń
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
