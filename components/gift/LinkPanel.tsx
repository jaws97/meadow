"use client";
// The personal garden link, offered so a colleague can open their garden on their other screens as well. The link is
// a key (whoever holds it can tend the garden), so the panel shows only its start, copies the whole of it, and on a
// phone can hand it to the share sheet to send to oneself. If the browser refuses the clipboard, the full link
// appears selected so it can be copied by hand. The server keeps only the link's hash, so this is the one moment it
// can be shown; a fresh one can always be made from the garden (IdentityMenu).
//
// The words name the screens this device is not: a laptop or an iPad from a phone, a laptop or a phone from an iPad,
// a phone or an iPad from a laptop.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { canShare, copyText, shareLink } from "@/components/gift/clipboard";
import { Check, LinkIcon, Share } from "@/components/gift/icons";
import { primaryTouch } from "@/lib/garden/device";

type Status = { tone: "good" | "plain"; text: string } | null;

const subscribeNever = () => () => {};
const serverFalse = () => false;

/** The other screens a colleague might open their garden on, from this one (lib/garden/device's phone or tablet test). */
function otherScreens(): string {
  if (!primaryTouch()) return "your phone or iPad";
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return shortSide < 600 ? "your laptop or iPad" : "your laptop or phone";
}
const serverOtherScreens = () => "another device";

/** "growmyflower.vercel.app/garden#k=Ab3dE…": enough to recognise, not enough to use. */
function maskLink(link: string): string {
  try {
    const url = new URL(link);
    const k = new URLSearchParams(url.hash.slice(1)).get("k") ?? "";
    return `${url.host}${url.pathname}#k=${k.slice(0, 5)}…`;
  } catch {
    return link.slice(0, 32) + "…";
  }
}

export function LinkPanel({
  link,
  variant,
  flowerName,
  rehearsal = false,
}: {
  link: string;
  /** first: after planting; fresh: one more link; only: the one link left after "Sign out other devices" */
  variant: "first" | "fresh" | "only";
  /** the species name, for "your Sundrop is there too" */
  flowerName?: string;
  rehearsal?: boolean;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const full = useRef<HTMLTextAreaElement>(null);
  const shareable = useSyncExternalStore(subscribeNever, canShare, serverFalse);
  const others = useSyncExternalStore(subscribeNever, otherScreens, serverOtherScreens);

  useEffect(() => {
    if (!manual) return;
    full.current?.focus();
    full.current?.select();
  }, [manual]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    if (await copyText(link)) {
      setCopied(true);
      setManual(false);
      setStatus({ tone: "good", text: "Copied. Keep it somewhere safe, like a note or a message to yourself." });
    } else {
      setManual(true);
      setStatus({ tone: "plain", text: "Your browser kept the clipboard closed. The link is selected below, so you can copy it by hand." });
    }
  }

  async function share() {
    if (await shareLink(link, "My garden")) setStatus({ tone: "good", text: `Sent. Open it on ${others} whenever you like.` });
  }

  const flower = flowerName ? `your ${flowerName}` : "your flower";
  return (
    <div className="gift-link">
      <h3 className="gift-h3">
        {variant === "first" ? `Open your garden on ${others}` : variant === "fresh" ? "A fresh link to your garden" : "Your new garden link"}
      </h3>
      <p className="gift-text">
        {variant === "first"
          ? `This is your personal garden link. Open it on another screen and ${flower} is there too.`
          : variant === "fresh"
            ? `Open it on ${others} and your flower is there too. Your recent links keep working too.`
            : `Your old links no longer open anything. This one does: open it on ${others} and your flower is there too.`}
      </p>
      <p className="gift-note" style={{ marginTop: 6 }}>
        Keep it to yourself: anyone with the link can tend your garden.
      </p>
      <div className="gift-link-url" aria-label="Your garden link, shortened">
        <LinkIcon size={16} />
        <span>{maskLink(link)}</span>
      </div>
      {manual && (
        <textarea
          ref={full}
          className="gift-link-full"
          readOnly
          rows={3}
          value={link}
          aria-label="Your garden link"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <div className="gift-link-row">
        <button type="button" className="gift-secondary gift-link-copy" onClick={copy}>
          {copied ? <Check size={16} /> : <LinkIcon size={16} />}
          {copied ? "Copied" : "Copy link"}
        </button>
        {shareable && (
          <button type="button" className="gift-secondary gift-link-copy" onClick={share}>
            <Share size={16} />
            Send to myself
          </button>
        )}
      </div>
      <p className="gift-link-status" role="status" aria-live="polite" data-tone={status?.tone ?? "plain"}>
        {status?.text ?? (variant === "first" ? "Lost it later? You can make a fresh link from your garden." : "")}
      </p>
      {rehearsal && <p className="gift-practice">A practice planting, kept apart from the real Meadow</p>}
    </div>
  );
}
