import { useEffect, useRef, useState } from "react";

interface Props {
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
}

type Stage = "loading" | "floating" | "freeze";

/**
 * Live preview screen capture z 3-stage UX:
 *   loading   — popup browsera, czekamy na user'a
 *   floating  — maly widget 280x170 w prawym dolnym rogu z live preview;
 *               user pracuje swobodnie (Alt+Tab do Ekonoma, otwiera dokument WZ),
 *               gdy gotowy klika "Wytnij teraz"
 *   freeze    — fullscreen ze statyczna klatka (zatrzymana w czasie) + zaznaczanie
 *               myszka + przycisk Wytnij. Wstecz wraca do floating.
 *
 * Firefox potrzebuje WIDOCZNEGO video element zeby decode pipeline ruszyl —
 * dlatego floating widget jest stale renderowany (nawet w stage 'freeze' video
 * leci dalej w tle, tylko przykryte canvas'em z freeze frame).
 */
export function SnipLiveOverlay({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [frozenSize, setFrozenSize] = useState<{ w: number; h: number } | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
  // Pomocnik logujacy do console (do diagnostyki)
  const dbg = (msg: string) => console.log("[SnipLive]", msg);

  // 1. Otworz getDisplayMedia po mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          setError("Twoja przegladarka nie wspiera Screen Capture API");
          return;
        }
        const inIframe = window.self !== window.top;
        const host = window.location.hostname;
        dbg(`host=${host} iframe=${inIframe}`);
        if (inIframe) dbg("UWAGA: aplikacja w iframe — moze byc zablokowane");
        dbg("getDisplayMedia start (kliknij Udostepnij w popupie)");
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const tracks = stream.getVideoTracks();
        const settings = tracks[0]?.getSettings?.() ?? {};
        dbg(`stream OK, tracks=${tracks.length}, surface=${(settings as any).displaySurface ?? "?"}`);
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.muted = true;
          v.playsInline = true;
          v.autoplay = true;
          dbg(`readyState=${v.readyState}, czekam na loadedmetadata...`);
          let metadataResolved = false;
          await new Promise<void>((resolve) => {
            const onLoaded = () => {
              if (metadataResolved) return;
              metadataResolved = true;
              v.removeEventListener("loadedmetadata", onLoaded);
              dbg("loadedmetadata OK");
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
                  dbg("TIMEOUT 6s — brak loadedmetadata");
                  resolve();
                }
              }, 6000);
            }
          });
          await Promise.race([
            v.play().catch((e) => { dbg(`play() blad: ${e?.message || e}`); }),
            new Promise<void>((resolve) => setTimeout(() => {
              dbg("play() TIMEOUT 3s");
              resolve();
            }, 3000)),
          ]);
          dbg(`po play: w=${v.videoWidth} h=${v.videoHeight}`);
          if (v.videoWidth === 0 || v.videoHeight === 0) {
            dbg("BLAD: videoWidth/Height = 0 — capture niemozliwy");
            if (!cancelled) {
              setError("Firefox nie przechwycil tego okna. WYBIERZ 'CALY EKRAN' / 'Ekran 2' zamiast okna aplikacji desktopowej. Alternatywa: zamknij to i uzyj Win+Shift+S, potem Ctrl+V w aplikacji.");
            }
            return;
          }
          if (!cancelled) {
            setStage("floating");
            dbg(`video gotowy: ${v.videoWidth}x${v.videoHeight}, stage=floating`);
          }
        }
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          dbg("track ended (user zatrzymal)");
          if (!cancelled) onCancel();
        });
      } catch (e: any) {
        console.error("[SnipLive] error:", e);
        if (e?.name === "NotAllowedError") {
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

  // Esc anuluje, Enter akceptuje (tylko gdy zaznaczenie aktywne w stage freeze)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && stage === "freeze" && start && end) acceptCrop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, stage]);

  // FREEZE: grab biezacej klatki z video, narysuj na canvas, przejdz do stage 'freeze'
  const handleSnap = () => {
    const v = videoRef.current;
    if (!v) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (w === 0 || h === 0) {
      setError("Brak klatek z video — sprobuj ponownie");
      return;
    }
    setFrozenSize({ w, h });
    setStart(null);
    setEnd(null);
    setStage("freeze");
    dbg(`freeze frame: ${w}x${h}`);
    // Narysuj na canvas po następnym tick'u (gdy canvas zostanie wyrenderowany)
    setTimeout(() => {
      const c = freezeCanvasRef.current;
      if (!c) return;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0);
    }, 0);
  };

  const handleBackToFloating = () => {
    setStage("floating");
    setStart(null);
    setEnd(null);
  };

  // Wspolrzedne myszki -> wspolrzedne w pixelach FROZEN frame
  const getCoords = (e: React.MouseEvent) => {
    const c = freezeCanvasRef.current;
    if (!c || !frozenSize) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const scaleX = frozenSize.w / rect.width;
    const scaleY = frozenSize.h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || stage !== "freeze") return;
    setStart(getCoords(e));
    setEnd(getCoords(e));
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!start || stage !== "freeze") return;
    setEnd(getCoords(e));
  };

  const acceptCrop = async () => {
    const c = freezeCanvasRef.current;
    if (!c || !start || !end) return;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w < 10 || h < 10) return;
    const out = document.createElement("canvas");
    out.width = Math.round(w);
    out.height = Math.round(h);
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => {
      out.toBlob((b) => resolve(b), "image/jpeg", 0.92);
    });
    if (blob) onCapture(blob);
  };

  // Wymiary prostokata zaznaczenia w pixelach DISPLAY canvasu freeze
  const rectStyle = (() => {
    if (!start || !end || !frozenSize) return null;
    const c = freezeCanvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const scaleX = rect.width / frozenSize.w;
    const scaleY = rect.height / frozenSize.h;
    const x = Math.min(start.x, end.x) * scaleX;
    const y = Math.min(start.y, end.y) * scaleY;
    const w = Math.abs(end.x - start.x) * scaleX;
    const h = Math.abs(end.y - start.y) * scaleY;
    return { left: x, top: y, width: w, height: h };
  })();

  // === STAGE: loading ===
  if (stage === "loading" && !error) {
    return (
      <div className="fixed bottom-4 right-4 z-[9999] bg-black/90 text-white p-3 rounded-lg shadow-2xl border border-white/20 max-w-xs">
        <div className="text-sm">⏳ Wybierz ekran/okno w popupie przegladarki...</div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-xs"
        >
          Anuluj
        </button>
      </div>
    );
  }

  // === STAGE: error ===
  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg max-w-md">
          <div className="text-red-600 font-medium mb-3">❌ Blad screen capture</div>
          <div className="text-sm text-gray-700 mb-4">{error}</div>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
          >
            Zamknij
          </button>
        </div>
      </div>
    );
  }

  // === Container z video — zawsze obecny w DOM (Firefox potrzebuje widocznego video) ===
  // W stage 'floating' video jest widoczne w widget'cie.
  // W stage 'freeze' video leci dalej w tle (1px), ale freeze canvas pokrywa ekran.
  return (
    <>
      {/* FLOATING WIDGET — widoczny w stage 'floating', schowany w 'freeze' */}
      <div
        className="fixed z-[9999] bg-black/90 rounded-lg shadow-2xl border-2 border-blue-500 overflow-hidden"
        style={{
          bottom: stage === "floating" ? 16 : -9999,
          right: stage === "floating" ? 16 : -9999,
          width: 280,
        }}
      >
        <div className="text-white text-xs px-2 py-1 bg-blue-600 font-medium">
          🎥 Podglad strumienia
        </div>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="block w-full"
          style={{ maxHeight: 160, objectFit: "contain", background: "#000" }}
        />
        <div className="flex gap-1 p-2 bg-black/80">
          <button
            type="button"
            onClick={handleSnap}
            className="flex-1 px-2 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs font-medium"
          >
            ✂️ Wytnij teraz
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1.5 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
          >
            Anuluj
          </button>
        </div>
        <div className="text-white/70 text-[10px] px-2 pb-2">
          Przelacz sie na okno (Alt+Tab), gdy gotowe — kliknij Wytnij teraz
        </div>
      </div>

      {/* FREEZE OVERLAY — fullscreen ze statyczna klatka */}
      {stage === "freeze" && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex flex-col items-center justify-center p-4">
          <div className="text-white text-sm mb-2 text-center">
            ✂️ Zaznacz fragment myszka (przeciagnij). Enter = wytnij, Esc = anuluj, Wstecz = nowa klatka.
          </div>
          <div
            className="relative cursor-crosshair max-w-[95vw] max-h-[80vh]"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
          >
            <canvas
              ref={freezeCanvasRef}
              className="block max-w-[95vw] max-h-[80vh]"
              style={{ imageRendering: "pixelated" }}
            />
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
              disabled={!start || !end}
              className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              ✂️ Wytnij
            </button>
            <button
              type="button"
              onClick={handleBackToFloating}
              className="px-4 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
            >
              ← Wstecz (nowa klatka)
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-1.5 bg-red-700 text-white rounded hover:bg-red-800 text-sm"
            >
              Anuluj (Esc)
            </button>
          </div>
        </div>
      )}
    </>
  );
}
