"use client";
// The panel on the big screen: whose gift this is, one line asking people to
// scan, the QR code that opens the garden with the party code, and the live
// tally of seeds planted (SeedFeed). Sized in "1080p pixels" (party.css
// --px), so it reads the same from across the room on a 1080p or a 4K
// screen, inside the title-safe margins. Without a party code in the screen's
// address it shows the operator a gentle note instead of a code that could
// not plant anything.
//
// As it lays out, the panel tells the camera how far to slide the lens so the
// rose sits in the open part of the screen (logic.ts lensShift).
import { useLayoutEffect, useRef } from "react";
import { gardenLink, lensShift, OWNER, PARTY_CODE_MAX, typedLink, type PartyCode } from "@/components/party/logic";
import { QrCode } from "@/components/party/QrCode";
import { SeedFeed } from "@/components/party/SeedFeed";
import { party } from "@/components/party/store";

/** A rosebud on a fine gold rule: the panel's crest. Original art. */
function Crest() {
  return (
    <svg className="party-crest" viewBox="0 0 220 26" aria-hidden="true">
      <defs>
        <linearGradient id="party-crest-l" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e8c480" stopOpacity="0" />
          <stop offset="1" stopColor="#e8c480" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id="party-crest-r" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="#e8c480" stopOpacity="0" />
          <stop offset="1" stopColor="#e8c480" stopOpacity="0.75" />
        </linearGradient>
        <radialGradient id="party-crest-bud" cx="50%" cy="38%" r="70%">
          <stop offset="0" stopColor="#ff8a9a" />
          <stop offset="0.6" stopColor="#d61f36" />
          <stop offset="1" stopColor="#8e0f24" />
        </radialGradient>
      </defs>
      <path d="M6 15.5 H88" stroke="url(#party-crest-l)" strokeWidth="1" />
      <path d="M132 15.5 H214" stroke="url(#party-crest-r)" strokeWidth="1" />
      <path d="M110 24 V16" stroke="#c9a866" strokeWidth="1" strokeLinecap="round" />
      <path d="M109.6 19 C102.5 19.4 96.5 16.8 93 12.4 C100.6 11.6 106.6 14.4 109.6 19 Z" fill="#c9a866" opacity="0.9" />
      <path d="M110.4 19 C117.5 19.4 123.5 16.8 127 12.4 C119.4 11.6 113.4 14.4 110.4 19 Z" fill="#c9a866" opacity="0.9" />
      <path d="M110 2.6 C115.4 5.4 116 11.6 110 16.4 C104 11.6 104.6 5.4 110 2.6 Z" fill="url(#party-crest-bud)" />
      <path d="M110.2 5.4 C112.6 7.6 112.8 11.4 110.4 14.6" fill="none" stroke="#ffc2cb" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function SetupNote({ kind }: { kind: "missing" | "too_long" }) {
  return (
    <div className="party-setup" role="note">
      <p className="party-setup-title">{kind === "missing" ? "Add the party code" : "That party code is too long"}</p>
      {kind === "missing" ? (
        <p className="party-setup-body">
          Open this screen as <span className="party-setup-path">/party?code=</span> followed by the party code, and the QR code will
          appear here.
        </p>
      ) : (
        <p className="party-setup-body">
          The garden accepts codes of up to {PARTY_CODE_MAX} characters. Check the code in this screen&rsquo;s address.
        </p>
      )}
    </div>
  );
}

export function GiftPanel({ code, show }: { code: PartyCode | null; show: boolean }) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // offsetLeft/Top ignore the panel's own entrance transform, so the lens aims for where it settles
      const s = lensShift(
        { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      party.set({ shiftX: s.x, shiftY: s.y });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const link = code?.kind === "ok" ? gardenLink(code.code) : null;

  return (
    <aside ref={ref} className={`party-panel${show ? " party-panel-on" : ""}`} aria-hidden={!show}>
      <Crest />
      <h1 className="party-title">
        A gift from <span className="party-title-name">{OWNER.name}</span>
      </h1>
      <p className="party-invite">Scan to choose your seed and plant it</p>
      {link ? (
        <>
          <div className="party-qr">
            <QrCode value={link} label="QR code that opens the garden to plant your seed" className="party-qr-code" />
          </div>
          <p className="party-link">{typedLink(link)}</p>
        </>
      ) : code && code.kind !== "ok" ? (
        <SetupNote kind={code.kind} />
      ) : (
        <div className="party-qr party-qr-waiting" />
      )}
      <div className="party-rule" aria-hidden="true" />
      <SeedFeed />
    </aside>
  );
}
