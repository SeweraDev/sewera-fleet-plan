import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getArchiwumSignedUrl, listArchiwumPages } from "@/lib/archiwumWZ";

interface Props {
  archiwumPath: string | null;
  numerWz?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal podgladu archiwum WZ — listuje strony (multi-page lub legacy single),
 * pokazuje miniatury obok siebie + modal powiekszenia po kliknieciu (jak WzPdfTab).
 * Signed URL ma 15 min waznosci, jest cache'owany przez przegladrke po pierwszym ladowaniu.
 */
export function PodgladWZDialog({ archiwumPath, numerWz, isOpen, onClose }: Props) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedIdx, setZoomedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen || !archiwumPath) {
      setUrls([]);
      setError(null);
      setZoomedIdx(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setZoomedIdx(null);

    (async () => {
      try {
        // 1) Listuj strony (dla multi-page wraca array path'ow strona_1.jpg, strona_2.jpg, ...)
        const paths = await listArchiwumPages(archiwumPath);
        if (cancelled) return;
        if (paths.length === 0) {
          setError("Dokument nie jest dostepny w archiwum (mogl zostac usuniety przy czyszczeniu starszych miesiecy).");
          setLoading(false);
          return;
        }

        // 2) Pobierz signed URL dla kazdej strony rownolegle
        const signedUrls = await Promise.all(paths.map((p) => getArchiwumSignedUrl(p)));
        if (cancelled) return;

        const valid = signedUrls.filter((u): u is string => !!u);
        if (valid.length === 0) {
          setError("Nie udalo sie zaladowac stron archiwum (signed URL fail).");
        } else {
          setUrls(valid);
        }
      } catch (err) {
        if (!cancelled) setError("Blad ladowania archiwum: " + (err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, archiwumPath]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              📄 Podgląd WZ {numerWz ? `— ${numerWz}` : ""}
              {urls.length > 1 && <span className="text-xs text-muted-foreground ml-2">({urls.length} stron, kliknij aby powiększyć)</span>}
              {urls.length === 1 && <span className="text-xs text-muted-foreground ml-2">(kliknij aby powiększyć)</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-[400px]">
            {loading && (
              <div className="text-center py-8">
                <div className="animate-spin inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
                <p className="text-sm text-muted-foreground mt-2">Ładowanie podglądu...</p>
              </div>
            )}
            {error && <p className="text-sm text-destructive text-center px-4 py-8">{error}</p>}
            {urls.length > 0 && !loading && (
              <div className="space-y-3">
                {urls.map((url, idx) => (
                  <div key={idx} className="space-y-1">
                    {urls.length > 1 && (
                      <p className="text-[10px] text-muted-foreground font-medium">Strona {idx + 1} / {urls.length}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => setZoomedIdx(idx)}
                      className="block w-full cursor-zoom-in"
                      title={`Powiększ stronę ${idx + 1}`}
                    >
                      <img
                        src={url}
                        alt={`Podgląd WZ ${numerWz || ""} — strona ${idx + 1}`}
                        className="w-full h-auto rounded shadow-sm hover:shadow-md hover:ring-2 hover:ring-primary/40 transition-all"
                        onError={() => setError("Błąd ładowania obrazu (strona " + (idx + 1) + ")")}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal powiekszenia — pokazuje wybrana strone w pelnym rozmiarze z nawigacja */}
      <Dialog
        open={zoomedIdx !== null}
        onOpenChange={(o) => { if (!o) setZoomedIdx(null); }}
      >
        <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto p-2 overflow-auto">
          {zoomedIdx !== null && urls[zoomedIdx] && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-2">
                <p className="text-sm font-medium">
                  {numerWz} {urls.length > 1 && `— Strona ${zoomedIdx + 1} / ${urls.length}`}
                </p>
                {urls.length > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={zoomedIdx === 0}
                      onClick={() => setZoomedIdx((i) => i !== null && i > 0 ? i - 1 : i)}
                    >
                      ← Poprzednia
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={zoomedIdx === urls.length - 1}
                      onClick={() => setZoomedIdx((i) => i !== null && i < urls.length - 1 ? i + 1 : i)}
                    >
                      Następna →
                    </Button>
                  </div>
                )}
              </div>
              <img
                src={urls[zoomedIdx]}
                alt={`Podgląd WZ ${numerWz || ""} — strona ${zoomedIdx + 1} (powiększenie)`}
                className="w-full h-auto rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
