"use client";
// The glass sheet the gift flow lives in: docked at the bottom on phones and portrait iPads, beside the flower on a
// laptop or a landscape iPad (gift.css), with a scrolling body and a footer for the step's buttons. On phones it rides
// above the on-screen keyboard: the visual viewport says how much of the screen the keyboard took, and the dock lifts
// by that much, so the name field and its button stay in view.
//
// Rendered into the body, as the dialogs are: the garden page's <main> is its own stacking context, so anything laid
// over the whole page from the body (the care layer's soft night while a plant is swapped) would otherwise cover the
// sheet whatever its z-index. The sheet only ever renders in the browser (the door decides after load).
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { display } from "@/components/gift/fonts";

export function GiftSheet({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  const dock = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = dock.current;
    if (!vv || !el) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // small differences are browser toolbars moving, not a keyboard
      el.style.setProperty("--gift-kb", covered > 80 ? `${Math.round(covered)}px` : "0px");
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return createPortal(
    <div className={`gift-root ${display.variable}`}>
      <div ref={dock} className="gift-dock">
        <section className="gift-sheet" aria-label={label}>
          <div className="gift-sheet-body">{children}</div>
          {foot && <div className="gift-sheet-foot">{foot}</div>}
        </section>
      </div>
    </div>,
    document.body,
  );
}
