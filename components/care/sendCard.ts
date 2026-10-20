// Sending the bloom card from the device: the phone's own share sheet with the picture (WhatsApp, Instagram, Messages,
// Save Image), or on a laptop the picture saved as a file. Nothing goes through the server; the message lives only in
// the picture.
//
// The share sheet must open inside the tap that asked for it (Safari allows about a second, and an await on the way, a
// font load or an encode, loses it), so the picture is encoded ahead, while the person writes, and Send hands over the
// file it already has; a tap that beats the last encode makes one on the spot, synchronously. With files, the link goes
// in the text, not as a url (Android has no field for one). On an iPhone, a picture sent with text can reach WhatsApp
// as the text alone, so there the picture goes by itself and the line with the link is put on the clipboard, to paste
// under it. A sheet closed without choosing is not a failure; one that cannot open falls back to saving the picture.
export type SendOutcome = "shared" | "cancelled" | "failed";

/** An iPhone or an iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Whether this browser can hand this picture to another app. */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** The picture as a JPEG file, encoded in the background (null when the browser cannot encode it). */
export function encodeCard(canvas: HTMLCanvasElement, name: string): Promise<File | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob ? new File([blob], name, { type: "image/jpeg" }) : null), "image/jpeg", 0.9);
    } catch {
      resolve(null);
    }
  });
}

/** The picture as a JPEG file, now: for a tap that came before the background encode finished. */
export function encodeCardNow(canvas: HTMLCanvasElement, name: string): File | null {
  try {
    const url = canvas.toDataURL("image/jpeg", 0.9);
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: "image/jpeg" });
  } catch {
    return null;
  }
}

/** Opens the share sheet with the picture. Call it straight from the tap, with nothing awaited first. */
export function shareCard(file: File, text: string): Promise<SendOutcome> {
  const ios = isIos();
  if (ios) void navigator.clipboard?.writeText(text).catch(() => {});
  return navigator.share(ios ? { files: [file] } : { files: [file], text }).then(
    () => "shared" as const,
    (e: unknown) => (e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "failed"),
  );
}

/** Saves the picture as a file (a laptop's downloads; on an iPhone, Files). */
export function saveCard(file: Blob, name: string): boolean {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // revoked later: Safari and Firefox read the file after the click returns
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}
