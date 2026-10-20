"use client";
// The gift itself, in one glass sheet over the live garden: Lijas's seed offered ("A gift from Lijas"), a first name
// for the little sign by the flower (or "A friend"), one of seven seeds, and the planting moment, which ends with the
// personal garden link for a laptop or an iPad and a way into the new garden. A lotus seed goes into a glass of water
// by its pond rather than into a bed (PlantingMoment's jar), and the words say so.
//
// The planting goes through lib/client/session.ts plantSeed: the party code rides along, and busy answers and lost
// connections are retried by themselves with the same request, while the seed waits glowing above its bed and a line
// says which it is. Every other refusal is shown in the server's own words with a calm way on: back to the name for a
// name the server would not take, "try again" for a lost connection, and the device's own garden when it already
// holds one. A reload in the middle keeps the name and seed (pendingSeed), so a retry reuses the same request id and
// never plants twice.
//
// Seeds open at the party (10 Nov, 15:00 IST) and planting closes after 10 Dec. Until 10 Nov the live site takes
// practice plantings from anyone with the party link, so colleagues can test it. On the live site the welcome step
// checks the season by the same hours the server does (copy.ts giftSeasonAt): open for practice before 10 Nov, and
// on 10 Nov someone who scans the QR code early is told when to come back before they type anything; the step opens by
// itself at 15:00. ?rehearsal skips the check on a production build (the server still decides); on a development
// server, ?season=early or ?season=closed shows those states.
//
// Names are unique in the Meadow (ignoring case), so a friend finds the right flower: the name step says so, asks the
// server whether the name is free before the seeds appear (this tab's own planting whose answer was lost does not
// count, so planting again returns that garden), and a name taken in the meantime brings the person back to the name
// step with the server's words. An answer that arrives after the name was changed, or the step left, is dropped.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { OWNER, giftSeasonAt, nextGiftSeasonChangeMs, seedsOpenText, type Season } from "@/components/gift/copy";
import { GiftSheet } from "@/components/gift/GiftSheet";
import { ArrowLeft, Soil, Sparkle } from "@/components/gift/icons";
import { LinkPanel } from "@/components/gift/LinkPanel";
import { PlantingMoment } from "@/components/gift/PlantingMoment";
import { SeedPicker } from "@/components/gift/SeedPicker";
import { SEED_PACKETS, packetOf } from "@/components/gift/species";
import { preloadCourtyard } from "@/components/lotus/product/preload";
import {
  ApiProblem,
  OFFLINE_MESSAGE,
  checkFirstName,
  checkNameFree,
  dropSeedRequestId,
  pendingSeed,
  plantSeed,
  type SeedResult,
} from "@/lib/client/session";
import { isLotus, type SpeciesId } from "@/lib/plant/species";

type Step = "welcome" | "name" | "seed" | "planting";

type Planting =
  /** wait: why the seed is waiting for another try (a busy garden, or a connection that dropped), if it is */
  | { phase: "waiting"; wait: null | "busy" | "offline" }
  | { phase: "planted"; result: SeedResult; linkShown: boolean }
  | { phase: "failed"; problem: ApiProblem };

/** How long the seed takes to drift down to its waiting place, and the planted moment before the link appears. */
const ARRIVE_MS = 1100;
const MOMENT_MS = 3000;
const REDUCED_ARRIVE_MS = 500;
const REDUCED_MOMENT_MS = 1100;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Whether the welcome step follows the planting season: on the live site (Vercel's production, or a production build
 * elsewhere), unless the address says ?rehearsal. Previews and development servers plant practice seeds at any time.
 */
const SEASON_GATED =
  (process.env.NEXT_PUBLIC_VERCEL_ENV ? process.env.NEXT_PUBLIC_VERCEL_ENV === "production" : process.env.NODE_ENV === "production") &&
  !(typeof window !== "undefined" && new URLSearchParams(window.location.search).has("rehearsal"));

/** On a development server, ?season=early or ?season=closed shows what the live site shows then. */
const PREVIEW_SEASON: Season | null = (() => {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const asked = new URLSearchParams(window.location.search).get("season");
  return asked === "early" || asked === "open" || asked === "closed" ? asked : null;
})();

const seasonNow = (): Season => PREVIEW_SEASON ?? (SEASON_GATED ? giftSeasonAt() : "open");

/** When the season shown can next change by itself, or null (a development server's ?season=, or no gate at all). */
const nextSeasonChangeMs = (): number | null => (PREVIEW_SEASON || !SEASON_GATED ? null : nextGiftSeasonChangeMs());

/** "Plant the Night Jasmine", "Plant the Island Bloom". */
const plantLabel = (name: string) => `Plant the ${name}`;

