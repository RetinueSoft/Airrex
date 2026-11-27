// Reads a passport photo in the browser: the image never leaves the device.
// Tesseract OCR (loaded on demand; its program and English model are downloaded once from the jsDelivr CDN)
// reads the two MRZ lines at the bottom of the photo page, then shared/mrz.ts checks them.

import { parsePassportMrz, type MrzResult } from '../../shared/mrz.ts';

const MRZ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Crop part of the image (fractions of height), enlarge it and boost contrast for OCR. */
function prepare(img: ImageBitmap | HTMLImageElement, fromY: number, toY: number): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;
  const sy = Math.round(h * fromY);
  const sh = Math.round(h * (toY - fromY));
  const scale = Math.min(3, 2000 / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, sy, w, sh, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = g < 110 ? 0 : g > 170 ? 255 : (g - 110) * 4.25; // push towards black/white
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export type ScanProgress = (message: string) => void;

/** Read the passport's MRZ from a photo. Returns null when it couldn't be found. */
export async function scanPassportPhoto(file: File, onProgress?: ScanProgress): Promise<MrzResult | null> {
  onProgress?.('Loading the passport reader…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(`Reading the passport… ${Math.round(m.progress * 100)}%`);
      else if (m.status.startsWith('loading')) onProgress?.('Loading the passport reader…');
    },
  });
  try {
    await worker.setParameters({ tessedit_char_whitelist: MRZ_CHARS });
    const img = await loadImage(file);
    // The MRZ is at the bottom of the photo page; try the bottom part first, then the whole photo.
    let best: MrzResult | null = null;
    for (const [from, to] of [
      [0.6, 1],
      [0.4, 1],
      [0, 1],
    ] as const) {
      const { data } = await worker.recognize(prepare(img, from, to));
      const result = parsePassportMrz(data.text);
      if (result?.valid && !result.nameUnsure) return result;
      if (result?.valid && (!best || !best.valid)) best = result;
      best ??= result;
    }
    return best;
  } finally {
    await worker.terminate();
  }
}
