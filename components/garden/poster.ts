// The garden as this device last saw it: a small still kept in the browser
// and laid, softly blurred, behind the loading veil's sprout on the next
// visit, so a returning colleague sees their own garden in the first instant
// and the live canvas dissolves over it as the veil lifts.
//
// Why a remembered still rather than pictures shipped with the site: every
// colleague's garden is their own (their species, how far it has grown,
// which side the lantern stands), and it is day or night with Bangalore's
// clock, so a stock picture would show most people somebody else's flower.
// A still is only used when it still tells the truth: the same plant at the
// same stage, the same screen shape, the same light, and not too old.
//
// Browser storage is a convenience here, never state: if it is missing,
// full or blocked the veil simply shows its own night garden.

const KEY = "garden-poster:v1";
/** The still's long side, in pixels: enough for a blurred backdrop, small enough to store (about 30 KB). */
const LONG_SIDE = 480;
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;

/** Screen shapes a still is shared between: tall phone, tablet portrait, square-ish, laptop, wide. */
const SHAPES = [0.46, 0.75, 1.15, 1.5, 1.78, 2.3] as const;

export type Light = "day" | "dusk" | "night";

interface Stored {
  shape: number;
  light: Light;
  look: string;
  at: number;
  url: string;
}

/** What the still must match: whose plant, which species, and how far it has grown and bloomed. */
export function lookOf(s: { seed: string; speciesId: string; growth: number; bloom: number; health: number }): string {
  return `${s.seed}|${s.speciesId}|${Math.round(s.growth * 20)}|${Math.round(s.bloom * 20)}|${Math.round(s.health * 5)}`;
}

export function shapeOf(w: number, h: number): number {
  const a = w / Math.max(1, h);
  let best: number = SHAPES[0];
  for (const s of SHAPES) if (Math.abs(Math.log(a / s)) < Math.abs(Math.log(a / best))) best = s;
  return best;
}

/** Day, dusk or night by the clock in Bangalore (UTC+5:30), with dusk wide enough to cover a November dawn and evening. */
export function lightNow(at = Date.now()): Light {
  const h = (((at / 3600000 + 5.5) % 24) + 24) % 24;
  if (h >= 7 && h < 17.2) return "day";
  if ((h >= 17.2 && h < 18.8) || (h >= 5.6 && h < 7)) return "dusk";
  return "night";
}

/** The still for this plant, screen and light, as a data URL, or null. */
export function readPoster(look: string): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (s.look !== look || s.light !== lightNow() || s.shape !== shapeOf(window.innerWidth, window.innerHeight)) return null;
    if (Date.now() - s.at > MAX_AGE_MS || typeof s.url !== "string" || !s.url.startsWith("data:image/")) return null;
    return s.url;
  } catch {
    return null;
  }
}

/** A still is being made: the next one waits for it (the governor asks every couple of minutes, so it simply comes later). */
let saving = false;

function store(still: Stored) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(still));
  } catch {
    // storage full or blocked: the veil shows its own art instead
  }
}

const dataUrlOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("no data url")));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Keeps a small copy of the frame just drawn. Must run in the task that drew
 * it (the canvas does not preserve its drawing buffer), so the governor calls
 * it from the frame loop after the composer.
 *
 * Made in one go, the copy froze the garden for a moment every two minutes of
 * a long visit (70-80 ms on an office laptop, more on a phone): reading the
 * frame back from the GPU, scaling it and encoding the JPEG all happened on
 * the main thread. Now the frame is only snapshotted in its own task
 * (createImageBitmap takes it as it is at the call, without waiting), and the
 * scaling and the encoding run off the main thread (an OffscreenCanvas's
 * convertToBlob); the still that is kept is the same. A browser without those
 * makes it the old way.
 */
export function savePoster(source: HTMLCanvasElement, look: string) {
  if (saving) return;
  const k = LONG_SIDE / Math.max(source.width, source.height);
  if (!(k > 0)) return;
  const w = Math.max(1, Math.round(source.width * Math.min(1, k)));
  const h = Math.max(1, Math.round(source.height * Math.min(1, k)));
  const meta = { shape: shapeOf(window.innerWidth, window.innerHeight), light: lightNow(), look, at: Date.now() };
  if (typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function") {
    let snapshot: Promise<ImageBitmap> | null = null;
    try {
      snapshot = createImageBitmap(source);
    } catch {
      // a canvas the browser will not snapshot: made the old way below
    }
    if (snapshot) {
      saving = true;
      void snapshot
        .then(async (bitmap) => {
          try {
            const off = new OffscreenCanvas(w, h);
            const ctx = off.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(bitmap, 0, 0, w, h);
            const blob = await off.convertToBlob({ type: "image/jpeg", quality: 0.72 });
            store({ ...meta, url: await dataUrlOf(blob) });
          } finally {
            bitmap.close();
          }
        })
        .catch(() => {
          // no still this time: the next one comes in a couple of minutes
        })
        .finally(() => {
          saving = false;
        });
      return;
    }
  }
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, w, h);
    store({ ...meta, url: c.toDataURL("image/jpeg", 0.72) });
  } catch {
    // a canvas that cannot be read: the veil shows its own art instead
  }
}
