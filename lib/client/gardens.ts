"use client";
// Telling gardens apart when two people share a first name. In an office of 300 there will be two Priyas, so the switch
// question, the identity menu and its notes name a garden by its flower too ("Priya's Night Jasmine garden"), and by
// its day when even that is shared ("Priya's Marigold garden, day 3").
//
// A person summary from the server carries only the first name and the plot. The rest comes from what this device has
// seen (the care layer records the garden it shows, lib/client/plant) or, for a garden it has not, from the Meadow's
// read-only view of that plot (GET /api/garden/[plot]: public, and cached by the CDN). What is learned is kept per plot
// in localStorage, a convenience only: without it the words fall back to the first name, as before. Days count IST
// calendar days since planting, as the care panel's chip does ("Planted today", then "Day 1").
import { useEffect, useSyncExternalStore } from "react";
import { getJson } from "@/lib/client/api";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";
import { IST_OFFSET_MIN } from "@/lib/sim/calendar";

/** The first name and plot a garden goes by (lib/client/session PersonSummary), and its flower when the server says. */
export interface GardenRef {
  firstName: string;
  plot: number | null;
  species?: SpeciesId;
}

export interface GardenFacts {
  species: SpeciesId;
  /** the IST calendar day it went in, as a day count, or null when not known */
  plantedDay: number | null;
}

const DAY_MS = 86_400_000;
const KEY = "garden-facts:v1";
/** Plots remembered on this device; the oldest go first. */
const KEEP = 12;
const LOOKUP_MS = 2500;

/** The IST calendar day a moment falls on, as a day count. */
export function istDayOf(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MIN * 60_000) / DAY_MS);
}

// ---- the store --------------------------------------------------------------------------------------------------------

type Entry = GardenFacts & { at: number };
let facts: Record<string, Entry> | null = null;
const listeners = new Set<() => void>();
const asking = new Map<number, Promise<GardenFacts | null>>();

function isSpecies(v: unknown): v is SpeciesId {
  return typeof v === "string" && Object.hasOwn(SPECIES, v);
}

function load(): Record<string, Entry> {
  if (facts) return facts;
  facts = {};
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Record<string, Partial<Entry>> | null;
    if (raw && typeof raw === "object") {
      for (const [plot, e] of Object.entries(raw)) {
        if (!e || !isSpecies(e.species)) continue;
        const plantedDay = typeof e.plantedDay === "number" && Number.isFinite(e.plantedDay) ? e.plantedDay : null;
        facts[plot] = { species: e.species, plantedDay, at: typeof e.at === "number" ? e.at : 0 };
      }
    }
  } catch {
    // a convenience only
  }
  return facts;
}

function save(plot: number, f: GardenFacts) {
  const all = load();
  const was = all[String(plot)];
  if (was && was.species === f.species && was.plantedDay === f.plantedDay) return;
  const next: Record<string, Entry> = { ...all, [String(plot)]: { ...f, at: Date.now() } };
  const plots = Object.keys(next).sort((a, b) => next[b].at - next[a].at);
  for (const old of plots.slice(KEEP)) delete next[old];
  facts = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // kept for this visit only
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** What this device knows about a garden, without asking anyone. */
export function knownFacts(g: GardenRef | null): GardenFacts | null {
  if (!g || typeof window === "undefined") return null;
  const kept = g.plot === null ? null : (load()[String(g.plot)] ?? null);
  if (g.species && isSpecies(g.species)) return { species: g.species, plantedDay: kept?.species === g.species ? kept.plantedDay : null };
  return kept ? { species: kept.species, plantedDay: kept.plantedDay } : null;
}

/** The care layer's record of the garden it is showing (GET /api/me: the plot, the flower, when it went in). */
export function rememberGarden(plot: number | null, species: SpeciesId, plantedAt: string) {
  if (plot === null || typeof window === "undefined") return;
  const t = Date.parse(plantedAt);
  save(plot, { species, plantedDay: Number.isFinite(t) ? istDayOf(t) : null });
}

interface PlotView {
  species?: unknown;
  /** the day of the plant's life, the day it went in being day 1, as of `at` */
  day?: unknown;
  at?: unknown;
}

/**
 * The garden's facts: known already, or asked of the Meadow's view of its plot (at most LOOKUP_MS; null when it cannot
 * say, say for a practice garden this deployment hides).
 */
export function lookUpGarden(g: GardenRef | null): Promise<GardenFacts | null> {
  const known = knownFacts(g);
  if (known || !g || g.plot === null) return Promise.resolve(known);
  const plot = g.plot;
  let ask = asking.get(plot);
  if (!ask) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOOKUP_MS);
    ask = getJson<PlotView>(`/api/garden/${plot}`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok || !isSpecies(res.data.species)) return null;
        const { day, at } = res.data;
        const t = typeof at === "string" ? Date.parse(at) : NaN;
        const plantedDay = typeof day === "number" && Number.isFinite(t) ? istDayOf(t) - (day - 1) : null;
        const f: GardenFacts = { species: res.data.species, plantedDay };
        save(plot, f);
        return f;
      })
      .catch(() => null)
      .finally(() => {
        clearTimeout(timer);
        asking.delete(plot);
      });
    asking.set(plot, ask);
  }
  return ask;
}

