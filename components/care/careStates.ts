// What the care layer's buttons and chips show for a lotus, kept apart from CareLayer.tsx so the choices can be tested
// (careStates.test.ts). The words themselves come from lib/client/plant where the care flow shares them (pondWord,
// koiLine, careLabels); this file decides which apply, when a button breathes, and what each question says.
//
// A lotus has four buttons (no shade cloth, no rain cover). Its water button freshens the jar, plants the ready
// seedling or pours a bucket; only the bucket ever waits on the rain, which tops the pond up by itself, and a pond at its
// line asks before it spills. Feed warns on the button itself while a tablet would do harm ("too young" before the
// second standing leaf, and all through the jar; "already rich" when the mud has plenty) and asks before it goes in;
// "asking for food" breathes when the plant asks. Tend is the koi's pinch and the aphids' rinse: it breathes when the
// koi are hungry, says "aphids" when there are some to rinse, and while the koi's last pinch is under four hours old
// (the model counts one pinch every four hours) it says from when the next one is welcome, and a tap explains rather
// than pretending to feed them.
//
// Once the flower is in full bloom (fullBloom) the card offers to send it (components/care/BloomSheet), and the tucked
// tab says so.
import type { ActionState } from "@/components/care/CareActions";
import type { GroundChip } from "@/components/care/StatusChips";
import { istWhen, koiLine, pondWord, type MeView, type RainHint, type ShownPondVisual } from "@/lib/client/plant";
import { isPondVisual, type PlantMood } from "@/lib/sim";

/** "15:00" today, "tomorrow", or "12 Nov": short enough to sit under a care button. */
export function shortWhen(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const words = istWhen(iso, now);
  if (words.startsWith("tomorrow")) return "tomorrow";
  return `from ${words.split(",")[0]}`;
}

/** Aphids enough to show on the bud or the leaves (the model's own "aphids on my bud" threshold). */
const APHIDS = 0.3;

/** The jar's water or the pond's level, as the first chip says it. */
const POND_CHIP: Record<ReturnType<typeof pondWord>, string> = {
  full: "Pond full",
  "at its line": "Pond at its line",
  "could use a top-up": "Pond could use a top-up",
  low: "Pond low",
  "below the pot": "Pond below the pot",
  "the pot is drying": "Pot drying",
  clear: "Jar water clear",
  clouding: "Jar water clouding",
  cloudy: "Jar water cloudy",
};

const POND_SPOKEN: Record<ReturnType<typeof pondWord>, string> = {
  full: "The pond is full to its line; a top-up now would spill",
  "at its line": "The pond is at its line",
  "could use a top-up": "The pond could use a top-up",
  low: "The pond is low",
  "below the pot": "The pond has dropped below the rim of the pot",
  "the pot is drying": "The pond has left the pot, and the pot is drying",
  clear: "The jar's water is clear",
  clouding: "The jar's water is clouding",
  cloudy: "The jar's water is cloudy",
};

/**
 * A lotus's first chip: the pond's level against its fill line, or while the seed is in its jar, how clear the jar's
 * water is. It takes the honey tone when the water asks for the owner and nothing else is saying so: the plant's own line
 * (`lineAsks`), or the rain, which answers a pond (never a jar). Said once: when the line or the rain already speaks for
 * a pond that could use a top-up, the chip only describes it ("Pond a little down").
 */
export function pondChip(v: ShownPondVisual, q: { lineAsks: boolean; rain: boolean; resting: boolean }): GroundChip & { ask: boolean } {
  const word = pondWord(v);
  if (v.stage === "jar") {
    return { kind: "jar", text: POND_CHIP[word], spoken: POND_SPOKEN[word], clarity: v.jarClarity, ask: !q.resting && !q.lineAsks && word !== "clear" };
  }
  const spoken = q.lineAsks || q.rain;
  const text = spoken && word === "could use a top-up" ? "Pond a little down" : POND_CHIP[word];
  return { kind: "pond", text, spoken: POND_SPOKEN[word], levelMM: v.waterMM, ask: !q.resting && !spoken && word !== "at its line" && word !== "full" };
}

/** The plant's line is already about hungry koi. */
export function saysKoiHungry(says: string): boolean {
  return /\bkoi\b/.test(says) && /hungry|feed them/.test(says);
}

/**
 * The koi chip: "Koi fed at 08:00" (from the server's last counted pinch), or "The koi are hungry" in the honey tone.
 * The koi's state is the one shown, with this page's own pinch on it, so a pinch given a moment ago never reads as
 * hungry; and when the plant's line already says the koi are hungry, the chip says when they were last fed instead.
 */
