import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getArchiwumSignedUrl } from "@/lib/archiwumWZ";

interface Props {
  archiwumPath: string | null;
  numerWz?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal podgladu archiwum WZ — laduje signed URL z Supabase Storage i wyswietla JPEG.
 * Signed URL ma 15 min waznosci, jest cache'owany przez przegladrke po pierwszym ladowaniu.
 */
export function PodgladWZDialog({ archiwumPath, numerWz, isOpen, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !archiwumPath) {
      setUrl(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    getArchiwumSignedUrl(archiwumPath)
      .then((signed) => {
        if (!signed) {
          setError("Dokument nie jest dostepny w archiwum (mogl zostac usuniety przy czyszczeniu starszych miesiecy).");
        } else {
          setUrl(signed);
        }
      })
      .finally(() => setLoading(false));
  }, [isOpen, archiwumPath]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>📄 Podgląd WZ {numerWz ? `— ${numerWz}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[400px]">
          {loading && (
            <div className="text-center">
              <div className="animate-spin inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
              <p className="text-sm text-muted-foreground mt-2">Ładowanie podglądu...</p>
            </div>
          )}
          {error && <p className="text-sm text-destructive text-center px-4">{error}</p>}
          {url && !loading && (
            <img
              src={url}
              alt={`Podgląd WZ ${numerWz || ""}`}
              className="max-w-full h-auto rounded shadow-md"
              onError={() => setError("Błąd ładowania obrazu")}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
