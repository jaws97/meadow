"use client";
// A small modal for the moments that need an answer or a moment's reading (switching gardens on a shared device, a
// replaced garden link, a fresh link). Rendered into the body so no layer of the garden can sit over it; focus moves
// in when it opens, stays inside while it is open, and goes back where it was when it closes, or, when that element
// has gone in the meantime (a menu that closed as the dialog opened), to `returnFocus`. Escape closes it when the
// dialog has a gentle way out (onClose).
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { display } from "@/components/gift/fonts";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

export function Dialog({
  label,
  onClose,
  returnFocus,
  children,
}: {
  label: string;
  onClose?: () => void;
  /** where focus goes on close when the element focused before the dialog is no longer on the page */
  returnFocus?: () => HTMLElement | null | undefined;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const fallback = useRef(returnFocus);
  useEffect(() => {
    close.current = onClose;
    fallback.current = returnFocus;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(".gift-primary") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && close.current) {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = before && before !== document.body && before.isConnected ? before : fallback.current?.();
      back?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className={`gift-root ${display.variable}`}>
      <div className="gift-dialog-backdrop">
        <div ref={box} className="gift-dialog" role="dialog" aria-modal="true" aria-label={label}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
