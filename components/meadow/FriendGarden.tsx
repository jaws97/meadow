"use client";
// A friend's garden, read-only: the personal garden scene (components/garden, unchanged) showing the plant in one
// Meadow plot, from GET /api/garden/[plot]: their species and seed (so the leaves and petals are theirs), how far it
// has grown, how open its flower is and how it is doing. There is nothing to tend here; the way back is "Back to
// the Meadow", which returns beside their plant. ?plot=rose shows the owner's Enchanted Rose.
//
// The garden scene reads one global store (lib/garden/store), so this view sets it to the friend's plant before
// the canvas mounts and puts it back when it leaves. It also holds the garden's clock by hand (autoClock off, the
// hour kept to Bangalore's every half minute): the scene keeps a still of the viewer's own garden for its next
// opening only while its clock runs by itself, and a friend's garden must never replace that still.
// A friend's lotus opens in its courtyard (components/lotus/product): the store gets its pond as well (the model's
// PondVisual as the garden draws it: the level, the green, the leaves, the koi, the flower's day), and the plant's own
// droop, paling and flower size, so the courtyard shows the pond as it truly is. A friend's lily opens its later
// flowers on its own bloom clock (lib/plant/raceme), read from when its first flower opened.
import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import { loadFriend, type FriendGarden } from "@/components/meadow/data";
import { OWNER_SEED, ROSE_LINE, ROSE_NAME } from "@/components/meadow/plantLook";
import { dayText, moodLine, speciesName } from "@/components/meadow/words";
import { useQuality } from "@/lib/garden/quality";
import { flowerSizeOf, pondShownOf } from "@/lib/client/plantShown";
import { garden, type GardenState } from "@/lib/garden/store";
import { openedSince } from "@/lib/plant/raceme";
import type { PondVisual } from "@/lib/sim/pond";
import { istNow } from "@/lib/sky/sun";
import "@/components/meadow/meadow.css";

const GardenCanvas = dynamic(() => import("@/components/garden/GardenCanvas"), { ssr: false, loading: () => null });

type Which = { kind: "rose" } | { kind: "plot"; plot: number } | { kind: "none" };

const subscribeNever = () => () => {};
const SERVER_WHICH: Which = { kind: "none" };
const serverWhich = (): Which => SERVER_WHICH;
let whichCache: Which | null = null;
const readWhich = (): Which => {
  if (whichCache) return whichCache;
  const raw = new URLSearchParams(window.location.search).get("plot");
  whichCache = raw === "rose" ? { kind: "rose" } : raw !== null && /^\d{1,5}$/.test(raw) ? { kind: "plot", plot: Number(raw) } : { kind: "none" };
  return whichCache;
};

const possessive = (name: string) => (name === "A friend" ? "A friend's" : `${name}'s`);

/**
 * A friend's lotus for the courtyard: its pond as the owner's own garden gets it (pondShownOf, with no moments: nothing
 * is played on a visit) and its plant numbers (flowerSizeOf: the flower head against its growth ramp, a second chance
 * capped at 0.7). Both come from lib/client/plantShown, never lib/client/plant: that module, when it loads, puts this
 * device's own remembered plant into the store, which a friend's garden must not inherit.
 */
function lotusLook(v: PondVisual, generation: number): Partial<GardenState> {
  const flowerSize = flowerSizeOf(v, generation);
  return { droop: v.alive ? v.droop : 0.55, chlorosis: v.chlorosis, rot: 0, pests: v.pests, flowerSize, glow: 0, pond: pondShownOf(v) };
}

type Loaded = { ok: true; friend: FriendGarden } | { ok: false; message: string };

/**
 * The friend's plant in the garden store, for as long as this view is open; with `flowerOpenedAt`, the hours since the
 * flower now shown opened keep to the clock with the hour, so a lily's next flower opens while it is watched.
 */
function useFriendInStore(look: Partial<GardenState> | null, flowerOpenedAt: string | null): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!look) return;
    const before = garden.get();
    const clock = () => (flowerOpenedAt ? { opened: openedSince(flowerOpenedAt, Date.now()) } : {});
    // a friend's garden plays none of this device's own moments (the watering can stays where it stands)
    garden.set({ ...look, ...clock(), autoClock: false, hour: istNow(), canMoment: null });
    const id = window.setInterval(() => garden.set({ hour: istNow(), ...clock() }), 30_000);
    const raf = requestAnimationFrame(() => setReady(true));
    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(raf);
      garden.set({
        speciesId: before.speciesId,
        seed: before.seed,
        growth: before.growth,
        bloom: before.bloom,
        health: before.health,
        moisture: before.moisture,
        scorch: before.scorch,
        droop: before.droop,
        chlorosis: before.chlorosis,
        rot: before.rot,
        pests: before.pests,
        flowerSize: before.flowerSize,
        wither: before.wither,
        shed: before.shed,
        fallen: before.fallen,
        rebud: before.rebud,
        glow: before.glow,
        opened: before.opened,
        pond: before.pond,
        canMoment: null,
        autoClock: before.autoClock,
        hour: before.hour,
      });
    };
  }, [look, flowerOpenedAt]);
  return ready;
}

