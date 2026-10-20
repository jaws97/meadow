// A lily's stem of flowers (lib/plant/raceme): laid out the same for the same seed, only for a species that has one,
// bottom-up with the bud at the tip; the lowest swells and opens first, the later ones on the mornings after, read off
// the bloom clock.
import { describe, expect, it } from "vitest";
import { heroBudGrowth } from "@/components/garden/garden/heroGrowth";
import {
  BUD_SHOWN,
  openedSince,
  pedicelShape,
  racemeBudGrowth,
  racemeHeadScale,
  racemeNodes,
  racemeOpen,
  racemeStalkGrowth,
  racemeStalkLean,
} from "@/lib/plant/raceme";
import { ALL_SPECIES, SPECIES } from "@/lib/plant/species";

const lily = SPECIES.lily;
const SEGMENTS = lily.stem.segments;

describe("racemeNodes", () => {
  it("is the same for the same seed, and differs between seeds", () => {
    expect(racemeNodes("typical-199", lily, SEGMENTS)).toEqual(racemeNodes("typical-199", lily, SEGMENTS));
    expect(racemeNodes("typical-199", lily, SEGMENTS)).not.toEqual(racemeNodes("typical-7", lily, SEGMENTS));
  });

  it("gives no nodes to any species without a raceme (its one flower crowns the stem as it always has)", () => {
    for (const id of ALL_SPECIES) {
      const sp = SPECIES[id];
      if (sp.raceme) continue;
      for (const seed of ["Lijas", "typical-0", "typical-199"]) expect(racemeNodes(seed, sp, sp.stem.segments)).toEqual([]);
    }
    expect(ALL_SPECIES.filter((id) => SPECIES[id].raceme)).toEqual(["lily"]);
  });

  it("lays a lily's three flowers bottom-up round the top of the cane, then the bud at its tip", () => {
    for (let s = 0; s < 50; s++) {
      const nodes = racemeNodes(`typical-${s}`, lily, SEGMENTS);
      expect(nodes.map((n) => n.order)).toEqual([0, 1, 2, 3]);
      expect(nodes.map((n) => n.tipBud)).toEqual([false, false, false, true]);
      const along = nodes.map((n) => (n.seg + n.t) / SEGMENTS);
      for (let k = 1; k < along.length; k++) expect(along[k]).toBeGreaterThan(along[k - 1]);
      // over the top of the cane, above its leaves
      expect(along[0]).toBeGreaterThan(1 - lily.raceme!.span - 0.02);
      expect(along[0]).toBeGreaterThanOrEqual(lily.leaves.top! - 0.02);
      const tip = nodes[3];
      expect([tip.seg, tip.t, tip.length]).toEqual([SEGMENTS - 1, 1, 0]);
      for (const n of nodes.slice(0, 3)) {
        expect(n.seg).toBeGreaterThanOrEqual(0);
        expect(n.seg).toBeLessThan(SEGMENTS);
        expect(n.length).toBeGreaterThan(0);
        expect(n.scale).toBeLessThanOrEqual(lily.raceme!.scale);
      }
      // a spiral round the stem: neighbours stand well apart in bearing
      for (let k = 1; k < 3; k++) {
        const d = Math.abs(Math.atan2(Math.sin(nodes[k].yaw - nodes[k - 1].yaw), Math.cos(nodes[k].yaw - nodes[k - 1].yaw)));
        expect(d).toBeGreaterThan(Math.PI / 2);
      }
    }
  });

  it("keeps a node's stalk a slim tube that curves back up", () => {
    const [lead] = racemeNodes("typical-199", lily, SEGMENTS);
    const shape = pedicelShape(lead, lily);
    expect(shape.length).toBe(lead.length);
    expect(shape.r0).toBeGreaterThan(shape.r1);
    expect(shape.r0).toBeLessThan(lily.stem.radius);
    expect(shape.dz).toBeLessThan(0);
  });
});

