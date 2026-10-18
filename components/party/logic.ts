// The party screen's decisions, kept pure so they are tested without a browser:
// which link the QR code carries, what the seed counter and the feed of new
// plantings say, how far the camera's lens slides to keep the rose clear of
// the panel, the slow tour's shots and how the camera glides between them,
// and the golden hour the showcase is lit at.
//
// The QR link always points at the live site (PUBLIC_ORIGIN), whatever host
// serves the party screen: a laptop that opened a Preview or a local build by
// mistake must still send colleagues to the real garden, where their seeds
// count. The party code itself is never written into the code base: it rides
// in the screen's own address (/party?code=...).
import * as SunCalc from "suncalc";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";
import { BANGALORE } from "@/lib/sky/sun";

export const PUBLIC_ORIGIN = "https://meadow-phi.vercel.app";

/** Whose gift this is: the owner's first name, and the plant the screen shows (the garden's own default, lib/garden/store). */
export const OWNER = Object.freeze({ name: "Lijas", seed: "Lijas", species: "rose" as SpeciesId });

/** The longest party code the planting API accepts (lib/server/validate.ts PARTY_CODE_MAX). */
export const PARTY_CODE_MAX = 64;

export type PartyCode = { kind: "missing" } | { kind: "too_long" } | { kind: "ok"; code: string };

/** The party code from the screen's query string, trimmed as the planting API trims it. */
export function readPartyCode(search: string): PartyCode {
  const code = (new URLSearchParams(search).get("code") ?? "").trim();
  if (code === "") return { kind: "missing" };
  if (code.length > PARTY_CODE_MAX) return { kind: "too_long" };
  return { kind: "ok", code };
}

/** The planting link the QR code carries. */
export function gardenLink(code: string, origin: string = PUBLIC_ORIGIN): string {
  return `${origin}/garden?code=${encodeURIComponent(code)}`;
}

/** The same link as people would type it, without the scheme. */
export function typedLink(link: string): string {
  return link.replace(/^https?:\/\//, "");
}

/** A yes/no switch from the query string ("1", "on", "yes", "true"; "0", "off", "no", "false"), or null when absent. */
export function readSwitch(search: string, name: string): boolean | null {
  const v = new URLSearchParams(search).get(name)?.trim().toLowerCase();
  if (v === undefined || v === "") return null;
  if (v === "1" || v === "on" || v === "yes" || v === "true") return true;
  if (v === "0" || v === "off" || v === "no" || v === "false") return false;
  return null;
}

// ---- the light ------------------------------------------------------------------------------------------------------

/**
 * The garden's best light: golden hour, a little under half an hour before
 * sunset in Bangalore on the given day (the garden's lights and layout are
 * composed for this low, warm backlight; the development panel's "Golden
 * hour" preset, 17:36 in mid October, is the same moment). As a fractional
 * IST hour.
 */
export function goldenHour(day: Date = new Date()): number {
  const sunset = SunCalc.getTimes(day, BANGALORE.lat, BANGALORE.lon).sunset?.getTime();
  if (sunset === undefined || !Number.isFinite(sunset)) return 17.5;
  const ist = (((sunset / 3_600_000 + BANGALORE.tz) % 24) + 24) % 24;
  return ist - 0.4;
}

/** The hour the showcase is lit at: `?hour=` (0-24, for a rehearsal or a night look) or golden hour. */
export function showcaseHour(search: string, day: Date = new Date()): number {
  const raw = new URLSearchParams(search).get("hour");
  const h = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(h) && h >= 0 && h <= 24 ? h : goldenHour(day);
}

// ---- the Meadow snapshot ----------------------------------------------------------------------------------------------

/** The parts of a Meadow plot (lib/server/meadow.ts MeadowPlot) the party screen reads. */
export interface FeedPlot {
  plot: number;
  species: SpeciesId;
  /** the first name on the garden sign, or "A friend" */
  name: string;
}

export interface FeedSnapshot {
  count: number;
  plots: FeedPlot[];
}

const isSpecies = (v: unknown): v is SpeciesId => typeof v === "string" && Object.hasOwn(SPECIES, v);

/** GET /api/meadow's body, checked field by field; null when it is not a snapshot this screen understands. */
export function parseSnapshot(body: unknown): FeedSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { v?: unknown; count?: unknown; plots?: unknown };
  if (b.v !== 1 || !Array.isArray(b.plots)) return null;
  const plots: FeedPlot[] = [];
  for (const p of b.plots as unknown[]) {
    if (typeof p !== "object" || p === null) continue;
    const { plot, species, name } = p as { plot?: unknown; species?: unknown; name?: unknown };
    if (typeof plot !== "number" || !Number.isInteger(plot) || !isSpecies(species) || typeof name !== "string") continue;
    plots.push({ plot, species, name: name.trim() || "A friend" });
  }
  const count = typeof b.count === "number" && Number.isFinite(b.count) ? Math.max(0, Math.round(b.count)) : plots.length;
  return { count, plots };
}

