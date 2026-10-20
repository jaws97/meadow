"use client";
// The eight seed packets as cards: a render of each flower in bloom, its name and a one-line character drawn from the
// plant model (components/gift/species.ts), and under the cards the chosen one's fuller nature and the model's honest
// line about the real plant. The seven flowers of the bed sit two or three to a row; the eighth, the lotus, grows in
// its own koi pond, so it closes the set as one wide card the width of a row, its picture exactly one column wide (a
// subgrid of the cards' grid) and its words beside it with where it lives. A bed card left alone in the last row takes
// the same wide shape (LONE_BED), so no row is one small card and a gap. The cards are native radio buttons, so arrow
// keys move between them, a screen reader hears "radio, 2 of 8", and the choice is plain to see. On a phone that fuller nature opens below the cards, out of
// sight, so a choice brings it gently into view when it is not already showing, as far as the chosen card itself can
// stay in view (the Plant button names the choice as well).
import Image from "next/image";
import { useEffect, useRef } from "react";
import { Check, Koi, TraitIcon } from "@/components/gift/icons";
import { SEED_PACKETS, packetOf } from "@/components/gift/species";
import type { SpeciesId } from "@/lib/plant/species";

/** How much of the chosen seed's nature must already show for the sheet to stay where it is. */
const SHOWING_PX = 96;
/** Room kept above the chosen card when the sheet scrolls. */
const CARD_MARGIN_PX = 10;

/**
 * How many cards a row holds in each layout (gift.css .gift-seeds): two on a phone and in the laptop's side panel, three
 * on anything wider than a phone in between. Keep in step with the grid's columns there.
 */
const ROW_SIZES = [2, 3] as const;

/**
 * The bed card that takes the wide shape: the last one, when the bed's count leaves it alone in its row in every layout
 * (seven cards are rows of two and of three with one over, either way). A card alone in only some layouts stays an
 * ordinary card, a short last row as any grid has; the CSS would need a wide rule for each layout to do better.
 */
const BED = SEED_PACKETS.filter((p) => !p.home);
const LONE_BED: SpeciesId | null = BED.length > 0 && ROW_SIZES.every((n) => BED.length % n === 1) ? BED[BED.length - 1].id : null;

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
        <legend className="gift-sr">Eight seeds</legend>
        {SEED_PACKETS.map((p) => (
          <label key={p.id} className={p.home || p.id === LONE_BED ? "gift-seed gift-seed-wide" : "gift-seed"}>
            <input
              type="radio"
              name="gift-seed"
              value={p.id}
              checked={value === p.id}
              onChange={() => {
                picked.current = true;
                onChange(p.id);
              }}
              aria-describedby={p.home ? `gift-seed-home-${p.id} gift-seed-char-${p.id}` : `gift-seed-char-${p.id}`}
            />
            <span className="gift-seed-check">
              <Check size={15} strokeWidth={2.2} />
            </span>
            <span className="gift-seed-art">
              <Image src={p.image} alt="" width={480} height={360} unoptimized loading="eager" />
            </span>
            <span className="gift-seed-name">{p.name}</span>
            {p.home && (
              <span className="gift-seed-home" id={`gift-seed-home-${p.id}`}>
                <Koi size={14} />
                {p.home}
              </span>
            )}
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
            {chosen.note && <p className="gift-about-note">{chosen.note}</p>}
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
