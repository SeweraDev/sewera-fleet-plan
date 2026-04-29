import { useEffect, useRef, useState } from "react";

interface Props {
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
}

/**
 * Live preview screen capture.
 * Otwiera getDisplayMedia, pokazuje LIVE video w modalu (Firefox potrzebuje
 * widocznego video element zeby decode pipeline ruszyl). User zaznacza
 * prostokat myszka. Klik "Wytnij" -> grab biezacej klatki, crop, return blob.
 *
 * Naprawia problem hidden-video-hangs-in-Firefox.
 */
export function SnipLiveOverlay({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);

  // 1. Otworz getDisplayMedia po mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          setError("Twoja przegladarka nie wspiera Screen Capture API");
          return;
        }
        // Detekcja iframe — Lovable preview jest w iframe, getDisplayMedia
        // wymaga allow='display-capture'. Bez tego stream nie zwraca klatek.
        const inIframe = window.self !== window.top;
        const host = window.location.hostname;
        console.log("[SnipLive] host:", host, "iframe:", inIframe);
        if (inIframe) {
          console.warn("[SnipLive] aplikacja w iframe — getDisplayMedia moze byc zablokowany");
        }
        console.log("[SnipLive] getDisplayMedia start");
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        console.log("[SnipLive] stream OK, tracks:", stream.getVideoTracks().length);
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.muted = true;
          v.playsInline = true;
          v.autoplay = true;
          // Firefox: poczekaj na loadedmetadata zeby wymiary byly OK
          // TIMEOUT 6s — jesli okno desktopowe nie wypuszcza klatek (HW accel),
          // pokaz komunikat zamiast wisiec w nieskonczonosc.
          let metadataResolved = false;
          await new Promise<void>((resolve) => {
            const onLoaded = () => {
              if (metadataResolved) return;
              metadataResolved = true;
              v.removeEventListener("loadedmetadata", onLoaded);
              console.log("[SnipLive] loadedmetadata OK");
              resolve();
            };
            if (v.readyState >= 1) {
              metadataResolved = true;
              resolve();
            } else {
              v.addEventListener("loadedmetadata", onLoaded, { once: true });
              setTimeout(() => {
                if (!metadataResolved) {
                  metadataResolved = true;
                  v.removeEventListener("loadedmetadata", onLoaded);
                  console.warn("[SnipLive] timeout 6s — brak loadedmetadata. FF nie moze capture okna apki.");
                  resolve();
                }
              }, 6000);
            }
          });
          // play() z timeout 3s — czasem wisi dla streamu okna apki desktopowej
          await Promise.race([
            v.play().catch((e) => { console.warn("[SnipLive] play() warn:", e); }),
            new Promise<void>((resolve) => setTimeout(() => {
              console.warn("[SnipLive] play() timeout 3s — kontynuuje bez czekania");
              resolve();
            }, 3000)),
          ]);
          // Po wszystkim sprawdz wymiary — jesli 0, capture jest niemozliwy
          if (v.videoWidth === 0 || v.videoHeight === 0) {
            console.warn("[SnipLive] videoWidth/Height = 0 — capture niemozliwy");
            if (!cancelled) {
              setError("Firefox nie przechwycil tego okna. WYBIERZ 'CALY EKRAN' / 'Ekran 2' zamiast okna aplikacji desktopowej. Alternatywa: zamknij to i uzyj Win+Shift+S, potem Ctrl+V w aplikacji.");
            }
            return;
          }
          setStreamReady(true);
          console.log("[SnipLive] video gotowy:", v.videoWidth, "x", v.videoHeight);
        }
        // Detect koniec udostepniania (user kliknie 'Zatrzymaj udostepnianie' w pasku FF)
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          console.log("[SnipLive] track ended (user zatrzymal)");
          if (!cancelled) onCancel();
        });
      } catch (e: any) {
        console.error("[SnipLive] error:", e);
        if (e?.name === "NotAllowedError") {
          // User odmowil — po prostu zamknij
          onCancel();
          return;
        }
        setError("Nie udalo sie udostepnic ekranu: " + (e?.message || "nieznany blad"));
      }
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Esc anuluje, Enter akceptuje
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && start && end) acceptCrop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, streamReady]);

  // Wspolrzedne myszki -> wspolrzedne w pixelach video
  const getCoords = (e: React.MouseEvent) => {
    const v = videoRef.current;
    if (!v) return { x: 0, y: 0 };
    const rect = v.getBoundingClientRect();
    const scaleX = v.videoWidth / rect.width;
    const scaleY = v.videoHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !streamReady) return;
    setStart(getCoords(e));
    setEnd(getCoords(e));
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!start) return;
    setEnd(getCoords(e));
  };
  const handleMouseUp = () => {
    // Zostawiamy zaznaczenie aktywne — user moze poprawic
  };

  const acceptCrop = async () => {
    const v = videoRef.current;
    if (!v || !start || !end) return;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w < 10 || h < 10) return;
    // Grab biezaca klatke z video do canvas (juz wyciety obszar)
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(v, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
    });
    if (blob) onCapture(blob);
  };

  // Wymiary prostokata zaznaczenia w pixelach DISPLAY video
  const rectStyle = (() => {
    if (!start || !end) return null;
    const v = videoRef.current;
    if (!v) return null;
    const rect = v.getBoundingClientRect();
    const scaleX = rect.width / Math.max(v.videoWidth, 1);
    const scaleY = rect.height / Math.max(v.videoHeight, 1);
    const x = Math.min(start.x, end.x) * scaleX;
    const y = Math.min(start.y, end.y) * scaleY;
    const w = Math.abs(end.x - start.x) * scaleX;
    const h = Math.abs(end.y - start.y) * scaleY;
    return { left: x, top: y, width: w, height: h };
  })();

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/85 flex flex-col items-center justify-center"
      ref={containerRef}
    >
      <div className="text-white text-sm mb-2 text-center px-4">
        {error
          ? <span className="text-red-400">{error}</span>
          : !streamReady
            ? "⏳ Ladowanie podgladu... wybierz ekran/okno w popupie przegladarki"
            : "✂️ Zaznacz fragment myszka (przeciagnij). Enter = wytnij, Esc = anuluj."}
      </div>

      <div
        className="relative cursor-crosshair max-w-[95vw] max-h-[80vh]"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="block max-w-[95vw] max-h-[80vh]"
          style={{ display: streamReady ? "block" : "none" }}
        />
        {!streamReady && !error && (
          <div className="w-[60vw] h-[40vh] bg-black/40 flex items-center justify-center text-white">
            Czekam na strumien...
          </div>
        )}
        {rectStyle && (
          <div
            className="absolute border-2 border-blue-400 bg-blue-400/20 pointer-events-none"
            style={rectStyle}
          />
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={acceptCrop}
          disabled={!start || !end || !streamReady}
          className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          ✂️ Wytnij
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
        >
          Anuluj (Esc)
        </button>
      </div>
    </div>
  );
}