/** One planting as the feed shows it. */
export interface Planting {
  key: string;
  name: string;
  species: SpeciesId;
}

/** A planting's identity across snapshots: its plot, species and sign (a removed test plant's plot can be reused). */
export const plantingKey = (p: FeedPlot): string => `${p.plot}|${p.species}|${p.name}`;

const toPlanting = (p: FeedPlot): Planting => ({ key: plantingKey(p), name: p.name, species: p.species });

/**
 * The plantings in a snapshot that `known` has not seen, oldest first. Plots
 * are handed out in planting order (the lowest free one), so within one poll
 * a lower plot was planted earlier.
 */
export function newPlantings(known: ReadonlySet<string>, plots: readonly FeedPlot[]): Planting[] {
  return plots
    .filter((p) => !known.has(plantingKey(p)))
    .sort((a, b) => a.plot - b.plot)
    .map(toPlanting);
}

/** The latest `n` plantings of a snapshot, newest first: what the feed shows when the screen first opens. */
export function latestPlantings(plots: readonly FeedPlot[], n: number): Planting[] {
  return [...plots].sort((a, b) => b.plot - a.plot).slice(0, Math.max(0, n)).map(toPlanting);
}

/** "a Night Jasmine", "an Enchanted Rose". */
export function seedPhrase(species: SpeciesId): string {
  const name = SPECIES[species].name;
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/**
 * The colour of a planting's dot in the feed: the flower's own glow (lib/plant/species fx.glowColor). The lotus glows
 * amber only while its flower is warm, and that amber is the marigold's; its dot is its petals' soft pink instead, so
 * the seven read apart on the big screen.
 */
export function seedColour(species: SpeciesId): string {
  return species === "lotus" ? SPECIES.lotus.flower.colorTip : SPECIES[species].fx.glowColor;
}

/** "Priya planted a Night Jasmine". */
export function plantedLine(p: Pick<Planting, "name" | "species">): string {
  return `${p.name} planted ${seedPhrase(p.species)}`;
}

/** The counter's line before anyone has planted. */
export const FIRST_SEED_LINE = "Be the first to plant a seed";

/** The words after the counter's number. */
export function counterWords(n: number): string {
  return Math.round(n) === 1 ? "seed planted" : "seeds planted";
}

/** The counter's number as written in India (1,00,000 style grouping, though a party of 300 never needs it). */
export function counterNumber(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-IN");
}

/** The poll interval in ms: the CDN refreshes the snapshot every 5 s, so 6 s; on failures it backs off to a minute. */
export const POLL_MS = 6_000;
const POLL_MAX_MS = 60_000;

/** The wait before the next poll after `failures` failed polls in a row, spread by `jitter` (0..1) so screens drift apart. */
export function nextPollDelay(failures: number, jitter: number): number {
  const base = failures <= 0 ? POLL_MS : Math.min(POLL_MAX_MS, POLL_MS * 2 ** Math.min(failures, 8));
  return Math.round(base * (0.85 + 0.3 * Math.min(1, Math.max(0, jitter))));
}

/** Waiting plantings are kept to this many: in a rush the feed skips ahead instead of running minutes behind. */
export const FEED_QUEUE_MAX = 6;

/** Adds fresh plantings to the waiting line, dropping the oldest beyond FEED_QUEUE_MAX; returns how many were dropped. */
export function enqueue(queue: Planting[], fresh: readonly Planting[]): number {
  queue.push(...fresh);
  const over = Math.max(0, queue.length - FEED_QUEUE_MAX);
  if (over > 0) queue.splice(0, over);
  return over;
}

// ---- the lens -------------------------------------------------------------------------------------------------------

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Shift {
  /** share of the frame's width the subject moves left */
  x: number;
  /** share of the frame's height the subject moves up */
  y: number;
}

/**
 * How far to slide the lens so the rose sits in the open part of the screen.
 * Beside a panel on the right, the rose moves to a little right of the middle
 * of the space left of the panel (never further left than 30 % of the frame,
 * so the lantern stays in shot). Above a panel along the bottom (a portrait
 * screen), the garden rises a little; most of the panel then lies over the
 * lawn and the bed, with the bloom above it.
 */
export function lensShift(panel: Rect | null, viewport: { width: number; height: number }): Shift {
  if (!panel || viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 };
  const beside = panel.left > viewport.width * 0.4;
  if (beside) {
    const open = panel.left / viewport.width;
    const want = Math.min(0.5, Math.max(0.3, open / 2 + 0.035));
    return { x: 0.5 - want, y: 0 };
  }
  const open = panel.top / viewport.height;
  return { x: 0, y: Math.min(0.14, Math.max(0, (0.62 - open) * 0.5)) };
}

// ---- the camera -----------------------------------------------------------------------------------------------------

/**
 * One shot, as offsets from the layout's composed framing for the screen's
 * shape (lib/garden/layout LAYOUT.camera.framings): radians round the orbit
 * and of elevation, a share of the framing's distance, how far the aim moves
 * from the garden's middle toward the flower head (0..1), and a share of the
 * framing's lens angle.
 */
export interface Shot {
  yaw: number;
  lift: number;
  dolly: number;
  focus: number;
  zoom: number;
}

export const HOME: Readonly<Shot> = Object.freeze({ yaw: 0, lift: 0, dolly: 1, focus: 0, zoom: 1 });

/**
 * The slow tour, from the composed garden: in close on the bloom, low across
 * the bed from the right, round to the lantern's side, and home again. Every
 * shot stays inside the dressed room (under 0.6 rad from the axis, where the
 * hedges still close the view) and outside the pollen's box, so no mote
 * drifts past the lens as a blur.
 */
export const TOUR: readonly Readonly<Shot>[] = Object.freeze([
  HOME,
  Object.freeze({ yaw: -0.14, lift: 0.07, dolly: 0.68, focus: 0.55, zoom: 0.94 }),
  Object.freeze({ yaw: 0.36, lift: -0.045, dolly: 0.92, focus: 0.18, zoom: 1 }),
  Object.freeze({ yaw: -0.4, lift: 0.035, dolly: 0.88, focus: 0.25, zoom: 1 }),
]);

/** Seconds a glide between shots takes, and how long each shot is held. */
export const GLIDE_S = 14;
export const HOLD_S = 22;

/** Starts and ends at rest, with no jolt at either end (smootherstep). */
export function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function mixShot(a: Readonly<Shot>, b: Readonly<Shot>, t: number, out: Shot): Shot {
  out.yaw = a.yaw + (b.yaw - a.yaw) * t;
  out.lift = a.lift + (b.lift - a.lift) * t;
  out.dolly = a.dolly + (b.dolly - a.dolly) * t;
  out.focus = a.focus + (b.focus - a.focus) * t;
  out.zoom = a.zoom + (b.zoom - a.zoom) * t;
  return out;
}

/**
 * The tour's clock. Off, the camera rests on the composed garden; turned on,
 * it glides to the next shot, holds it, glides on, and loops; turned off, it
 * glides home from wherever it is. Every change starts from where the camera
 * is at that moment, so nothing ever jumps.
 */
export class TourPlayer {
  private from: Shot = { ...HOME };
  private to: Readonly<Shot> = HOME;
  private index = 0;
  private start = -Infinity;
  private on = false;
  readonly current: Shot = { ...HOME };

  get playing(): boolean {
    return this.on;
  }

  setOn(on: boolean, now: number) {
    if (on === this.on) return;
    this.on = on;
    this.from = { ...this.current };
    this.index = on ? (this.index + 1) % TOUR.length : 0;
    this.to = TOUR[this.index];
    this.start = now;
  }

  step(now: number): Readonly<Shot> {
    const t = (now - this.start) / GLIDE_S;
    mixShot(this.from, this.to, ease(t), this.current);
    if (this.on && now - this.start >= GLIDE_S + HOLD_S) {
      this.from = { ...this.to };
      this.index = (this.index + 1) % TOUR.length;
      this.to = TOUR[this.index];
      this.start = now;
    }
    return this.current;
  }
}

export interface Drift {
  yaw: number;
  lift: number;
  dolly: number;
}

/**
 * The camera's resting wander: a few slow sines of unrelated periods (47 to
 * 73 s), so the movement never visibly repeats and never quickens. `amount`
 * scales it (less when the viewer asks for reduced motion).
 */
export function drift(t: number, amount: number, out: Drift): Drift {
  const w = (period: number) => (t / period) * Math.PI * 2;
  out.yaw = amount * (0.034 * Math.sin(w(47)) + 0.017 * Math.sin(w(73) + 1.3));
  out.lift = amount * 0.013 * Math.sin(w(59) + 0.7);
  out.dolly = 1 + amount * 0.022 * Math.sin(w(67) + 2.1);
  return out;
}
