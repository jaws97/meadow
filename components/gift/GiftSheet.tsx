"use client";
// The glass sheet the gift flow lives in: docked at the bottom on phones and portrait iPads, beside the flower on a
// laptop or a landscape iPad (gift.css), with a scrolling body and a footer for the step's buttons. On phones it rides
// above the on-screen keyboard: while one is up, the dock is laid in the visual viewport, the part of the page still
// in sight (viewport.ts keyboardBox), so the name field and its button stay in view whatever the browser does to the
// rest of the page.
//
// Rendered into the body, as the dialogs are: the garden page's <main> is its own stacking context, so anything laid
// over the whole page from the body (the care layer's soft night while a plant is swapped) would otherwise cover the
// sheet whatever its z-index. The sheet only ever renders in the browser (the door decides after load).
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { display } from "@/components/gift/fonts";
import { keyboardBox } from "@/components/gift/viewport";

export function GiftSheet({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  const dock = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = dock.current;
    if (!vv || !el) return;
    const update = () => {
      const active = document.activeElement;
      const writing = el.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
      // a pinch-zoom shrinks the visual viewport too: only a field being written in brings the keyboard
      const box = writing && vv.scale <= 1.01 ? keyboardBox(window.innerHeight, vv) : null;
      if (!box) {
        delete el.dataset.kb;
        return;
      }
      el.dataset.kb = "";
      el.style.setProperty("--gift-vv-top", `${box.top}px`);
      el.style.setProperty("--gift-vv-h", `${box.height}px`);
    };
    // a field taking or leaving focus starts the keyboard moving: look again once it has
    const soon = () => window.setTimeout(update, 350);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    el.addEventListener("focusin", soon);
    el.addEventListener("focusout", soon);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      el.removeEventListener("focusin", soon);
      el.removeEventListener("focusout", soon);
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
