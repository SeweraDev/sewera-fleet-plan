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
  console.log("[screenSnip] start");
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Twoja przeglądarka nie wspiera Screen Capture API");
  }
  // Detekcja iframe — Lovable preview ma aplikacje w iframe, w ktorym getDisplayMedia
  // moze nie dzialac jesli iframe nie ma allow="display-capture".
  const inIframe = window.self !== window.top;
  if (inIframe) {
    console.warn("[screenSnip] aplikacja jest w iframe — getDisplayMedia moze byc zablokowany. Otworz w nowej karcie.");
  }
  console.log("[screenSnip] wywoluje getDisplayMedia...");
  // displaySurface jako preferencja (advanced) — Firefox nie zawsze radzi sobie z mandatory.
  // Bez tego user widzi pelny picker (Caly ekran / Okno / Karta) i sam wybiera.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (e: any) {
    console.error("[screenSnip] getDisplayMedia rzucil:", e?.name, e?.message);
    if (inIframe && e?.name !== "NotAllowedError") {
      throw new Error("Nie udalo sie udostepnic ekranu. Aplikacja jest w iframe (Lovable preview) — otworz w nowej karcie (przycisk ↗).");
    }
    throw e;
  }
  console.log("[screenSnip] stream OK, tracks:", stream.getVideoTracks().length);
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error("Stream bez video tracks (przegladarka odmowila lub iframe blokuje)");
    }
    const settings = track.getSettings?.() ?? {};
    console.log("[screenSnip] track settings:", settings);
    // ImageCapture API jest dostepne w Chrome/Edge; w Firefox brak — fallback przez video element.
    const ICAP = (window as any).ImageCapture;
    if (ICAP) {
      try {
        console.log("[screenSnip] proba ImageCapture.grabFrame()");
        const imgCapture = new ICAP(track);
        const bitmap: ImageBitmap = await imgCapture.grabFrame();
        console.log("[screenSnip] grabFrame OK:", bitmap.width, "x", bitmap.height);
        if (bitmap.width > 0 && bitmap.height > 0) {
          return { bitmap, width: bitmap.width, height: bitmap.height };
        }
        console.warn("[screenSnip] ImageCapture zwrocil pusta klatke, fallback do video");
      } catch (e) {
        console.warn("[screenSnip] ImageCapture rzucil, fallback do video:", e);
      }
    } else {
      console.log("[screenSnip] brak ImageCapture API — fallback do video element");
    }
    // Fallback: video element + drawImage do canvas → ImageBitmap
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    // Niektore przegladarki nie odtwarzaja video oderwanego od DOM — ukrywamy poza viewportem.
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    document.body.appendChild(video);
    try {
      // Poczekaj na metadata, zeby videoWidth/Height byly != 0
      console.log("[screenSnip] readyState before metadata wait:", video.readyState);
      if (video.readyState < 1) {
        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => { console.log("[screenSnip] loadedmetadata"); cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error("Blad ladowania metadanych video")); };
          const cleanup = () => {
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("error", onError);
          };
          video.addEventListener("loadedmetadata", onLoaded, { once: true });
          video.addEventListener("error", onError, { once: true });
          // Bezpieczny timeout
          setTimeout(() => { cleanup(); reject(new Error("Timeout (metadata 5s)")); }, 5000);
        });
      }
      console.log("[screenSnip] play()");
      await video.play();
      console.log("[screenSnip] czekam na pierwsza klatke...");
      // Poczekaj na pierwsza realna klatke (rVFC) lub fallback krotki delay
      await new Promise<void>((resolve) => {
        const v: any = video;
        if (typeof v.requestVideoFrameCallback === "function") {
          v.requestVideoFrameCallback(() => resolve());
          // Bezpieczny timeout — gdyby rVFC nigdy nie odpalil
          setTimeout(resolve, 600);
        } else {
          setTimeout(resolve, 250);
        }
      });
      const w = video.videoWidth;
      const h = video.videoHeight;
      console.log("[screenSnip] videoWidth/Height:", w, "x", h);
      if (w === 0 || h === 0) {
        throw new Error("Pusta klatka video (videoWidth/Height = 0). Mozliwa przyczyna: aplikacja desktopowa z hardware acceleration nie jest capture'owalna przez Firefox. Sprobuj wybrac 'Caly ekran' zamiast okna.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);
      const bitmap = await createImageBitmap(canvas);
      console.log("[screenSnip] OK:", bitmap.width, "x", bitmap.height);
      return { bitmap, width: bitmap.width, height: bitmap.height };
    } finally {
      try { video.pause(); } catch { /* noop */ }
      video.srcObject = null;
      if (video.parentNode) video.parentNode.removeChild(video);
    }
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
