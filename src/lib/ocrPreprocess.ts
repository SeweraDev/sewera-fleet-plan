/**
 * Pre-processing obrazu przed Tesseract OCR.
 *
 * Cel: poprawa rozpoznawania drobnych liter/cyfr (B/8, I/1, O/0) i polskich znakow
 * diakrytycznych (ę, ć, ś) ktore Tesseract czesto myli przy niskiej rozdzielczosci.
 *
 * Algorytm:
 *  1. Skala 2× (max szerokosc 2400 px) — wyzsza rozdzielczosc pomaga OCR
 *  2. Grayscale (luma weights 0.299/0.587/0.114)
 *  3. Lekki contrast stretch — rozciaga histogram do pelnego zakresu [0, 255]
 *
 * Zwraca PNG Blob (lossless — wazne dla OCR, JPEG dawalby artefakty kompresji
 * wokol cienkich liter ktore Tesseract by myslil sa szumem).
 */

const MAX_W = 2400;

/**
 * Skleja kilka obrazow pionowo (jeden pod drugim) na jednym canvas.
 * Uzywane dla wielostronicowych dokumentow WZ — sprzedawca wkleja kolejne strony,
 * my je scalamy zanim wyslemy do OCR.
 *
 * Zwraca JPEG quality 0.85 (wyzsze niz archiwum bo to idzie do OCR + archiwum).
 */
export async function mergePagesVertically(pages: (File | Blob)[]): Promise<Blob | null> {
  if (pages.length === 0) return null;
  if (pages.length === 1) {
    // Single page — zwroc jako jest (oszczednosc CPU)
    return pages[0] instanceof Blob ? pages[0] : null;
  }
  try {
    const urls = pages.map((p) => URL.createObjectURL(p));
    try {
      const images = await Promise.all(
        urls.map(
          (url) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = (e) => reject(e);
              img.src = url;
            }),
        ),
      );

      const maxWidth = Math.max(...images.map((img) => img.width));
      const totalHeight = images.reduce((sum, img) => sum + img.height, 0);

      const canvas = document.createElement("canvas");
      canvas.width = maxWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      // Bialy background (gdyby strona miala przezroczystosc)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, maxWidth, totalHeight);

      // Rysuj kazdy obraz pod spodem, wycentruj poziomo
      let y = 0;
      for (const img of images) {
        const x = Math.floor((maxWidth - img.width) / 2);
        ctx.drawImage(img, x, y);
        y += img.height;
      }

      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
      });
    } finally {
      urls.forEach((url) => URL.revokeObjectURL(url));
    }
  } catch (err) {
    console.warn("[mergePagesVertically] failed:", err);
    return null;
  }
}

export async function preprocessForOCR(input: File | Blob): Promise<Blob | null> {
  try {
    const url = URL.createObjectURL(input);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = (e) => reject(e);
        el.src = url;
      });

      // Skala 2× ale nie wieksza niz MAX_W (zabezpieczenie pamieci dla duzych screencow)
      const targetScale = Math.min(2, MAX_W / img.width);
      const w = Math.round(img.width * targetScale);
      const h = Math.round(img.height * targetScale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // imageSmoothingQuality 'high' = bicubic-like, lepsze niz default 'low'
      (ctx as any).imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);

      // Grayscale + contrast stretch
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      // Pierwszy przebieg: konwersja do grayscale + znalezienie min/max do stretch
      let min = 255;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(
          0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
        );
        data[i] = data[i + 1] = data[i + 2] = gray;
        if (gray < min) min = gray;
        if (gray > max) max = gray;
      }

      // Drugi przebieg: contrast stretch — rozciagniecie [min, max] do [0, 255]
      // Tylko gdy histogram jest scisniety (bez tego mogibysmy zniszczyc dobrze
      // skontrastowane obrazy)
      const range = max - min;
      if (range > 20 && range < 220) {
        const scale = 255 / range;
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.max(0, Math.min(255, Math.round((data[i] - min) * scale)));
          data[i] = data[i + 1] = data[i + 2] = v;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.warn("[ocrPreprocess] failed:", err);
    return null;
  }
}
