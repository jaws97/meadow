"use client";
// The ways to look after the plant: Water, Shade, Cover, Feed, Tend and Talk for a flower of the bed; four for a lotus,
// whose pond has no shade cloth or rain cover (lib/client/plant careKeysFor), with its own words and icons on two of
// them: the water button freshens the jar ("Fresh water"), plants the seedling ("Plant in the pond") or pours a bucket
// ("Top up the pond"), and Tend is "Tend the pond", a pinch for the koi. Large round tokens (48 px, a 64 px tall target
// with the label) in a row along the bottom of a phone, within reach of a thumb, and a three-by-two grid in the side
// panel (two by two for a lotus's four). The shade cloth and the rain cover are toggles (aria-pressed) that glow gold
// while they are up. A can or a feed that has to wait stays tappable and says from when, so a tap explains rather than
// fails; the plant's own cue ("ready", "thirsty") breathes softly round the button it asks for (the words are the
// plant's line; screen readers hear them on the button), rain puts "raining" or "rain due" under the can instead, and a
// few nibblers on the leaves (or the koi's hunger, or aphids on a lotus) put a word under Tend.
import type { MouseEvent, ReactNode } from "react";
import { CoverIcon, FeedIcon, ShadeIcon, TalkIcon, TendIcon, WaterIcon } from "@/components/care/icons";

export type ActionKey = "water" | "shade" | "cover" | "feed" | "tend" | "talk";

export interface ActionState {
  /** a short word under the label: when the next can is welcome, "raining", "on" */
  sub: string | null;
  /** the word's tone: rain is the soft rain blue */
  subTone?: "rain";
  /** words only screen readers hear on the button, for a cue that is otherwise only the breathing ring */
  srHint?: string;
  /** the soft breathing ring: the plant asks for this one */
  cue: "ready" | "thirsty" | null;
  /** shade and cover: up (true) or folded away (false) */
  pressed?: boolean;
  /** waiting on a rate limit: drawn quieter, still tappable */
  resting?: boolean;
}

export interface ActionFace {
  label: string;
  icon: ReactNode;
}

/** Each button's words and icon for a flower of the bed; a lotus changes two of them (`faces`). */
const FACES: Record<ActionKey, ActionFace> = {
  water: { label: "Water", icon: <WaterIcon /> },
  shade: { label: "Shade", icon: <ShadeIcon /> },
  cover: { label: "Cover", icon: <CoverIcon /> },
  feed: { label: "Feed", icon: <FeedIcon /> },
  tend: { label: "Tend", icon: <TendIcon /> },
  talk: { label: "Talk", icon: <TalkIcon /> },
};

export function CareActions({
  keys,
  faces,
  states,
  busy,
  onAction,
}: {
  /** the buttons this plant has, in order */
  keys: readonly ActionKey[];
  /** words and icons that differ from a flower of the bed's (a lotus's water and tend buttons) */
  faces?: Partial<Record<ActionKey, ActionFace>>;
  states: Record<ActionKey, ActionState>;
  /** a care action is on its way: the same button is not doubled */
  busy: ReadonlySet<ActionKey>;
  onAction: (key: ActionKey, trigger: HTMLButtonElement) => void;
}) {
  return (
    <div className="care-actions" role="group" aria-label="Care" data-count={keys.length}>
      {keys.map((key) => {
        const { label, icon } = faces?.[key] ?? FACES[key];
        const st = states[key];
        const toggle = st.pressed !== undefined;
        return (
          <button
            key={key}
            type="button"
            className="care-act"
            data-key={key}
            data-cue={st.cue ?? undefined}
            data-resting={st.resting ? "" : undefined}
            data-busy={busy.has(key) ? "" : undefined}
            aria-pressed={toggle ? st.pressed : undefined}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              if (!busy.has(key)) onAction(key, e.currentTarget);
            }}
          >
            <span className="care-act-token">{icon}</span>
            <span className="care-act-label">{label}</span>
            <span className="care-act-sub" data-tone={st.subTone} aria-hidden={toggle ? true : undefined}>
              {st.sub ?? " "}
            </span>
            {st.srHint && <span className="care-sr">, {st.srHint}</span>}
          </button>
        );
      })}
    </div>
  );
}
