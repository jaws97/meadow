"use client";
// The six seed packets as cards: a render of each flower in bloom, its name and a one-line character drawn from the
// plant model (components/gift/species.ts), and under the cards the chosen one's fuller nature and the model's honest
// line about the real plant. The cards are native radio buttons, so arrow keys move between them, a screen reader
// hears "radio, 2 of 6", and the choice is plain to see. On a phone that fuller nature opens below the cards, out of
// sight, so a choice brings it gently into view when it is not already showing, as far as the chosen card itself can
// stay in view (the Plant button names the choice as well).
import Image from "next/image";
import { useEffect, useRef } from "react";
import { Check, TraitIcon } from "@/components/gift/icons";
import { SEED_PACKETS, packetOf } from "@/components/gift/species";
import type { SpeciesId } from "@/lib/plant/species";

/** How much of the chosen seed's nature must already show for the sheet to stay where it is. */
const SHOWING_PX = 96;
/** Room kept above the chosen card when the sheet scrolls. */
const CARD_MARGIN_PX = 10;

export function SeedPicker({ value, onChange }: { value: SpeciesId | null; onChange: (id: SpeciesId) => void }) {
  const chosen = value ? packetOf(value) : null;
  const about = useRef<HTMLDivElement>(null);
  const picked = useRef(false);

  // after a choice (not a restored one), once the fuller nature has rendered
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    const el = about.current;
    const scroller = el?.closest(".gift-sheet-body");
    const card = scroller?.querySelector('input[name="gift-seed"]:checked')?.closest(".gift-seed");
    if (!el || !scroller || !card) return;
    const view = scroller.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (box.top <= view.bottom - SHOWING_PX) return;
    // enough to show all of it, but never so far that the chosen card leaves the top
    const by = Math.min(box.bottom - view.bottom, card.getBoundingClientRect().top - view.top - CARD_MARGIN_PX);
    if (by <= 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollBy({ top: by, behavior: reduced ? "auto" : "smooth" });
  }, [value]);

  return (
    <>
      <fieldset className="gift-seeds">
        <legend className="gift-sr">Six seeds</legend>
        {SEED_PACKETS.map((p) => (
          <label key={p.id} className="gift-seed">
            <input
              type="radio"
              name="gift-seed"
              value={p.id}
              checked={value === p.id}
              onChange={() => {
                picked.current = true;
                onChange(p.id);
              }}
              aria-describedby={`gift-seed-char-${p.id}`}
            />
            <span className="gift-seed-check">
              <Check size={15} strokeWidth={2.2} />
            </span>
            <span className="gift-seed-art">
              <Image src={p.image} alt="" width={480} height={360} unoptimized loading="eager" />
            </span>
            <span className="gift-seed-name">{p.name}</span>
            <span className="gift-seed-char" id={`gift-seed-char-${p.id}`}>
              {p.character}
            </span>
          </label>
        ))}
      </fieldset>

      <div ref={about} className="gift-about" aria-live="polite">
        {chosen ? (
          <>
            <div className="gift-about-head">
              <h3 className="gift-h3">{chosen.name}</h3>
            </div>
            <p className="gift-about-tagline">{chosen.tagline}</p>
            <ul className="gift-traits">
              {chosen.traits.map((t) => (
                <li key={t.kind} className="gift-trait">
                  <TraitIcon kind={t.kind} dusk={t.kind === "opens" && t.short === "Opens at dusk"} />
                  <span>{t.long}</span>
                </li>
              ))}
            </ul>
            <p className="gift-about-truth">About: {chosen.about}</p>
          </>
        ) : (
          <p className="gift-note">Tap a seed to meet it. Every one of them blooms with gentle care.</p>
        )}
      </div>
    </>
  );
}
