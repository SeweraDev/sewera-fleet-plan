import { useEffect, useRef, useState } from "react";

interface Props {
  bitmap: ImageBitmap;
  onCrop: (x: number, y: number, w: number, h: number) => void;
  onCancel: () => void;
}

/**
 * Fullscreen overlay nad aplikacja. Pokazuje przechwycony screenshot,
 * pozwala uzytkownikowi narysowac prostokat myszka (drag) i akceptuje
 * obszar (Enter / Klik 'Wytnij'). Esc anuluje.
 *
 * Wspolrzedne sa skalowane: overlay pokazuje screenshot przeskalowany do
 * widoku przegladarki, ale onCrop dostaje wspolrzedne w pixelach oryginalu.
 */
export function SnipOverlay({ bitmap, onCrop, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);

  // Render screenshot na canvas (z auto-fit do okna)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0);

    // Skala do wyswietlania (max 95% viewport)
    const maxW = window.innerWidth * 0.95;
    const maxH = window.innerHeight * 0.85;
    const s = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
    setScale(s);
  }, [bitmap]);

  // Esc anuluje, Enter akceptuje
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && start && end) acceptCrop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  const getCoords = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setStart(getCoords(e));
    setEnd(getCoords(e));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!start) return;
    setEnd(getCoords(e));
  };

  const handleMouseUp = () => {
    // Pozostaw zaznaczenie aktywne — user moze poprawic przed akceptacja
  };

  const acceptCrop = () => {
    if (!start || !end) return;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w < 10 || h < 10) return; // za maly obszar
    onCrop(x, y, w, h);
  };

  // Wymiary prostokata zaznaczenia (w skali display)
  const rectStyle = (() => {
    if (!start || !end) return null;
    const x = Math.min(start.x, end.x) * scale;
    const y = Math.min(start.y, end.y) * scale;
    const w = Math.abs(end.x - start.x) * scale;
    const h = Math.abs(end.y - start.y) * scale;
    return { left: x, top: y, width: w, height: h };
  })();

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex flex-col items-center justify-center"
      ref={containerRef}
    >
      <div className="text-white text-sm mb-2 text-center px-4">
        ✂️ Zaznacz fragment myszką (przeciągnij). Enter = wytnij, Esc = anuluj.
      </div>

      <div
        className="relative cursor-crosshair"
        style={{
          width: bitmap.width * scale,
          height: bitmap.height * scale,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: bitmap.width * scale,
            height: bitmap.height * scale,
            display: "block",
          }}
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
          onClick={onCancel}
          className="px-4 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
        >
          Anuluj (Esc)
        </button>
      </div>
    </div>
  );
}
