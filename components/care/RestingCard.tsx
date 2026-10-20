"use client";
// A plant that has gone to sleep: a calm, moonlit card in place of the care buttons, never an alarm. First it offers the
// one Fairy Dust revival; once that is used and the plant rests again, a second-chance sprout in the same bed, with the
// honest note that its flower will be smaller. The card says each thing once (the plant's own line is hidden while it
// rests). A lotus has its own words: the Fairy Dust brings its pond back to its line (or, for a seed asleep in its jar,
// fresh jar water), and the second chance is a seedling, root already out, settled into the same pond.
//
// The Fairy Dust is once only, so this is the moment that most needs to reassure: while the request is on its way the
// card says "Sprinkling the Fairy Dust"; it promises a wake "within the hour" only once the server has said yes; and if
// the dust did not reach the garden, the button comes back with the reason beside it (offline, or the server's own
// words). When the button goes, focus moves to the card's title rather than dropping to the page, and comes back to the
// button if it returns. After planting closes (10 Dec), the card says a sprout cannot go in.
import { useEffect, useRef } from "react";
import { SparkleIcon, SproutIcon } from "@/components/care/icons";
import type { Failure, Resting } from "@/lib/client/plant";

type Copy = { title: string; body: string; action: { label: string; kind: "revive" | "replant" } | null };

/** Where the plant grows: a flower's bed, or a lotus's pond (its seed still in the jar, or planted in its pot). */
export type Vessel = "bed" | "pond" | "jar";

export function copyFor(r: Resting, noun: string, vessel: Vessel = "bed"): Copy {
  if (vessel !== "bed") return lotusCopy(r, noun, vessel);
  switch (r.mode) {
    case "revive":
      return {
        title: `Your ${noun} is resting.`,
        body: "A pinch of Fairy Dust can wake it, once.",
        action: { label: "Use the Fairy Dust", kind: "revive" },
      };
    case "sprinkling":
      return { title: "Sprinkling the Fairy Dust.", body: "A moment while it reaches the garden.", action: null };
    case "waking":
      return { title: "The Fairy Dust is settling.", body: `Your ${noun} will wake within the hour.`, action: null };
    case "replant":
      return {
        title: `Your ${noun} is resting again.`,
        body: "You can plant a second-chance sprout in the same bed. Its flower will be smaller, and just as lovely.",
        action: { label: "Plant a second-chance sprout", kind: "replant" },
      };
    case "sprouting":
      return { title: "Planting the second-chance sprout.", body: "A moment while it reaches the garden.", action: null };
    case "replanting":
      return { title: "A second-chance sprout is going in.", body: "It will be settled within the hour.", action: null };
    case "closed":
      return {
        title: `Your ${noun} is resting.`,
        body: "Planting has closed for the season, so a new sprout cannot go in. Your friends' flowers are still there to visit in the Meadow.",
        action: null,
      };
  }
}

/** A lotus's resting words: its pond, its jar, and a second-chance seedling rather than a sprout. */
function lotusCopy(r: Resting, noun: string, vessel: "pond" | "jar"): Copy {
  switch (r.mode) {
    case "revive":
      return {
        title: `Your ${noun} is resting.`,
        body:
          vessel === "jar"
            ? "A pinch of Fairy Dust can wake it, once, with fresh water in its jar."
            : "A pinch of Fairy Dust can wake it, once, and bring the pond back to its line.",
        action: { label: "Use the Fairy Dust", kind: "revive" },
      };
    case "sprinkling":
      return { title: "Sprinkling the Fairy Dust.", body: "A moment while it reaches the pond.", action: null };
    case "waking":
      return { title: "The Fairy Dust is settling.", body: `Your ${noun} will wake within the hour.`, action: null };
    case "replant":
      return {
        title: `Your ${noun} is resting again.`,
        body: "You can settle a second-chance seedling into the same pond. Its flower will be smaller, and just as lovely.",
        action: { label: "Plant a second-chance seedling", kind: "replant" },
      };
    case "sprouting":
      return { title: "Planting the second-chance seedling.", body: "A moment while it reaches the pond.", action: null };
    case "replanting":
      return { title: "A second-chance seedling is going in.", body: "It will be settled in its pot within the hour.", action: null };
    case "closed":
      return {
        title: `Your ${noun} is resting.`,
        body: "Planting has closed for the season, so a new seedling cannot go in. Your friends' flowers are still there to visit in the Meadow.",
        action: null,
      };
  }
}

export function RestingCard({
  resting,
  noun,
  vessel = "bed",
  problem,
  onAction,
}: {
  resting: Resting;
  noun: string;
  /** where it grows, for the words: a bed, or a lotus's pond or jar */
  vessel?: Vessel;
  /** why the last Fairy Dust or sprout did not reach the garden, shown beside the button that has come back */
  problem: Failure | null;
  onAction: (kind: "revive" | "replant") => void;
}) {
  const { title, body, action } = copyFor(resting, noun, vessel);
  const settling = resting.mode !== "revive" && resting.mode !== "replant" && resting.mode !== "closed";
  const titleRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** the person pressed the button: keep their focus in the card as it changes */
  const holdFocus = useRef(false);

  useEffect(() => {
    if (!holdFocus.current) return;
    if (buttonRef.current) {
      // the button is back (the dust did not go): focus returns to it, the reason beside it
      buttonRef.current.focus({ preventScroll: true });
      holdFocus.current = false;
    } else titleRef.current?.focus({ preventScroll: true });
  }, [resting.mode]);

  const shownProblem = action && problem && problem.kind === action.kind ? problem.text : null;

  return (
    <div className="care-rest" data-settling={settling ? "" : undefined}>
      <span className="care-rest-glyph" aria-hidden="true">
        {resting.mode === "replant" || resting.mode === "sprouting" || resting.mode === "replanting" ? <SproutIcon /> : <SparkleIcon />}
      </span>
      <div className="care-rest-text">
        <p className="care-rest-title" ref={titleRef} tabIndex={-1}>
          {title}
        </p>
        <p className="care-rest-body">{body}</p>
        {shownProblem && (
          <p key={problem?.id} className="care-rest-problem">
            {shownProblem}
          </p>
        )}
        {action && (
          <button
            ref={buttonRef}
            type="button"
            className="care-btn care-btn-primary care-rest-btn"
            onClick={() => {
              holdFocus.current = true;
              onAction(action.kind);
            }}
          >
            {action.kind === "revive" ? <SparkleIcon /> : <SproutIcon />}
            <span>{action.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}
