/**
 * Archiwum WZ — konwersja PDF strony 1 do JPEG i upload do Supabase Storage.
 *
 * Bucket: wz-archiwum (private)
 * Format sciezki: YYYY-MM/{wz_id}.jpg
 * Polityka archiwum: biezacy miesiac + poprzedni (starsze foldery sa czyszczone)
 */
import { supabase } from "@/integrations/supabase/client";

export const BUCKET_NAME = "wz-archiwum";

// pdfjs-dist lazy load (tak jak w ModalImportWZ)
let pdfjsLib: typeof import("pdfjs-dist") | null = null;
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

/**
 * Renderuje pierwsza strone PDF do JPEG Blob (niska jakosc, do podgladu).
 * @deprecated Uzywaj pdfToJpegBlobs (multi-page).
 */
export async function pdfToJpegBlob(file: File): Promise<Blob | null> {
  const blobs = await pdfToJpegBlobs(file);
  return blobs[0] || null;
}

/**
 * Renderuje WSZYSTKIE strony PDF do JPEG Blob'ow (po jednym na strone).
 * Skala 1.5 = ~900px szerokosci dla A4 — kompromis miedzy ostroscia a rozmiarem.
 * Zwraca pusta tablice jesli render sie nie powiedzie (nie blokuje importu).
 */
export async function pdfToJpegBlobs(file: File): Promise<Blob[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getPdfjs();
    const pdfDoc = await pdf.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

    const blobs: Blob[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      try {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        // Bialy background (niektore PDFy maja transparentne tlo)
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7);
        });
        if (blob) blobs.push(blob);
      } catch (pageErr) {
        console.warn(`[archiwumWZ] render strony ${i} failed:`, pageErr);
      }
    }
    try { pdfDoc.destroy(); } catch { /* ignore */ }
    return blobs;
  } catch (err) {
    console.error("[archiwumWZ] pdfToJpegBlobs failed:", err);
    return [];
  }
}

/**
 * Konwertuje obraz (File lub Blob: PNG/JPG/WebP) do skompresowanego JPEG.
 * - Skaluje do max 1200px szerokosci (zachowujac proporcje)
 * - JPEG quality 0.6
 * - Bialy background dla obrazkow z przezroczystoscia (PNG)
 *
 * Uzywane przy archiwizacji WZ z OCR (skan/screenshot/wklejenie ze schowka).
 */
export async function imageToJpegBlob(input: File | Blob): Promise<Blob | null> {
  try {
    const url = URL.createObjectURL(input);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = (e) => reject(e);
        el.src = url;
      });

      const MAX_W = 1200;
      const scale = img.width > MAX_W ? MAX_W / img.width : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.6);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error("[archiwumWZ] imageToJpegBlob failed:", err);
    return null;
  }
}

/**
 * Generuje sciezke archiwum (single-page legacy): YYYY-MM/{wz_id}.jpg
 * Uzywane dla obrazow z OCR (skan/foto/clipboard) — zawsze 1 strona.
 */
export function buildArchiwumPath(wzId: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}/${wzId}.jpg`;
}

/**
 * Generuje sciezke archiwum dla strony wielo-stronicowego PDF:
 * YYYY-MM/{wz_id}/strona_N.jpg (N = 1, 2, 3, ...)
 */
export function buildArchiwumPathPage(wzId: string, pageIdx: number, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}/${wzId}/strona_${pageIdx + 1}.jpg`;
}

/**
 * Upload JPEG do Supabase Storage. Zwraca path lub null przy bledzie.
 */
export async function uploadArchiwumJpeg(
  wzId: string,
  blob: Blob
): Promise<string | null> {
  try {
    const path = buildArchiwumPath(wzId);
    const { error } = await supabase.storage.from(BUCKET_NAME).upload(path, blob, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) {
      console.error("[archiwumWZ] upload failed:", error);
      return null;
    }
    return path;
  } catch (err) {
    console.error("[archiwumWZ] upload exception:", err);
    return null;
  }
}

/**
 * Generuje signed URL (15 min) do podgladu obrazka.
 */
export async function getArchiwumSignedUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(path, 60 * 15);
    if (error || !data) {
      console.error("[archiwumWZ] signed url failed:", error);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.error("[archiwumWZ] signed url exception:", err);
    return null;
  }
}

/**
 * Helper: konwertuje WSZYSTKIE strony PDF + uploaduje + zwraca path do PIERWSZEJ strony.
 * Path do pierwszej strony jest zapisywany w `zlecenia_wz.archiwum_path` jako referencja —
 * `listArchiwumPages()` rozwija go do listy wszystkich stron przez listowanie folderu.
 *
 * Format: YYYY-MM/{wzId}/strona_N.jpg (multi-page) — strona_1, strona_2, ...
 *
 * Wszystko w tle, nie throw. Zwraca null gdy zaden upload sie nie powiodl.
 */