export function FriendGardenView() {
  const which = useSyncExternalStore(subscribeNever, readWhich, serverWhich);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The veil belongs to the opening only, as on /garden: once the garden has been seen, a later tier change runs
  // behind a held still of the last frame (components/garden/frameHold), never this veil again. It fades out over
  // the reveal, as /garden's and the Meadow's do, and is gone once the garden is live.
  const opened = useQuality((s) => !s.veiled || s.phase === "revealing" || s.phase === "live");
  const settled = useQuality((s) => !s.veiled || s.phase === "live");

  useEffect(() => {
    if (which.kind !== "plot") return;
    let live = true;
    void loadFriend(which.plot).then((r) => {
      if (live) setLoaded(r.ok ? { ok: true, friend: r.value } : { ok: false, message: r.message });
    });
    return () => {
      live = false;
    };
  }, [which]);

  const [look, setLook] = useState<Partial<GardenState> | null>(null);
  useEffect(() => {
    let next: Partial<GardenState> | null = null;
    const between = { wither: 0, shed: 0, fallen: 0, rebud: 0 };
    if (which.kind === "rose") next = { speciesId: "rose", seed: OWNER_SEED, growth: 1, bloom: 1, health: 1, moisture: 0.6, scorch: 0, opened: Infinity, pond: null, ...between };
    else if (loaded?.ok) {
      const f = loaded.friend, v = f.visual;
      // a lily's later flowers stay closed unless its bloom clock says otherwise (useFriendInStore keeps it from
      // flowerOpenedAt); a flower's last day, its fallen petals and the next bud between flowers come from its visual
      next = { speciesId: f.species, seed: f.seed, growth: v.growth, bloom: v.bloom, health: v.health, moisture: v.moisture, scorch: v.scorch, opened: null, pond: null, ...between };
      if ("rebud" in v) next = { ...next, wither: v.wither, shed: v.shed, fallen: v.fallen, rebud: v.rebud };
      if ("medium" in v && v.medium === "pond") next = { ...next, ...lotusLook(v, f.generation) };
    }
    if (!next) return;
    const id = window.setTimeout(() => setLook(next), 0);
    return () => window.clearTimeout(id);
  }, [which, loaded]);
  const ready = useFriendInStore(look, loaded?.ok ? (loaded.friend.flowerOpenedAt ?? loaded.friend.bloomedAt ?? null) : null);

  const back = which.kind === "plot" ? `/meadow?plot=${which.plot}` : "/meadow";
  const friend = loaded?.ok ? loaded.friend : null;
  const title = which.kind === "rose" ? ROSE_NAME : friend ? `${possessive(friend.name)} garden` : "A friend's garden";
  const sub = which.kind === "rose" ? "Always in bloom" : friend ? `${speciesName(friend.species)} · ${dayText(friend.day)}` : "";
  const line = which.kind === "rose" ? ROSE_LINE : friend ? moodLine(friend) : "";
  const opening = which.kind === "rose" ? "Opening the Enchanted Rose" : friend ? `Opening ${title}` : "Opening a friend's garden";
  const failed = which.kind === "none" ? "That garden could not be found. It may have moved to a new plot." : loaded && !loaded.ok ? loaded.message : null;
  const showing = ready && opened;
  const veilGone = ready && settled && !failed;

  return (
    <main className="meadow-root fixed inset-0 overflow-hidden bg-[#06080f]">
      {ready && <GardenCanvas />}
      <div className="meadow-top">
        <div className="meadow-title" style={{ maxWidth: "min(70vw, 520px)" }}>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
          {line && showing && <p style={{ marginTop: 6 }}>{line}</p>}
        </div>
        <div className="meadow-actions">
          <a className="meadow-pill meadow-glass" href={back}>
            Back to the Meadow
          </a>
        </div>
      </div>
      {!veilGone && (
        <div className={`meadow-veil${showing && !failed ? " meadow-veil-out" : ""}`} aria-hidden={showing && !failed}>
          <div>
            <div className="meadow-veil-art">
              <div className="meadow-veil-halo" />
            </div>
            <p className="meadow-veil-title">{failed ? "This garden is resting" : opening}</p>
            <p className="meadow-veil-line">{failed ?? "Walking over from the Meadow"}</p>
            {failed && (
              <p style={{ marginTop: 18, textAlign: "center" }}>
                <a className="meadow-pill meadow-glass" href={back}>
                  Back to the Meadow
                </a>
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