export function koiChip(me: Pick<MeView, "care" | "visual" | "state">, v: ShownPondVisual, nowMs: number): { text: string; ask: boolean } | null {
  if (!isPondVisual(me.visual)) return null;
  const lineSays = saysKoiHungry(v.says);
  const koiAdvice = lineSays && v.koiAdvice === "hungry" ? "ready" : v.koiAdvice;
  const text = koiLine({ care: me.care, state: me.state, visual: { ...me.visual, koiAdvice } }, nowMs);
  return text ? { text, ask: koiAdvice === "hungry" } : null;
}

/**
 * The water button for a lotus. In the jar it breathes when the jar asks for fresh water, and when the seedling is ready
 * to go into its pot; in the pond when the pond asks for a top-up, unless rain is falling or due (it tops the pond up:
 * the button says so instead). Inside its four hours it says from when.
 */
export function lotusWaterState(v: ShownPondVisual, water: MeView["care"]["water"], rain: RainHint | null, now: number): ActionState {
  if (v.stage === "pond" && rain) return { sub: rain.when === "now" ? "raining" : "rain due", subTone: "rain", cue: null, resting: !water.ready };
  if (!water.ready) return { sub: shortWhen(water.nextAt, now), cue: null, resting: true };
  const asks = v.alive && (v.canAdvice === "ready" || v.canAdvice === "thirsty") ? v.canAdvice : null;
  if (!asks) return { sub: null, cue: null };
  const srHint =
    v.stage === "pond" ? "the pond would like a top-up" : v.moveReady ? "your seedling is ready to go into its pot" : "your seed would like fresh water";
  return { sub: null, cue: asks, srHint };
}

/** The feed button for a lotus: the model's advice on the button itself ("too young", "already rich", "asking for food"). */
export function lotusFeedState(v: ShownPondVisual, feed: MeView["care"]["feed"], now: number): ActionState {
  if (!feed.ready) return { sub: shortWhen(feed.nextAt, now), cue: null, resting: true };
  if (!v.alive) return { sub: null, cue: null };
  if (v.feedAdvice === "young") return { sub: "too young", cue: null };
  if (v.feedAdvice === "rich") return { sub: "already rich", cue: null };
  if (v.feedAdvice === "hungry") return { sub: "asking for food", cue: "ready", srHint: "your lotus would like a little food" };
  return { sub: null, cue: null };
}

/** Whether a tend now would do nothing: the koi's pinch is not yet due again and there are no aphids to rinse. */
export function tendWouldWait(v: ShownPondVisual, koi: MeView["care"]["koi"]): boolean {
  return koi !== null && !koi.ready && !(v.stage === "pond" && v.aphids > APHIDS);
}

/** The tend button for a lotus: "koi hungry" (breathing), "aphids", or while the koi's pinch is not due, from when. */
export function lotusTendState(v: ShownPondVisual, koi: MeView["care"]["koi"], now: number): ActionState {
  if (!v.alive) return { sub: null, cue: null };
  if (v.koiAdvice === "hungry" && (koi === null || koi.ready)) return { sub: "koi hungry", cue: "ready", srHint: "the koi are hungry" };
  if (v.stage === "pond" && v.aphids > APHIDS) return { sub: "aphids", cue: null };
  if (tendWouldWait(v, koi)) return { sub: shortWhen(koi?.nextAt ?? null, now), cue: null, resting: true };
  return { sub: null, cue: null };
}

/** Why a tend waits, for a tap on the quiet button: when the koi were fed, and from when the next pinch is welcome. */
export function koiWaitText(koi: NonNullable<MeView["care"]["koi"]>, now: number): string {
  const last = koi.lastAt ? `The koi had a pinch at ${istWhen(koi.lastAt, now)}. ` : "The koi have just been fed. ";
  const next = koi.nextAt ? `The next is welcome from ${istWhen(koi.nextAt, now)} IST; ` : "The next is welcome a little later; ";
  return `${last}${next}food they cannot finish clouds the water.`;
}

export interface CareQuestion {
  title: string;
  body: string;
  /** the kinder choice's reply, said when the owner leaves it */
  leave: string;
  /** the label of the choice that goes ahead */
  anyway: string;
}

/**
 * The question before lotus food that would do harm: in the jar a tablet only clouds the water; before the second
 * standing leaf it burns the young leaves; once the mud is rich more only burns. Null when food is welcome. Each says
 * it is the lotus's tablet, and while the plant is young, where the koi's pinch is (Tend the pond): its line asks for
 * the koi to be fed, and Feed is never the way to do that.
 */