export async function archiwizujWZ(wzId: string, file: File): Promise<string | null> {
  const blobs = await pdfToJpegBlobs(file);
  if (blobs.length === 0) return null;

  let firstPath: string | null = null;
  for (let i = 0; i < blobs.length; i++) {
    const path = buildArchiwumPathPage(wzId, i);
    try {
      const { error } = await supabase.storage.from(BUCKET_NAME).upload(path, blobs[i], {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (error) {
        console.error(`[archiwumWZ] upload strony ${i + 1} failed:`, error);
        continue;
      }
      if (i === 0) firstPath = path;
    } catch (err) {
      console.error(`[archiwumWZ] upload strony ${i + 1} exception:`, err);
    }
  }
  return firstPath;
}

/**
 * Listuje wszystkie strony archiwum dla danego archiwum_path.
 * - Multi-page (nowy format): "YYYY-MM/{wzId}/strona_1.jpg" → ["YYYY-MM/{wzId}/strona_1.jpg",
 *   "YYYY-MM/{wzId}/strona_2.jpg", ...] (z listowania folderu, posortowane)
 * - Single (legacy/OCR): "YYYY-MM/{wzId}.jpg" → ten sam path w 1-elementowej tablicy
 */
export async function listArchiwumPages(archiwumPath: string): Promise<string[]> {
  if (!archiwumPath) return [];
  // Multi-page: zawiera "/strona_N.jpg" — wyciagamy folder i listujemy
  const multiMatch = archiwumPath.match(/^(.+)\/strona_\d+\.jpg$/);
  if (multiMatch) {
    const folder = multiMatch[1];
    try {
      const { data, error } = await supabase.storage.from(BUCKET_NAME).list(folder, { limit: 100 });
      if (error || !data) return [archiwumPath];
      const pages = data
        .filter((f: any) => /^strona_\d+\.jpg$/.test(f.name))
        .map((f: any) => `${folder}/${f.name}`)
        .sort((a, b) => {
          // Sortuj numerycznie po numerze strony (zeby strona_2 byla przed strona_10)
          const ai = parseInt(a.match(/strona_(\d+)/)?.[1] || "0", 10);
          const bi = parseInt(b.match(/strona_(\d+)/)?.[1] || "0", 10);
          return ai - bi;
        });
      return pages.length > 0 ? pages : [archiwumPath];
    } catch (err) {
      console.warn("[archiwumWZ] listArchiwumPages failed:", err);
      return [archiwumPath];
    }
  }
  // Legacy single-page: zwroc ten sam path
  return [archiwumPath];
}

/**
 * Helper: archiwum z obrazu (OCR ze skanu/screenshota/wklejenia ze schowka).
 * Wejscie: File (drag-drop, kamera) lub Blob (clipboard paste).
 */
export async function archiwizujWZObraz(wzId: string, input: File | Blob): Promise<string | null> {
  const blob = await imageToJpegBlob(input);
  if (!blob) return null;
  return await uploadArchiwumJpeg(wzId, blob);
}

/**
 * Lista folderow miesiecznych ktore powinny byc usuniete (starsze niz currentMonth - 1).
 * Format folderu: YYYY-MM
 */
export function staleFolders(allFolders: string[], now: Date = new Date()): string[] {
  const currYear = now.getFullYear();
  const currMonth = now.getMonth() + 1; // 1-12

  // Granica: poprzedni miesiac (wszystko starsze = stale)
  let limitYear = currYear;
  let limitMonth = currMonth - 1;
  if (limitMonth < 1) {
    limitMonth = 12;
    limitYear -= 1;
  }
  const limit = limitYear * 12 + limitMonth;

  return allFolders.filter((name) => {
    const m = name.match(/^(\d{4})-(\d{2})$/);
    if (!m) return false;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    return y * 12 + mo < limit;
  });
}

/**
 * Sprzata bucket: usuwa pliki z folderow starszych niz currentMonth - 1.
 * Wywolywane raz dziennie z Dashboardu dyspozytora (sessionStorage flag).
 * Zwraca liczbe usunietych plikow lub null przy bledzie.
 */
export async function sprzatnijArchiwumWZ(): Promise<number | null> {
  try {
    // Listuj folder root - dostaniemy podfoldery YYYY-MM
    const { data: rootEntries, error: rootErr } = await supabase.storage
      .from(BUCKET_NAME)
      .list("", { limit: 100 });
    if (rootErr) {
      console.warn("[archiwumWZ cleanup] list root failed:", rootErr.message);
      return null;
    }

    // Storage list zwraca pliki I foldery — folder jest gdy id == null
    const folders = (rootEntries || [])
      .filter((e: any) => !e.metadata && /^\d{4}-\d{2}$/.test(e.name))
      .map((e: any) => e.name);

    const stale = staleFolders(folders);
    if (stale.length === 0) return 0;

    let totalRemoved = 0;
    for (const folder of stale) {
      // Listuj pliki w folderze
      const { data: files, error: lsErr } = await supabase.storage
        .from(BUCKET_NAME)
        .list(folder, { limit: 1000 });
      if (lsErr) {
        console.warn(`[archiwumWZ cleanup] list ${folder} failed:`, lsErr.message);
        continue;
      }
      const paths = (files || []).map((f: any) => `${folder}/${f.name}`);
      if (paths.length === 0) continue;

      const { error: rmErr } = await supabase.storage.from(BUCKET_NAME).remove(paths);
      if (rmErr) {
        console.warn(`[archiwumWZ cleanup] remove ${folder} failed:`, rmErr.message);
        continue;
      }
      totalRemoved += paths.length;
      console.log(`[archiwumWZ cleanup] usunieto ${paths.length} plikow z ${folder}`);
    }
    return totalRemoved;
  } catch (err) {
    console.warn("[archiwumWZ cleanup] exception:", err);
    return null;
  }
}
