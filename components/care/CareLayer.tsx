"use client";
// The care layer over the personal garden, for a visitor whose device holds a garden: the plant's own line in its
// gentle voice, chips for the soil (a lotus's pond, or its jar), the plant's day and its bloom outlook, a lotus's koi,
// friends' sprinkles and the weather at the office, and the care actions (six for a flower of the bed, four for a lotus). A bottom card within thumb reach on phones and portrait iPads, a side panel on
// laptops and landscape iPads, and a narrow side panel on a phone held sideways (CareLayer.css). Mounted by the garden
// page with no props; for anyone without a garden it renders nothing and the owner's rose stays the garden everyone sees.
//
// lib/client/plant does the work: it fetches and refreshes the plant, eases the model's live state into the 3D plant,
// and gives each action its optimistic effect and calm reply. This file decides what to ask first and what asks at all.
// One thing asks at a time: in rain (falling now, or heavy rain the forecast says will soak the bed) the rain hint is
// the only voice about water ("Heavy rain tonight; skip the can.", with the rain cover offered), so the can loses its
// cue and says "raining" or "rain due", the soil chip goes quiet and a thirsty line from the last hour becomes "The rain
// is giving me a drink."; a tap on the can then asks before it pours (naming damp soil too), until "Water anyway" says
// to stop asking for that rain. The can on damp soil asks "The soil is still damp. Water anyway?", plant food on a
// rich bed asks too, a can or a feed inside its rate limit explains from when it is welcome instead of failing, a rain
// cover left on in dry weather is gently pointed out, and lifting a shade that has been up for a day and a half (the
// server's shadeSinceH) asks for the evening. "Ready for a drink" is said once: in the plant's line when it says so,
// else on the soil chip; the can's breathing ring shows where to act.
//
// The card's height reaches the garden camera through the store (dockBottom, dockRight), so the plant stands in the
// open part of the view and eases up when the card grows for a question or a reply. On the page's opening
// (lib/garden/opening) the card is laid out from the start, so the plant is already framed for it, but held out of
// sight until the opening's peace has passed (CareLayer.css), then it rises in. A plant that has gone to sleep
// gets the resting card (Fairy Dust, then a second-chance sprout) in place of the buttons; a garden that cannot be
// reached, or a device that no longer holds its garden, gets a small calm card with words instead of silence.
//
// A lotus (components/care/careStates.ts) lives in a pond, so there is no shade cloth and no rain cover to offer, rain
// is never a reason to wait (it only tops the pond up: the hint says so, in the pond stage, and asks nothing), and its
// own questions take their place: a top-up on a pond at its line asks before it spills through the notch, and lotus food
// that would burn its young leaves (or only cloud the jar, or add to a rich mud) asks first. Fresh jar water and
// planting the seedling in its pot go through without a question. Tend is the koi's pinch: while the last pinch is under
// four hours old (and there are no aphids to rinse) a tap says from when the next is welcome instead of feeding nobody.
//
// The card can be tucked away: its round button at the top right slips it toward its edge (down on a phone, to the
// side on wide screens), and a slim tab takes its place there, saying in a few words how the plant is ("Growing
// well"), in gold with its dot breathing when the plant asks for something ("Ready for a drink": careStates tabWords).
// A tap on the tab brings the card back. Tucked or not is remembered on this device, so a garden left with the card
// tucked away opens that way. While tucked, the tab is what covers the screen: it is what the camera keeps the plant
// clear of (useDock), so on a phone the plant settles back toward the middle.
//
// Calm by design: no red, no countdowns, soft motion that stops for reduced motion, 44 px targets and more, every
// action a real button, a polite live region for the replies, and Escape anywhere in the panel to put a question away.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { CareActions, type ActionFace, type ActionKey, type ActionState } from "@/components/care/CareActions";
import { CarePrompt, type PromptSpec } from "@/components/care/CarePrompt";
import {
  POND_FULL_LEAVE,
  koiChip,
  koiWaitText,
  lotusFeedQuestion,
  lotusFeedState,
  lotusTendState,
  lotusWaterState,
  pondChip,
  shortWhen,
  tabWords,
  tendWouldWait,
} from "@/components/care/careStates";
import { BucketIcon, ChevronIcon, CloseIcon, CoverIcon, JarIcon, KoiIcon, LeafIcon, PlantPondIcon, RainIcon } from "@/components/care/icons";
import { RestingCard } from "@/components/care/RestingCard";
import { StatusChips, type ChipsModel } from "@/components/care/StatusChips";
import { sidePanel } from "@/lib/client/dock";
import {
  POND_FULL_PROMPT,
  RAIN_POND_LINE,
  RAIN_SOON_LINE,
  careKeysFor,
  careLabels,
  dismissNotice,
  friendsLine,
  friendsText,
  isPondShown,
  isSeed,
  lineAsksForWater,
  notReadyText,
  outlookText,
  plantLine,
  plantNoun,
  plantStore,
  rainHint,
  rainHintText,
  refreshPlant,
  restingOf,
  say,
  sendCare,
  shadeUpHours,
  shownVisual,
  soilWord,
  startPlantSync,
  toggleShown,
  usePlant,
  weatherWords,
  type MeView,
  type ShownPondVisual,
} from "@/lib/client/plant";
import { uiHeld, useOpening } from "@/lib/garden/opening";
import { useQuality } from "@/lib/garden/quality";
import { garden } from "@/lib/garden/store";
import { IST_OFFSET_MIN, hourIndexOf } from "@/lib/sim";
import "@/components/care/CareLayer.css";

