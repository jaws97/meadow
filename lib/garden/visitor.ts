// Whether the doe visits this load of the garden page, decided as the page's modules run (app/garden/page.tsx), before
// the canvas mounts: so on a visit her chunk is already on its way beside the canvas's own, the scene renders her from
// its first frame and the opening compiles and pre-draws her behind the loading veil; and on every other load she
// costs nothing (her code is never downloaded).
//
// She comes only to a colleague's own flower garden, opened from a plain address (no garden link, no party code: those
// may lead to a dialog or the gift), on a device that holds that garden (the remembered look: lib/client/plant), for a
// soil flower tall enough that the camera's framing leaves her a clean place on this screen (components/deer/stations;
// never the lotus courtyard), and never to someone who asks for reduced motion. The calendar
// is lib/garden/deerDays; the device's memory of her is lib/client/deerMemory. ?deer=1 brings her now and ?deer=0
// keeps her away, for the owner's own checks.
//
// Tiny on purpose, and free of three.js and of the deer's code: the page bundle carries it on every load.
import { decideVisit, rememberDay, type DeerVisit } from "@/lib/garden/deerDays";
import { deerOverride, readDeerMemory, writeDeerMemory } from "@/lib/client/deerMemory";
import * as SunCalc from "suncalc";
import { DUSK_ALTITUDE, headHeight, needsDaylight, stationFor } from "@/components/deer/stations";
import { ALL_SPECIES, type SpeciesId } from "@/lib/plant/species";

/** lib/client/plant's remembered look and the session's party code, typed against them rather than imported. */
const LOOK_KEY: (typeof import("@/lib/client/plant"))["LOOK_KEY"] = "garden-plant:v1";
const PARTY_CODE_KEY: (typeof import("@/lib/client/session"))["PARTY_CODE_KEY"] = "garden-party-code:v1";
const LOTUS: SpeciesId = "lotus";
const LOOK_MAX_AGE = 7 * 24 * 3600 * 1000;
/** Bangalore (lib/sky/sun's BANGALORE, which brings three.js with it). */
const LAT = 12.9716;
const LON = 77.5946;

export interface DeerPlan {
  /** the owner's plant seed: her spots and her timing follow it */
  seed: string;
  visit: Extract<DeerVisit, { visit: true }>;
}

let plan: DeerPlan | null = null;
let loading: Promise<typeof import("@/components/deer/DeerVisit")> | null = null;

/** Her chunk: the split point, asked for once. */
export const loadDeer = () => (loading ??= import("@/components/deer/DeerVisit"));

/** The plan for this load (null: she is not here). */
export function deerPlan(): DeerPlan | null {
  return plan;
}

interface Look {
  speciesId?: unknown;
  seed?: unknown;
  at?: unknown;
  target?: { growth?: unknown } | null;
}

function readLook(): { seed: string; speciesId: string; growth: number } | null {
  const l = JSON.parse(window.localStorage.getItem(LOOK_KEY) ?? "null") as Look | null;
  if (!l || typeof l.seed !== "string" || typeof l.speciesId !== "string" || typeof l.at !== "number") return null;
  if (!(Date.now() - l.at < LOOK_MAX_AGE)) return null;
  const growth = typeof l.target?.growth === "number" && Number.isFinite(l.target.growth) ? l.target.growth : 0;
  return { seed: l.seed, speciesId: l.speciesId, growth };
}

function plainAddress(): boolean {
  if (/[#&]k=/.test(window.location.hash) || /[?&](link|code)=/.test(window.location.search)) return false;
  try {
    if (window.sessionStorage.getItem(PARTY_CODE_KEY) !== null) return false;
  } catch {
    // no session storage: no party code kept either
  }
  return true;
}

/**
 * Decides this load's visit and, on a visit, starts her chunk on its way. Run once, at page-module time on the
 * garden page. Also counts today as a day the garden was opened (for the promise), or, on a visit, leaves that to
 * the moment she is seen (markDeerSeen).
 */
export function planDeerVisit(): DeerPlan | null {
  plan = null;
  try {
    const force = deerOverride(window.location.search);
    if (force === false) return null;
    const look = readLook();
    const forced = force === true;
    if (!forced && (!look || !plainAddress())) return null;
    const memory = readDeerMemory();
    const now = Date.now();
    // forced with no garden on this device: the showcase rose's
    const seed = look?.seed ?? "Lijas";
    // a lotus's courtyard, a flower and screen with no clean station for her (components/deer/stations), a tall
    // screen's station after dusk, or a viewer who asks for less motion: she does not come, and the day counts as one
    // without her
    const station =
      look !== null && look.speciesId !== LOTUS && (ALL_SPECIES as readonly string[]).includes(look.speciesId)
        ? stationFor(window.innerWidth / Math.max(1, window.innerHeight), headHeight(look.speciesId as SpeciesId, look.growth))
        : null;
    const lit = station !== null && (!needsDaylight(station) || SunCalc.getPosition(new Date(now), LAT, LON).altitude > DUSK_ALTITUDE);
    const fits = forced || (lit && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const visit: DeerVisit = fits ? decideVisit(seed, now, memory, forced ? true : null) : { visit: false, why: "off" };
    if (!visit.visit) {
      writeDeerMemory(rememberDay(memory, now, false));
      return null;
    }
    plan = { seed, visit };
    loadDeer().catch(() => {});
    return plan;
  } catch {
    return null;
  }
}

/**
 * She has been seen in the showing garden: today is her day on this device (once a day, and the promise restarts). A
 * visit brought by ?deer=1 is the owner's check, not her day, and is not remembered.
 */
export function markDeerSeen(): void {
  if (!plan || plan.visit.why === "forced") return;
  try {
    writeDeerMemory(rememberDay(readDeerMemory(), Date.now(), true));
  } catch {
    // a convenience only
  }
}
