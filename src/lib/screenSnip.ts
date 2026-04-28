/**
 * Screen Snip — przechwytywanie fragmentu ekranu jako obraz.
 * Workflow:
 *   1. captureScreen() → user widzi popup browsera "Udostępnij okno",
 *      wybiera np. okno z dokumentem WZ
 *   2. Bierzemy 1 klatke z video stream → canvas
 *   3. Zatrzymujemy stream (zwalnia indykator nagrywania)
 *   4. Zwracamy ImageBitmap + wymiary do dalszego cropping
 *
 * cropToBlob() — wyciecie prostokata z ImageBitmap do JPEG Blob.
 */

export interface CapturedFrame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * Wywoluje getDisplayMedia, zatrzymuje stream po wziecu klatki.
 * Throw error gdy user odmowi udostepnienia.
 */
export async function captureScreen(): Promise<CapturedFrame | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Twoja przeglądarka nie wspiera Screen Capture API");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "window" } as any,
    audio: false,
  });
  try {
    const track = stream.getVideoTracks()[0];
    // ImageCapture API jest dostepne w Chrome/Edge; fallback przez video element.
    const ICAP = (window as any).ImageCapture;
    if (ICAP) {
      const imgCapture = new ICAP(track);
      const bitmap: ImageBitmap = await imgCapture.grabFrame();
      return { bitmap, width: bitmap.width, height: bitmap.height };
    }
    // Fallback: video element + drawImage do canvas → ImageBitmap
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 100)); // poczekaj na 1 klatke
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } finally {
    // Zatrzymaj wszystkie tracki — koniec udostepniania
    stream.getTracks().forEach((t) => t.stop());
  }
}

/**
 * Wycina prostokat z ImageBitmap i zwraca JPEG Blob.
 * Wspolrzedne w pixelach oryginalnego obrazu (nie wyswietlanego overlaya).
 */
export async function cropToBlob(
  bitmap: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<Blob | null> {
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
}