/** A garden's facts for a component: what is known now, looked up once in the background when it is not. */
export function useGardenFacts(g: GardenRef | null): GardenFacts | null {
  const plot = g?.plot ?? null;
  const species = g?.species;
  const firstName = g?.firstName ?? "";
  const known = useSyncExternalStore(
    subscribe,
    () => {
      const f = knownFacts(plot === null && !species ? null : { firstName, plot, species });
      return f ? `${f.species}|${f.plantedDay ?? ""}` : "";
    },
    () => "",
  );
  useEffect(() => {
    if (known || plot === null) return;
    void lookUpGarden({ firstName, plot, species });
  }, [known, plot, species, firstName]);
  if (!known) return null;
  const [s, d] = known.split("|");
  return { species: s as SpeciesId, plantedDay: d === "" ? null : Number(d) };
}

// ---- words --------------------------------------------------------------------------------------------------------------

/** "Planted today", "Day 1", "Day 12": IST calendar days since planting, as the care panel's chip counts them. */
export function dayWords(plantedDay: number, nowMs = Date.now()): string {
  const days = istDayOf(nowMs) - plantedDay;
  return days <= 0 ? "Planted today" : `Day ${days}`;
}

/** "Night Jasmine · Day 3", or the flower alone when its day is not known. */
export function factsLine(f: GardenFacts, nowMs = Date.now()): string {
  const name = SPECIES[f.species].name;
  return f.plantedDay === null ? name : `${name} · ${dayWords(f.plantedDay, nowMs)}`;
}

/** "Priya's Night Jasmine garden", or "Priya's garden" when the flower is not known. */
export function gardenName(g: GardenRef, f: GardenFacts | null): string {
  return f ? `${g.firstName}'s ${SPECIES[f.species].name} garden` : `${g.firstName}'s garden`;
}

/**
 * Two gardens named so they can be told apart: by flower ("Priya's Night Jasmine garden", "Priya's Marigold garden"),
 * and by day as well when the name and the flower are both shared ("Priya's Marigold garden, day 3").
 */
export function gardenNames(
  a: GardenRef,
  fa: GardenFacts | null,
  b: GardenRef,
  fb: GardenFacts | null,
  nowMs = Date.now(),
): [string, string] {
  const na = gardenName(a, fa);
  const nb = gardenName(b, fb);
  if (na !== nb || !fa || !fb || fa.plantedDay === null || fb.plantedDay === null || fa.plantedDay === fb.plantedDay) return [na, nb];
  const day = (f: GardenFacts) => dayWords(f.plantedDay as number, nowMs).toLowerCase();
  return [`${na}, ${day(fa)}`, `${nb}, ${day(fb)}`];
}