describe("the buds", () => {
  const nodes = racemeNodes("typical-199", lily, SEGMENTS);

  it("swell lowest first, the tip's never past the flowers'", () => {
    for (let g = 0; g <= 1.0001; g += 0.02) {
      const buds = nodes.map((n) => racemeBudGrowth(heroBudGrowth, g, n));
      for (let k = 1; k < buds.length; k++) expect(buds[k]).toBeLessThanOrEqual(buds[k - 1]);
      expect(buds[0]).toBeCloseTo(heroBudGrowth(g), 12);
    }
  });

  it("grow their stalks only once they show, holding a closed bud close and an open flower out on its full stalk", () => {
    expect(racemeStalkGrowth(0, 0)).toBe(0);
    expect(racemeStalkGrowth(BUD_SHOWN, 1)).toBe(0);
    expect(racemeStalkGrowth(BUD_SHOWN + 0.01, 0)).toBeGreaterThan(0.2);
    expect(racemeStalkGrowth(1, 0)).toBeCloseTo(0.6, 12);
    expect(racemeStalkGrowth(1, 1)).toBe(1);
    for (let b = 0.05; b <= 1; b += 0.05) expect(racemeStalkGrowth(b, 0)).toBeLessThan(racemeStalkGrowth(b, 1));
    expect(racemeStalkLean(nodes[0], 0)).toBeLessThan(racemeStalkLean(nodes[0], 1));
    expect(racemeStalkLean(nodes[0], 1)).toBe(nodes[0].out);
  });

  it("never shrink the tip below the growing tip a lone flower's cane has", () => {
    const tip = nodes[3];
    for (let b = 0; b <= 1; b += 0.05) expect(racemeHeadScale(tip, b)).toBeGreaterThanOrEqual(0.3);
    expect(racemeHeadScale(nodes[0], 1)).toBeCloseTo(nodes[0].scale, 12);
  });
});

describe("racemeOpen, the flowers' mornings", () => {
  const [lead, second, third, tip] = racemeNodes("typical-199", lily, SEGMENTS);

  it("lets the lead follow the model's bloom and keeps the tip bud closed", () => {
    for (const opened of [null, 0, 30, Infinity]) {
      expect(racemeOpen(lead, opened)).toBe(1);
      expect(racemeOpen(tip, opened)).toBe(0);
    }
  });

  it("opens the second flower a day after the lead and the third a day after that", () => {
    expect(racemeOpen(second, null)).toBe(0);
    expect(racemeOpen(second, 2)).toBe(0);
    expect(racemeOpen(second, 21.9)).toBe(0);
    expect(racemeOpen(second, 24)).toBeCloseTo(0.5, 12);
    expect(racemeOpen(second, 26)).toBe(1);
    expect(racemeOpen(third, 26)).toBe(0);
    expect(racemeOpen(third, 45.9)).toBe(0);
    expect(racemeOpen(third, 50)).toBe(1);
  });

  it("shows every flower open with no clock (Infinity)", () => {
    expect([lead, second, third].map((n) => racemeOpen(n, Infinity))).toEqual([1, 1, 1]);
  });

  it("only ever opens further as the hours pass", () => {
    let last = [0, 0];
    for (let h = -5; h <= 60; h += 0.25) {
      const now = [racemeOpen(second, h), racemeOpen(third, h)];
      expect(now[0]).toBeGreaterThanOrEqual(last[0]);
      expect(now[1]).toBeGreaterThanOrEqual(last[1]);
      last = now;
    }
  });
});

describe("openedSince, the bloom clock", () => {
  const at = "2026-10-30T03:30:00.000Z";
  const ms = Date.parse(at);

  it("is null until the flower opens", () => {
    expect(openedSince(null, ms)).toBeNull();
    expect(openedSince(undefined, ms)).toBeNull();
    expect(openedSince("", ms)).toBeNull();
    expect(openedSince("not a time", ms)).toBeNull();
  });

  it("counts the hours since the bloom hour, steps and all", () => {
    expect(openedSince(at, ms)).toBe(0);
    expect(openedSince(at, ms + 90 * 60_000)).toBe(1.5);
    expect(openedSince(at, ms + 26 * 3_600_000)).toBe(26);
    // a device clock a little behind the server's reads as not yet: the later flowers stay closed
    expect(openedSince(at, ms - 3_600_000)).toBe(-1);
  });

  it("opens a lily's flowers on its first, second and third mornings", () => {
    const nodes = racemeNodes("typical-199", lily, SEGMENTS).slice(0, 3);
    const openAt = (hours: number) => nodes.map((n) => racemeOpen(n, openedSince(at, ms + hours * 3_600_000)));
    expect(openAt(2)).toEqual([1, 0, 0]);
    expect(openAt(26)).toEqual([1, 1, 0]);
    expect(openAt(50)).toEqual([1, 1, 1]);
  });
});