/** The sign holds any name the server takes (24 characters): longer names get smaller lettering (gift.css). */
function signLength(text: string): "mid" | "long" | undefined {
  const n = Array.from(text).length;
  return n > 18 ? "long" : n > 12 ? "mid" : undefined;
}

/**
 * The season as it stands, moving on by itself when the practice days end and when seeds open (or when a sleeping
 * phone wakes past either moment).
 */
function useSeason(): Season {
  const [season, setSeason] = useState(seasonNow);
  useEffect(() => {
    const next = nextSeasonChangeMs();
    if (next === null) return;
    const look = () => setSeason(seasonNow());
    // setTimeout holds at most about 24.8 days; a page left open longer simply looks again then
    const t = setTimeout(look, Math.min(2_147_000_000, Math.max(1000, next - Date.now() + 500)));
    document.addEventListener("visibilitychange", look);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", look);
    };
  }, [season]);
  return season;
}

export function GiftFlow({
  partyCode,
  onPlanted,
  onEnterGarden,
  onAlreadyPlanted,
}: {
  partyCode: string | null;
  /** the seed is in and this device now holds its session (the care layer can be fetched, ready for the garden) */
  onPlanted: (result: SeedResult) => void;
  onEnterGarden: (result: SeedResult) => void;
  /** the server says this device already holds a garden */
  onAlreadyPlanted: () => void;
}) {
  // The sheet only ever renders in the browser (the door decides after load), so the kept request can seed the state.
  const [kept] = useState(pendingSeed);
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState(kept?.firstName ?? "");
  const [friend, setFriend] = useState(kept ? !kept.showName : false);
  const [species, setSpecies] = useState<SpeciesId | null>(kept?.species ?? null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [seedHint, setSeedHint] = useState(false);
  const [planting, setPlanting] = useState<Planting>({ phase: "waiting", wait: null });
  const [checkingName, setCheckingName] = useState(false);
  const season = useSeason();
  const heading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const nameCheckInFlight = useRef(false);
  // bumped whenever the name changes or the step is left, so a slow answer about an older name is dropped
  const nameCheckSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Each step announces itself: focus moves to its heading (or the name field), so a screen reader follows along.
  useEffect(() => {
    if (step === "name") nameInput.current?.focus({ preventScroll: true });
    else heading.current?.focus({ preventScroll: true });
  }, [step]);

  // The seed renders are fetched while the name is typed, so the cards are ready when they appear.
  useEffect(() => {
    if (step !== "name") return;
    for (const p of SEED_PACKETS) {
      const img = new window.Image();
      img.decoding = "async";
      img.src = p.image;
    }
  }, [step]);

  async function submitName() {
    const check = checkFirstName(name);
    if (!check.ok) {
      setNameError(check.message);
      nameInput.current?.focus();
      return;
    }
    // a second press while the server is asked does nothing
    if (nameCheckInFlight.current) return;
    nameCheckInFlight.current = true;
    const seq = ++nameCheckSeq.current;
    setNameError(null);
    setName(check.name);
    setCheckingName(true);
    // names are unique in the Meadow: ask before the seeds appear (no answer in time: go on, the planting checks again)
    const free = await checkNameFree(check.name, partyCode);
    nameCheckInFlight.current = false;
    if (!mounted.current) return;
    setCheckingName(false);
    // the name was changed, or the step left, while the garden was asked: this answer is about something else now
    if (seq !== nameCheckSeq.current) return;
    if (free && !free.available) {
      setNameError(free.message ?? "That name is already in the Meadow. Please add an initial or a nickname.");
      nameInput.current?.focus();
      return;
    }
    setStep("seed");
  }

  async function plant() {
    const check = checkFirstName(name);
    if (!check.ok) {
      setNameError(check.message);
      setStep("name");
      return;
    }
    if (!species) {
      setSeedHint(true);
      return;
    }
    // a second tap while the first planting is on its way does nothing (the server would answer it as a retry anyway)
    if (inFlight.current) return;
    inFlight.current = true;
    setStep("planting");
    setPlanting({ phase: "waiting", wait: null });
    const reduced = prefersReducedMotion();
    const started = performance.now();
    try {
      const result = await plantSeed({ firstName: check.name, species, showName: !friend }, partyCode, {
        onWait: ({ problem }) => mounted.current && setPlanting({ phase: "waiting", wait: problem.status === 0 ? "offline" : "busy" }),
      });
      // the seed finishes drifting down before it settles in, so it never jumps
      await wait(Math.max(0, (reduced ? REDUCED_ARRIVE_MS : ARRIVE_MS) - (performance.now() - started)));
      if (!mounted.current) return;
      setPlanting({ phase: "planted", result, linkShown: false });
      onPlanted(result);
      await wait(reduced ? REDUCED_MOMENT_MS : MOMENT_MS);
      if (mounted.current) setPlanting({ phase: "planted", result, linkShown: true });
    } catch (err) {
      if (!mounted.current) return;
      const problem = err instanceof ApiProblem ? err : new ApiProblem(0, "offline", OFFLINE_MESSAGE);
      // a name the server would not take, or one someone else took meanwhile, goes back to the name, with its words
      if (problem.body.field === "firstName" && (problem.status === 400 || problem.code === "name_taken")) {
        setNameError(problem.message);
        setStep("name");
        return;
      }
      // this request id was spent on different details: the next try starts a fresh one
      if (problem.code === "seed_request_used") dropSeedRequestId();
      setPlanting({ phase: "failed", problem });
    } finally {
      inFlight.current = false;
    }
  }

  let body: ReactNode;
  let foot: ReactNode;
  const back = (to: Step) => (
    <button
      type="button"
      className="gift-secondary gift-back"
      onClick={() => {
        nameCheckSeq.current++;
        setStep(to);
      }}
      aria-label="Back"
    >
      <ArrowLeft size={18} />
    </button>
  );

  if (step === "welcome" && season === "closed") {
    body = (
      <div className="gift-step" key="closed">
        <p className="gift-eyebrow">
          <Sparkle size={16} />A gift from {OWNER}
        </p>
        <h2 ref={heading} tabIndex={-1} className="gift-title">
          The planting season is over
        </h2>
        <p className="gift-text">Planting closed on 10 December. {OWNER}&rsquo;s Enchanted Rose is here for you to enjoy.</p>
      </div>
    );
  } else if (step === "welcome") {
    const early = season === "early";
    body = (
      <div className="gift-step" key="welcome">
        <p className="gift-eyebrow">
          <Sparkle size={16} />A gift from {OWNER}
        </p>
        <h2 ref={heading} tabIndex={-1} className="gift-title">
          A seed, just for you
        </h2>
        <p className="gift-text">This Enchanted Rose, grown by {OWNER}, is in full bloom. There is a seed waiting for you too.</p>
        {early ? (
          <p className="gift-text">
            You can choose your flower and plant it at the party. Keep this page open, or scan the code again then. With gentle care,
            it blooms in about two weeks.
          </p>
        ) : (
          <p className="gift-text">
            Choose a flower and plant it today. Look after it a little each day, in the real Bangalore weather. With gentle care, it
            blooms in about two weeks.
          </p>
        )}
      </div>
    );
    foot = early ? (
      <p className="gift-season" role="status">
        <Soil size={18} />
        Seeds open at {seedsOpenText()}
      </p>
    ) : (
      <button type="button" className="gift-primary" onClick={() => setStep("name")}>
        Receive your seed
      </button>
    );
  } else if (step === "name") {
    const preview = checkFirstName(name);
    const shown = friend ? "A friend" : preview.ok ? preview.name : name.trim() || "Your name";
    body = (
      <form
        className="gift-step"
        key="name"
        id="gift-name-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submitName();
        }}
      >
        <h2 ref={heading} tabIndex={-1} className="gift-title gift-title-sm">
          What is your first name?
        </h2>
        <div className="gift-field">
          <label className="gift-label" htmlFor="gift-name">
            First name
          </label>
          <input
            ref={nameInput}
            id="gift-name"
            className="gift-input"
            type="text"
            inputMode="text"
            autoComplete="given-name"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            maxLength={60}
            placeholder="Your first name"
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "gift-name-error" : "gift-name-unique gift-name-note"}
            onChange={(e) => {
              nameCheckSeq.current++;
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
          />
          {nameError ? (
            <p key="error" id="gift-name-error" className="gift-error" role="alert">
              {nameError}
            </p>
          ) : (
            <p key="hint" id="gift-name-unique" className="gift-field-hint">
              Each garden in the Meadow goes by its own name. If a colleague shares your first name, add an initial, like Asha K.
            </p>
          )}
        </div>
        <div className="gift-namecard">
          <div className="gift-sign" aria-hidden="true">
            <span className="gift-sign-board" data-empty={!friend && !preview.ok} data-len={signLength(shown)}>
              {shown}
            </span>
            <span className="gift-sign-stake" />
            <span className="gift-sign-ground" />
          </div>
          <p id="gift-name-note" className="gift-namecard-text">
            This little sign stands by your flower. Everyone in the Meadow can see it.
          </p>
        </div>
        <label className="gift-switch">
          <span>Show &ldquo;A friend&rdquo; instead of my name</span>
          <input type="checkbox" checked={friend} onChange={(e) => setFriend(e.target.checked)} />
          <span className="gift-switch-track" aria-hidden="true" />
        </label>
      </form>
    );
    foot = (
      <div className="gift-sheet-foot-row">
        {back("welcome")}
        <button type="submit" form="gift-name-form" className="gift-primary" disabled={checkingName} aria-busy={checkingName || undefined}>
          Next
        </button>
      </div>
    );
  } else if (step === "seed") {
    body = (
      <div className="gift-step" key="seed">
        <h2 ref={heading} tabIndex={-1} className="gift-title gift-title-sm">
          Choose your seed
        </h2>
        <p className="gift-text">Seven seeds, each with its own nature. Pick the one that feels like yours.</p>
        <SeedPicker
          value={species}
          onChange={(id) => {
            setSpecies(id);
            setSeedHint(false);
            // the courtyard's own chunk starts on its way now, so it is in by "Go to my garden"
            if (isLotus(id)) preloadCourtyard();
          }}
        />
      </div>
    );
    foot = (
      <>
        {seedHint && (
          <p className="gift-note" role="alert" style={{ textAlign: "center" }}>
            Choose one of the seven seeds first.
          </p>
        )}
        <div className="gift-sheet-foot-row">
          {back("name")}
          <button type="button" className="gift-primary" onClick={plant}>
            {species ? plantLabel(packetOf(species).name) : "Plant this seed"}
          </button>
        </div>
      </>
    );
  } else {
    const flower = species ? packetOf(species).name : "flower";
    // a lotus seed starts in a glass of water by its pond (design 2.3), not in the bed
    const jar = species !== null && isLotus(species);
    const person = checkFirstName(name);
    const first = person.ok ? person.name : name;
    let title: string;
    let line: string;
    if (planting.phase === "waiting") {
      title = "Planting your seed";
      line =
        planting.wait === "offline"
          ? "The connection dropped for a moment. Trying again."
          : planting.wait === "busy"
            ? "Lots of seeds are going in at once. Yours will follow in a moment."
            : jar
              ? "Settling it into its glass of water."
              : "Settling it into the bed.";
    } else if (planting.phase === "planted") {
      title = `Welcome to the garden, ${first}`;
      line = jar
        ? `Your ${flower} seed is resting in its glass of water, beside its own koi pond.`
        : `Your ${flower} is tucked into its bed, with its first drink of water.`;
    } else {
      title = "Your seed is safe in your hand";
      // the app's own words for "not yet", as for a busy garden: the server's ends on an exclamation mark
      line = planting.problem.code === "not_yet" ? `Seeds open at ${seedsOpenText()}, at the party. Come back then to plant it.` : planting.problem.message;
    }
    body = (
      <div className="gift-step gift-plant" key="planting">
        <PlantingMoment
          planted={planting.phase === "planted"}
          small={planting.phase === "planted" && planting.linkShown}
          vessel={jar ? "jar" : "bed"}
        />
        <h2 ref={heading} tabIndex={-1} className="gift-title gift-title-sm gift-plant-title">
          {title}
        </h2>
        <p className="gift-text gift-plant-line" role="status" aria-live="polite">
          {line}
        </p>
        {planting.phase === "planted" && planting.linkShown && (
          <LinkPanel link={planting.result.link} variant="first" flowerName={flower} rehearsal={planting.result.me.plant.rehearsal} />
        )}
      </div>
    );
    if (planting.phase === "planted" && planting.linkShown) {
      const result = planting.result;
      foot = (
        <button type="button" className="gift-primary" onClick={() => onEnterGarden(result)}>
          Go to my garden
        </button>
      );
    } else if (planting.phase === "failed") {
      foot = <FailedActions problem={planting.problem} onRetry={plant} onBack={() => setStep("seed")} onHome={onAlreadyPlanted} />;
    }
  }

  return (
    <GiftSheet label={`A gift from ${OWNER}`} foot={foot}>
      {body}
    </GiftSheet>
  );
}

/** What can be done after a planting the server did not take, by what it said. */
function FailedActions({
  problem,
  onRetry,
  onBack,
  onHome,
}: {
  problem: ApiProblem;
  onRetry: () => void;
  onBack: () => void;
  onHome: () => void;
}) {
  if (problem.code === "already_planted") {
    const who = typeof problem.body.firstName === "string" ? problem.body.firstName : null;
    return (
      <button type="button" className="gift-primary" onClick={onHome}>
        {who ? `Go to ${who}'s garden` : "Go to the garden on this device"}
      </button>
    );
  }
  // a lost connection, a busy garden or a hiccup on the server: the same request can simply go again
  const again = problem.status === 0 || problem.status >= 500 || problem.code === "busy_planting" || problem.code === "seed_request_used";
  if (!again || problem.code === "meadow_full" || problem.code === "planting_not_ready") {
    return (
      <button type="button" className="gift-secondary" onClick={onBack}>
        Back
      </button>
    );
  }
  return (
    <div className="gift-sheet-foot-row">
      <button type="button" className="gift-secondary gift-back" onClick={onBack} aria-label="Back">
        <ArrowLeft size={18} />
      </button>
      <button type="button" className="gift-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
