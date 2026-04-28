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
 * Zwraca null jesli render sie nie powiedzie (nie blokuje importu).
 */
export async function pdfToJpegBlob(file: File): Promise<Blob | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getPdfjs();
    const pdfDoc = await pdf.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const page = await pdfDoc.getPage(1);

    // Scale 1.2 = ~720px szerokosci dla A4 - wystarczy do podgladu, lekkie
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Bialy background (niektore PDFy maja transparentne tlo)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.6);
    });
  } catch (err) {
    console.error("[archiwumWZ] pdfToJpegBlob failed:", err);
    return null;
  }
}

/**
 * Generuje sciezke archiwum: YYYY-MM/{wz_id}.jpg
 */
export function buildArchiwumPath(wzId: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}/${wzId}.jpg`;
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
 * Helper: konwertuje + uploaduje + zwraca path. Wszystko w tle, nie throw.
 */
export async function archiwizujWZ(wzId: string, file: File): Promise<string | null> {
  const blob = await pdfToJpegBlob(file);
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