/** The side-panel layouts' media queries, as CareLayer.css has them: wide landscape, and a phone held sideways. */
const SIDE_PANEL = "(min-width: 1024px) and (orientation: landscape)";
const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 540px)";

/** A shade up this long leaves sun-naive leaves when lifted (the model counts 48 h; the word comes a little before). */
const LONG_SHADE_H = 36;
/** Once the rain question is answered "Water anyway", the can does not ask about rain again for this long (the forecast's twelve hours). */
const RAIN_ASKED_MS = 12 * 3_600_000;
/** A cover put on this recently is not yet pointed out in dry weather. */
const COVER_SETTLE_MS = 45 * 60_000;
const SPRINKLE_KEY = "garden-sprinkle-thanks:v1";
/** The card was tucked away on this device ("1"), so it opens tucked away. */
const TUCKED_KEY = "garden-care-tucked:v1";
/** How long the card takes to slip away before it is hidden (CareLayer.css care-sink, care-slide-away). */
const TUCK_MS = 420;

function readTucked(): boolean {
  try {
    return window.localStorage.getItem(TUCKED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeTucked(on: boolean) {
  try {
    if (on) window.localStorage.setItem(TUCKED_KEY, "1");
    else window.localStorage.removeItem(TUCKED_KEY);
  } catch {
    // storage blocked: the card opens up next time
  }
}

/**
 * While the loading veil still covers the garden (a garden link opening on a fresh device, say), the card under it
 * takes no focus and no taps.
 */
const underVeil = (s: { veiled: boolean; phase: string }) => s.veiled && s.phase !== "revealing" && s.phase !== "live";

/** The fractional hour of the day in Bangalore. */
function istHourOf(ms: number): number {
  return (((ms / 3_600_000 + IST_OFFSET_MIN / 60) % 24) + 24) % 24;
}

/**
 * Publishes how much of the screen the panel covers: the bottom card's height as --care-dock (for other bottom-edge
 * overlays) and, with the narrow sideways panel's width, to the garden store, so the camera keeps the plant in the
 * open part of the view. The wide side panel stays out of the store (the garden there is composed round it already)
 * and only tells the camera's bed shot it is there (lib/client/dock). With the card tucked away, the tab is measured
 * in its place.
 */
function useDock(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = panel.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const side = window.matchMedia(SIDE_PANEL);
    const short = window.matchMedia(SHORT_LANDSCAPE);
    const publish = () => {
      const r = el.getBoundingClientRect();
      // a panel not laid out (hidden for a moment) covers nothing
      const laid = r.width > 0 && r.height > 0;
      const bottom = !laid || side.matches || short.matches ? 0 : Math.max(0, Math.round(window.innerHeight - r.top));
      const right = laid && short.matches ? Math.max(0, Math.round(window.innerWidth - r.left)) : 0;
      sidePanel.width = laid && side.matches && !short.matches ? Math.max(0, Math.round(window.innerWidth - r.left)) : 0;
      root.style.setProperty("--care-dock", `${bottom}px`);
      const g = garden.get();
      if (g.dockBottom !== bottom || g.dockRight !== right) garden.set({ dockBottom: bottom, dockRight: right });
    };
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    side.addEventListener("change", publish);
    short.addEventListener("change", publish);
    window.addEventListener("resize", publish);
    // the card rises in with a transform the observer does not see: look again once it has settled
    const settle = window.setTimeout(publish, 900);
    publish();
    return () => {
      ro.disconnect();
      window.clearTimeout(settle);
      side.removeEventListener("change", publish);
      short.removeEventListener("change", publish);
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--care-dock");
      sidePanel.width = 0;
      garden.set({ dockBottom: 0, dockRight: 0 });
    };
  }, [panel]);
}

/**
 * Friends' sprinkles today, thanked once each in the slot as a warm line ("Asha left a sprinkle for your jasmine
 * today."), a moment after the garden is showing (not under the loading veil) and never over another reply. Who has
 * been thanked today is remembered on this device.
 */
function useSprinkleThanks(me: MeView, noun: string, pond: boolean, resting: boolean) {
  // the veils' rule: once first seen the garden counts as showing, through a tier change behind a held still too; and
  // the card itself waits for the opening's peace to pass (lib/garden/opening), so the thanks waits with it
  const showing = useQuality((s) => !underVeil(s));
  const held = useOpening(uiHeld);
  const quiet = resting || !showing || held;
  const names = me.friendsToday.join("\u0001");
  const seed = me.plant.seed;
  const day = Math.floor(me.now.h / 24);
  useEffect(() => {
    if (quiet || !names) return;
    const today = names.split("\u0001");
    let thanked: string[] = [];
    try {
      const r = JSON.parse(window.localStorage.getItem(SPRINKLE_KEY) ?? "null") as { seed?: string; day?: number; names?: string[] } | null;
      if (r && r.seed === seed && r.day === day && Array.isArray(r.names)) thanked = r.names.filter((n) => typeof n === "string");
    } catch {
      // a convenience only: without it a friend may be thanked again
    }
    const left = [...thanked];
    const fresh = today.filter((n) => {
      const i = left.indexOf(n);
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
    const line = friendsLine(fresh, noun, pond);
    if (!line) return;
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      // wait for the slot to be free of another reply, a few times, then let it go until the next visit
      if (plantStore.get().notice && tries++ < 4) {
        timer = window.setTimeout(attempt, 5000);
        return;
      }
      say(line, "thanks", 11_000);
      try {
        window.localStorage.setItem(SPRINKLE_KEY, JSON.stringify({ seed, day, names: today }));
      } catch {
        // see above
      }
    };
    timer = window.setTimeout(attempt, 1800);
    return () => window.clearTimeout(timer);
  }, [names, seed, day, noun, pond, quiet]);
}

/** A lotus's water and tend buttons: the jar, the seedling going into its pot, or the bucket; and the koi's pinch. */
function lotusFaces(v: ShownPondVisual): Partial<Record<ActionKey, ActionFace>> {
  const labels = careLabels(v);
  const icon = v.stage === "pond" ? <BucketIcon /> : v.moveReady ? <PlantPondIcon /> : <JarIcon />;
  return { water: { label: labels.water, icon }, tend: { label: labels.tend, icon: <KoiIcon /> } };
}

function CarePanel({ me }: { me: MeView }) {
  const local = usePlant((s) => s.local);
  const meAt = usePlant((s) => s.meAt);
  const weather = usePlant((s) => s.weather);
  const notice = usePlant((s) => s.notice);
  const failure = usePlant((s) => s.failure);
  const clock = usePlant((s) => s.now);
  const now = clock || Date.parse(me.now.at);
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  // the dry-weather word about the cover: put away by the person until the cover next goes on or off here
  const [nudgeAway, setNudgeAway] = useState(false);
  const [coverOnAt, setCoverOnAt] = useState(0);
  const trigger = useRef<HTMLElement | null>(null);
  const promptSeq = useRef(0);
  /** when the rain question was last answered "Water anyway" here (ms) */
  const rainWaterAnyway = useRef(-Infinity);
  const panel = useRef<HTMLDivElement>(null);
  const covered = useQuality(underVeil);
  // tucked away: asked for at once; `away` once the card has slipped out and is hidden, the tab covering the screen then
  const [tucked, setTucked] = useState(readTucked);
  const [away, setAway] = useState(tucked);
  const tab = useRef<HTMLButtonElement>(null);
  const tuckButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useDock(away ? tab : panel);

  useEffect(() => {
    if (!tucked || away) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setAway(true), still ? 0 : TUCK_MS);
    return () => window.clearTimeout(t);
  }, [tucked, away]);

  const tuck = () => {
    setTucked(true);
    writeTucked(true);
    requestAnimationFrame(() => tab.current?.focus({ preventScroll: true }));
  };
  const untuck = () => {
    setTucked(false);
    setAway(false);
    writeTucked(false);
    requestAnimationFrame(() => tuckButton.current?.focus({ preventScroll: true }));
  };

  const shown = useMemo(() => shownVisual(me, local, now), [me, local, now]);
  const busy = useMemo(() => new Set(local.filter((a) => a.status === "sending").map((a) => a.kind as ActionKey)), [local]);
  const noun = plantNoun(me.plant.species);
  const nowH = hourIndexOf(new Date(now));
  const rain = rainHint(weather, nowH);
  const resting = restingOf(me, local);
  const shade = toggleShown({ me, meAt, local }, "shade");
  const cover = toggleShown({ me, meAt, local }, "cover");
  const pond = isPondShown(shown) ? shown : null;
  // the rain answers a bed's thirst and a pond's level, never a seed's jar
  const waterRain = pond?.stage === "jar" ? null : rain;
  const soil = soilWord(shown);
  const seed = isSeed(me, shown);
  const line = plantLine(me, shown, rain, cover);
  // the plant's own line already asks for water: the chips need not say it again
  const lineAsks = line !== null && line.voice === "plant" && lineAsksForWater(shown.says) && !waterRain;
  // a friend's sprinkle is a kind thought for a lotus's pond (it cannot top up 800 litres): thanked as one
  useSprinkleThanks(me, noun, pond !== null, resting !== null);

  const ask = (spec: Omit<PromptSpec, "id">) => setPrompt({ ...spec, id: ++promptSeq.current });
  const closePrompt = () => {
    setPrompt(null);
    const el = trigger.current;
    if (el) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  };

  const setCover = (on: boolean) => {
    setNudgeAway(false);
    if (on) setCoverOnAt(now);
    void sendCare("cover", on);
  };
  const putCoverOn = () => setCover(true);

  function water() {
    if (!me.care.water.ready) return say(notReadyText("water", me.care.water.nextAt, noun, now, shown, me.care.water.planted === true), "gentle");
    if (pond) {
      // fresh jar water and the planting go straight in, and rain is never a reason to wait (it only tops the pond up);
      // a pond at its line asks before the bucket spills through the notch
      if (pond.stage === "pond" && pond.canAdvice === "damp") {
        return ask({
          title: POND_FULL_PROMPT.title,
          body: POND_FULL_PROMPT.body,
          actions: [
            { label: "Leave it", primary: true, run: () => say(POND_FULL_LEAVE) },
            { label: "Top up anyway", run: () => void sendCare("water") },
          ],
        });
      }
      return void sendCare("water");
    }
    const damp = shown.canAdvice === "damp" || soil === "soaked";
    // the rain asks first, and says so when the soil is damp too, so its "Water anyway" is the one question; only that
    // answer quiets it for this rain (a skipped can or a cover put on asks again next time), and damp soil still asks
    if (rain && now - rainWaterAnyway.current > RAIN_ASKED_MS) {
      const soilWords = soil === "soaked" ? "The soil is soaked just now. " : damp ? "The soil is still damp. " : "";
      return ask({
        title: rainHintText(rain, nowH),
        body: soilWords + (cover ? "The rain cover is already on, so the bed stays sheltered." : "The rain cover would keep the bed from soaking."),
        actions: [
          ...(cover ? [] : [{ label: "Put the cover on", primary: true, run: putCoverOn }]),
          { label: "Skip the can", primary: cover, run: () => say("The can can wait. The rain will look after the bed.") },
          {
            label: "Water anyway",
            run: () => {
              rainWaterAnyway.current = now;
              void sendCare("water");
            },
          },
        ],
      });
    }
    if (damp) {
      return ask({
        title: "The soil is still damp. Water anyway?",
        body: soil === "soaked" ? "It is soaked just now, and roots like a breath of air between drinks." : undefined,
        actions: [
          { label: "Leave it", primary: true, run: () => say(`The soil can dry a little first. Your ${noun} will ask when it is ready.`) },
          { label: "Water anyway", run: () => void sendCare("water") },
        ],
      });
    }
    void sendCare("water");
  }

  function feed() {
    if (!me.care.feed.ready) return say(notReadyText("feed", me.care.feed.nextAt, noun, now, shown), "gentle");
    if (pond) {
      const q = lotusFeedQuestion(pond);
      if (!q) return void sendCare("feed");
      return ask({
        title: q.title,
        body: q.body,
        actions: [
          { label: "Leave it", primary: true, run: () => say(q.leave) },
          { label: q.anyway, run: () => void sendCare("feed") },
        ],
      });
    }
    if (shown.feedAdvice === "rich") {
      return ask({
        title: "The bed is already rich. Feed anyway?",
        body: "More food now would add salt, not growth.",
        actions: [
          { label: "Leave it", primary: true, run: () => say("The bed has plenty for now.") },
          { label: "Feed anyway", run: () => void sendCare("feed") },
        ],
      });
    }
    void sendCare("feed");
  }

  function liftShade() {
    const upH = shadeUpHours(now);
    const hour = istHourOf(now);
    // leaves grown under the cloth meet the full sun gently if it comes off toward evening (or at night)
    if (upH !== null && upH >= LONG_SHADE_H && hour >= 6 && hour < 16.5) {
      return ask({
        title: "The leaves are used to the shade. Lift it in the evening so they can adjust.",
        body: "Lifted in the strong midday sun, leaves grown in shade can scorch for a few days.",
        actions: [
          { label: "Keep it up for now", primary: true, run: () => say("The shade stays up. Lift it this evening.") },
          { label: "Lift it now", run: () => void sendCare("shade", false) },
        ],
      });
    }
    void sendCare("shade", false);
  }

  function tend() {
    // a lotus's koi had their pinch under four hours ago and there are no aphids to rinse: a tend would feed nobody
    const koi = me.care.koi;
    if (pond && koi && tendWouldWait(pond, koi)) return say(koiWaitText(koi, now), "gentle");
    void sendCare("tend");
  }

  function onAction(key: ActionKey, el: HTMLButtonElement) {
    trigger.current = el;
    setPrompt(null);
    if (key === "water") water();
    else if (key === "feed") feed();
    else if (key === "tend") tend();
    else if (key === "shade" || key === "cover") {
      // a lotus has neither (careKeysFor never offers them; the server would decline them calmly)
      if (pond) return;
      if (key === "cover") setCover(!cover);
      else if (shade) liftShade();
      else void sendCare("shade", true);
    } else void sendCare(key);
  }

  const asks = shown.canAdvice === "ready" || shown.canAdvice === "thirsty" ? shown.canAdvice : null;
  const waterState: ActionState = rain
    ? // the rain hint is the one voice about water: no cue, and a word that says why
      { sub: rain.when === "now" ? "raining" : "rain due", subTone: "rain", cue: null, resting: !me.care.water.ready }
    : me.care.water.ready
      ? { sub: null, cue: asks, srHint: asks ? `your ${noun} would like a drink` : undefined }
      : { sub: shortWhen(me.care.water.nextAt, now), cue: null, resting: true };
  const states: Record<ActionKey, ActionState> = pond
    ? {
        water: lotusWaterState(pond, me.care.water, waterRain, now),
        shade: { sub: null, cue: null },
        cover: { sub: null, cue: null },
        feed: lotusFeedState(pond, me.care.feed, now),
        tend: lotusTendState(pond, me.care.koi, now),
        talk: { sub: null, cue: null },
      }
    : {
        water: waterState,
        shade: { sub: shade ? "on" : null, cue: null, pressed: shade },
        cover: { sub: cover ? "on" : null, cue: null, pressed: cover },
        feed: { sub: me.care.feed.ready ? null : shortWhen(me.care.feed.nextAt, now), cue: null, resting: !me.care.feed.ready },
        tend: { sub: !seed && (shown.pests > 0.25 || shown.snails > 0) ? "nibblers" : null, cue: null },
        talk: { sub: null, cue: null },
      };
  const keys = careKeysFor(me.plant.species);
  const faces = pond ? lotusFaces(pond) : undefined;

  const outlook = outlookText(me, now);
  const soilAsks = soil === "ready for a drink" || soil === "dry";
  // said once: when the plant's line asks for a drink (or the rain is about to give one), the chip just describes the soil
  const soilText = (lineAsks || rain) && soil === "ready for a drink" ? "drying" : soil;
  const chips: ChipsModel = {
    ground: pond
      ? pondChip(pond, { lineAsks, rain: waterRain !== null, resting: resting !== null })
      : { kind: "soil", text: `Soil ${soilText}`, spoken: `Soil: ${soilText}`, level: shown.moisture, ask: !resting && !rain && !lineAsks && soilAsks },
    outlook: { text: outlook.text, spoken: outlook.spoken, bloom: me.forecast !== null || me.state.bloomH !== null },
    koi: pond ? koiChip(me, pond, now) : null,
    friends: friendsText(me.friendsToday),
    weather: weather ? weatherWords(weather) : null,
  };

  const dryNow = weather !== null && weather.lagHours <= 2 && !weather.raining;
  const coverNudge =
    cover && !rain && dryNow && !resting && !nudgeAway && now - coverOnAt > COVER_SETTLE_MS &&
    !local.some((a) => a.kind === "cover" && now - a.at < COVER_SETTLE_MS);

  const lineSpeaksRain = line !== null && (line.text === RAIN_POND_LINE || line.text.endsWith(RAIN_SOON_LINE));
  let slot: ReactNode = null;
  if (prompt) {
    slot = <CarePrompt spec={prompt} onClose={closePrompt} />;
  } else if (notice && !resting) {
    // (while resting, the card itself says what the Fairy Dust or the sprout is doing, and why one did not go; the
    // reply is still announced)
    slot = (
      <div key={notice.id} className="care-notice" data-tone={notice.tone} aria-hidden="true">
        <LeafIcon />
        <p>{notice.text}</p>
        <button type="button" className="care-icon-btn" tabIndex={-1} onClick={dismissNotice} aria-label="Dismiss">
          <CloseIcon />
        </button>
      </div>
    );
  } else if (pond && waterRain && !resting && pond.canAdvice !== "damp" && !lineSpeaksRain) {
    // a lotus below its line: the rain will top the pond up, and there is nothing to put on or to skip (said once: not
    // when the plant's own line already says the rain is topping it up, or is on its way)
    slot = (
      <div className="care-hint" data-tone="rain">
        <RainIcon />
        <p>{rainHintText(waterRain, nowH, me.plant.species)}</p>
      </div>
    );
  } else if (!pond && rain && !resting && (!cover || rain.when === "soon")) {
    // "Heavy rain tonight; skip the can." and the rain cover; with the cover already on, only the heavy rain still to
    // come is said (rain falling on the cover now is the plant's own line)
    slot = (
      <div className="care-hint" data-tone="rain">
        <RainIcon />
        <p>
          {rainHintText(rain, nowH)} {cover ? "The rain cover is on, so the bed stays sheltered." : "The rain cover would keep the bed from soaking."}
        </p>
        {!cover && (
          <button type="button" className="care-btn care-btn-small" onClick={putCoverOn}>
            Put the cover on
          </button>
        )}
      </div>
    );
  } else if (coverNudge) {
    slot = (
      <div className="care-hint" data-tone="rain">
        <CoverIcon />
        <p>It is dry at the office now. The cover can come off so the bed can breathe.</p>
        <div className="care-hint-actions">
          <button type="button" className="care-btn care-btn-small" onClick={() => setCover(false)}>
            Take the cover off
          </button>
          <button type="button" className="care-icon-btn" aria-label="Leave the cover on" onClick={() => setNudgeAway(true)}>
            <CloseIcon />
          </button>
        </div>
      </div>
    );
  } else if (!me.weather.upToDate) {
    slot = (
      <div className="care-hint">
        <LeafIcon />
        <p>The latest weather is on its way; your {noun} waits for it.</p>
      </div>
    );
  }

  // Escape anywhere in the panel puts a question away, even once Tab has moved on from it
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && prompt) {
      e.stopPropagation();
      closePrompt();
    }
  };

  const tabSays = tabWords(line, { resting: resting !== null, pond: pond !== null });

  return (
    <section className="care-root" aria-label={`Caring for ${me.person.firstName}'s garden`} inert={covered}>
      {/* tabIndex -1: the panel scrolls on a short screen, and a browser would otherwise make the scroller a tab stop of its own */}
      <div
        id={panelId}
        className={tucked ? "care-panel is-tucking" : "care-panel"}
        ref={panel}
        onKeyDown={onKeyDown}
        tabIndex={-1}
        hidden={away}
      >
        <button
          ref={tuckButton}
          type="button"
          className="care-tuck-btn"
          aria-label="Shrink the care card"
          aria-expanded={!tucked}
          aria-controls={panelId}
          onClick={tuck}
        >
          <span aria-hidden="true">
            <ChevronIcon />
          </span>
        </button>
        <header className="care-head">
          <p className="care-name">{me.person.firstName}&rsquo;s garden</p>
          {me.plant.rehearsal && <span className="care-tag">Practice garden</span>}
        </header>
        {line && (
          <p className="care-says" data-mood={line.mood} data-voice={line.voice}>
            <span className="care-mood" aria-hidden="true" />
            {line.voice === "plant" ? (
              <span>
                <span className="care-sr">Your {noun} says: </span>
                &ldquo;{line.text}&rdquo;
              </span>
            ) : (
              <span>{line.text}</span>
            )}
          </p>
        )}
        <StatusChips model={chips} />
        {slot && <div className="care-slot">{slot}</div>}
        {resting ? (
          <RestingCard
            resting={resting}
            noun={noun}
            vessel={pond ? (pond.stage === "jar" ? "jar" : "pond") : "bed"}
            problem={failure && (failure.kind === "revive" || failure.kind === "replant") ? failure : null}
            onAction={(kind) => void sendCare(kind)}
          />
        ) : (
          <CareActions keys={keys} faces={faces} states={states} busy={busy} onAction={onAction} />
        )}
        {weather && <p className="care-credit">{weather.credit}</p>}
      </div>
      {tucked && (
        <button
          ref={tab}
          type="button"
          className="care-tab"
          data-mood={tabSays.mood}
          data-asks={tabSays.asks || undefined}
          aria-expanded={false}
          aria-controls={panelId}
          onClick={untuck}
        >
          <span className="care-mood" aria-hidden="true" />
          <span className="care-tab-words">{tabSays.words}</span>
          <span className="care-sr">, show the care card</span>
          <span className="care-tab-chev" aria-hidden="true">
            <ChevronIcon />
          </span>
        </button>
      )}
      {/* outside the card, so a reply is still heard while it is tucked away */}
      <p className="care-sr" role="status" aria-live="polite">
        {notice?.text ?? ""}
      </p>
    </section>
  );
}

