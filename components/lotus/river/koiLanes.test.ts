// The river's ambient koi (koiLanes.ts) against the river plan, checked without a browser: twelve fish, each path once
// round the ring and closed, every point of it (the smooth curve the fish follows, not only its waypoints) in the open
// channel clear of the pockets' sill stones on both banks, and through each bridge between its two piers with room
// for the fish's width and its tail's swing; each fish where its spec says at the page's still time, at a calm depth.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { koiCurve, koiHalfWidth } from "@/components/lotus/koi";
import { BRIDGE, buildRiverPlan, POCKET, wrapAngle } from "@/components/lotus/river/plan";
import { channelBand, koiDepth, RIVER_KOI, riverKoiSpec, spanBand } from "@/components/lotus/river/koiLanes";

const P = buildRiverPlan();
const SAMPLES = 2400;
const p = new THREE.Vector3();

/** The widest a fish's body is either side of its line, plus its tail's largest swing (koi.ts laySpine: 0.075 L). */
const halfWidth = (length: number) => length * (Math.max(...Array.from({ length: 41 }, (_, i) => koiHalfWidth(i / 40))) + 0.075 * 1.06);

describe("river koi: the twelve and their lanes", () => {
  it("has twelve fish, both ways round, of 44-62 cm", () => {
    expect(RIVER_KOI.length).toBe(12);
    expect(RIVER_KOI.some((k) => k.dir === 1) && RIVER_KOI.some((k) => k.dir === -1)).toBe(true);
    for (const k of RIVER_KOI) {
      expect(k.length).toBeGreaterThanOrEqual(0.44);
      expect(k.length).toBeLessThanOrEqual(0.62);
    }
  });

  it("closes each path once round the ring (its length near the channel's middle circle)", () => {
    const ring = 2 * Math.PI * P.river.mid;
    for (const k of RIVER_KOI) {
      const spec = riverKoiSpec(k, P);
      const curve = koiCurve(spec);
      expect(Math.abs(curve.getLength() - ring) / ring).toBeLessThan(0.04);
    }
  });

  it("keeps every point of every path in the open channel, clear of the pockets' stones on both banks", () => {
    const band = channelBand(P);
    // the band already leaves the fish's half-width and a little water past the stones round each pocket's front
    expect(band.lo - (P.river.wIn + POCKET.out)).toBeGreaterThan(0.25);
    expect(P.river.wOut - POCKET.out - band.hi).toBeGreaterThan(0.25);
    for (const k of RIVER_KOI) {
      const curve = koiCurve(riverKoiSpec(k, P));
      for (let i = 0; i < SAMPLES; i++) {
        curve.getPointAt(i / SAMPLES, p);
        const r = Math.hypot(p.x, p.z);
        expect(r).toBeGreaterThan(band.lo - 0.03);
        expect(r).toBeLessThan(band.hi + 0.03);
      }
    }
  });

  it("threads each bridge's middle span, between the piers, with room for the fish's width and its tail", () => {
    const span = spanBand(P);
    const b0 = P.bridges[0];
    for (const k of RIVER_KOI) {
      const curve = koiCurve(riverKoiSpec(k, P));
      const w = halfWidth(k.length);
      for (let i = 0; i < SAMPLES; i++) {
        curve.getPointAt(i / SAMPLES, p);
        const r = Math.hypot(p.x, p.z);
        const a = Math.atan2(p.z, p.x);
        for (const b of P.bridges) {
          // the piers and their cutwaters reach about 1.95 m either side of the bridge's middle line
          if (Math.abs(wrapAngle(a - b.a)) * r > BRIDGE.mouthHalf + 0.1) continue;
          expect(r - w).toBeGreaterThan(b0.piers[0] + BRIDGE.pierT / 2);
          expect(r + w).toBeLessThan(b0.piers[1] - BRIDGE.pierT / 2);
          expect(r).toBeGreaterThan(span.lo - 0.03);
          expect(r).toBeLessThan(span.hi + 0.03);
        }
      }
    }
  });

  it("puts each fish where its spec says at the still time, at a calm depth just under the surface", () => {
    for (const k of RIVER_KOI) {
      const spec = riverKoiSpec(k, P);
      const curve = koiCurve(spec);
      const total = curve.getLength();
      curve.getPointAt((spec.stillArc % total) / total, p);
      expect(Math.abs(wrapAngle(Math.atan2(p.z, p.x) - k.stillAngle))).toBeLessThan(0.03);
      for (let a = 0; a < Math.PI * 2; a += 0.1) {
        const d = koiDepth(k, a);
        expect(d).toBeGreaterThan(0.03);
        expect(d).toBeLessThan(0.2);
      }
    }
  });
});
