// Copying the personal garden link. The async Clipboard API first; where it is missing or refused (plain http, an
// embedded browser, a permission prompt dismissed) the old select-and-copy on a hidden field; and if both fail the
// caller shows the link selected so the person can copy it by hand.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused: try the older way
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "0";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Whether this browser can hand the link to another app (a phone's share sheet: mail, chat, notes). */
export function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Opens the share sheet; false when the person closed it or sharing failed. */
export async function shareLink(url: string, title: string): Promise<boolean> {
  try {
    await navigator.share({ title, url });
    return true;
  } catch {
    return false;
  }
}