/**
 * Words for when the plant cannot be shown: the garden is not answering (it looks again by itself; Try again looks
 * now), or this device no longer holds the garden it was showing.
 */
function QuietCard({ kind }: { kind: "unreachable" | "lost" }) {
  const problem = usePlant((s) => s.meProblem);
  const [looking, setLooking] = useState(false);
  // a first fetch that fails often succeeds on the quick retry: give it a moment before saying anything
  const [shown, setShown] = useState(kind === "lost");
  const panel = useRef<HTMLDivElement>(null);
  const covered = useQuality(underVeil);
  useEffect(() => {
    if (shown) return;
    const t = window.setTimeout(() => setShown(true), 2500);
    return () => window.clearTimeout(t);
  }, [shown]);
  useDock(panel);

  const tryAgain = async () => {
    if (looking) return;
    setLooking(true);
    try {
      await refreshPlant();
    } finally {
      setLooking(false);
    }
  };

  return (
    <section className="care-root" aria-label="Your garden" inert={covered}>
      <div className="care-panel care-quiet" ref={panel} hidden={!shown} tabIndex={-1}>
        <div className="care-quiet-row">
          <span className="care-rest-glyph" aria-hidden="true">
            <LeafIcon />
          </span>
          <div className="care-rest-text" role="status" aria-live="polite">
            {kind === "unreachable" ? (
              <>
                <p className="care-rest-title">Your garden is taking a moment to answer.</p>
                <p className="care-rest-body">{problem ? `${problem} It will look again by itself.` : "It will look again by itself."}</p>
              </>
            ) : (
              <>
                <p className="care-rest-title">This device no longer holds your garden.</p>
                <p className="care-rest-body">Open your garden link to come back.</p>
              </>
            )}
          </div>
        </div>
        {kind === "unreachable" ? (
          <button type="button" className="care-btn care-quiet-btn" aria-disabled={looking || undefined} onClick={() => void tryAgain()}>
            {looking ? "Looking again" : "Try again"}
          </button>
        ) : (
          <button type="button" className="care-btn care-quiet-btn" onClick={() => window.location.reload()}>
            Continue to the garden
          </button>
        )}
      </div>
    </section>
  );
}

/** The care layer: fetches the visitor's plant and, when there is one, shows how it is and how to look after it. */
export function CareLayer() {
  useEffect(() => startPlantSync(), []);
  const phase = usePlant((s) => s.phase);
  const me = usePlant((s) => s.me);
  const lost = usePlant((s) => s.lost);
  if (phase === "ready" && me) return <CarePanel me={me} />;
  if (phase === "unreachable") return <QuietCard kind="unreachable" />;
  if (phase === "signed-out" && lost) return <QuietCard kind="lost" />;
  return null;
}