export function lotusFeedQuestion(v: Pick<ShownPondVisual, "stage" | "feedAdvice">): CareQuestion | null {
  if (v.feedAdvice === "young" && v.stage === "jar") {
    return {
      title: "A seed in its jar needs no food. Feed anyway?",
      body: "A lotus tablet in the jar would only cloud its water. For the koi, use Tend the pond.",
      leave: "No tablet for now. Fresh water is all a seed needs.",
      anyway: "Feed anyway",
    };
  }
  if (v.feedAdvice === "young") {
    return {
      title: "Your lotus is too young for food. Feed anyway?",
      body: "Until its second standing leaf is up, a lotus tablet burns the young leaves. For the koi, use Tend the pond.",
      leave: "No tablet for now. Your lotus will be ready for one once its second standing leaf is up.",
      anyway: "Feed anyway",
    };
  }
  if (v.feedAdvice === "rich") {
    return {
      title: "The mud is already rich. Feed anyway?",
      body: "Another lotus tablet now would burn the leaves, not grow them.",
      leave: "The mud has plenty for now.",
      anyway: "Feed anyway",
    };
  }
  return null;
}

/** The reply when a top-up on a full pond is left: the pond will say when it could use one. */
export const POND_FULL_LEAVE = "The pond is at its line. It will ask when it could use a top-up.";

/**
 * The flower is in full bloom, and can be sent as a card (BloomSheet). A bed flower once its first flower has fully
 * opened (the server's `open`; a server from before it said so counts three hours from the bloom, when even a magnolia
 * is open), on the days of the flower showing (the visual's flowerDay: a week each, until its petals begin to fall on
 * the last evening, then none until the next bud opens), however the hour, its thirst or a jasmine's daytime rest draw it
 * just now. A lotus on its three flower days, through their afternoons' closing too, until its petals begin to fall.
 * Never a plant that has gone to sleep.
 */
export function fullBloom(me: Pick<MeView, "state" | "visual" | "now">): boolean {
  if (!me.state.alive) return false;
  // a lotus's third day ends with its petals falling (from 17:00): no longer one to photograph in full bloom
  if (isPondVisual(me.visual)) return me.visual.flowerDay >= 1 && !(me.visual.petalDrop > 0);
  if (me.state.bloomH === null) return false;
  const open = me.state.open ?? (me.now.h - me.state.bloomH >= 3 ? 1 : 0);
  // a server from before the flowers that follow the first (SIM_VERSION 8) sends no flowerDay: its flower stays
  const flowerDay = (me.visual as Partial<typeof me.visual>).flowerDay ?? 1;
  return open >= 0.99 && flowerDay >= 1;
}

/** The tucked-away card's tab (CareLayer): a few words for how the plant is, its mood's dot, and whether it asks. */
export interface TabWords {
  words: string;
  mood: PlantMood;
  asks: boolean;
}

/**
 * What the tab says, from the plant's own line (lib/client/plant plantLine): a seed settling in, the plant's mood in
 * two or three words, and, when the mood asks for something, the ask itself (said in gold by the tab). A plant that
 * has gone to sleep is resting; a lotus's thirst is its pond wanting a top-up. A flower in full bloom (fullBloom) says
 * so whenever it asks for nothing.
 */
export function tabWords(
  line: { voice: "plant" | "narrator"; mood: PlantMood } | null,
  opts: { resting: boolean; pond: boolean; fullBloom?: boolean },
): TabWords {
  const words = moodWords(line, opts);
  if (opts.fullBloom && !opts.resting && !words.asks && line?.voice === "plant") return { words: "In full bloom", mood: "blooming", asks: false };
  return words;
}

function moodWords(line: { voice: "plant" | "narrator"; mood: PlantMood } | null, opts: { resting: boolean; pond: boolean }): TabWords {
  if (opts.resting) return { words: "Resting", mood: "resting", asks: false };
  if (!line) return { words: "Your garden", mood: "content", asks: false };
  if (line.voice === "narrator") return { words: "Settling in", mood: line.mood, asks: false };
  switch (line.mood) {
    case "thirsty":
      return { words: opts.pond ? "Ready for a top-up" : "Ready for a drink", mood: "thirsty", asks: true };
    case "soggy":
      return { words: "Roots too wet", mood: "soggy", asks: true };
    case "unwell":
      return { words: "Needs some care", mood: "unwell", asks: true };
    case "blooming":
      return { words: "In bloom", mood: "blooming", asks: false };
    case "resting":
      return { words: "Resting", mood: "resting", asks: false };
    default:
      return { words: "Growing well", mood: "content", asks: false };
  }
}
