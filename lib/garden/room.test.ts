import { describe, expect, it } from "vitest";
import { LAYOUT } from "./layout";
import { bulkAt, roomAlong, treeAt } from "./room";

/** About where the camera's target rides on a full-grown plant. */
const T = [LAYOUT.camera.target[0], 0.8, LAYOUT.camera.target[2]] as const;

/** The unit direction out from the target at compass bearing `az` (from +z, toward +x) and `el` above level. */
function dir(az: number, el: number): [number, number, number] {
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

function room(az: number, el: number, want: number) {
  const [dx, dy, dz] = dir(az, el);
  return roomAlong(T[0], T[1], T[2], dx, dy, dz, want);
}

describe("the garden camera's room", () => {
  it("leaves every default framing exactly where it was composed", () => {
    for (const f of LAYOUT.camera.framings) {
      expect(room(f.azimuth, f.elevation, f.distance)).toBe(f.distance);
    }
  });

  it("stops a turn to the back short of the tall hedge behind the bed", () => {
    const want = 3.71;
    const s = room(Math.PI, 0.163, want);
    expect(s).toBeLessThan(want);
    expect(s).toBeGreaterThan(1.5);
  });

  it("stops a long pull back at the front short of the front hedges", () => {
    const s = room(0, 0.1, 8);
    expect(s).toBeLessThan(6);
    expect(s).toBeGreaterThan(4);
  });

  it("never leaves the camera inside anything, nor with something bulky between it and the flower", () => {
    for (let a = 0; a < 360; a += 5) {
      for (const el of [0.05, 0.16, 0.35, 0.6]) {
        const [dx, dy, dz] = dir((a * Math.PI) / 180, el);
        const s = roomAlong(T[0], T[1], T[2], dx, dy, dz, 6);
        expect(s).toBeGreaterThanOrEqual(0.6);
        expect(s).toBeLessThanOrEqual(6);
        if (s > 0.6) expect(treeAt(T[0] + dx * s, T[1] + dy * s, T[2] + dz * s)).toBe(false);
        // walked in the room's own 4 cm steps: between two of them a line may graze the air kept over a hedge's top,
        // which is what that air is for
        for (let t = 0.6; t <= s; t += 0.04) expect(bulkAt(T[0] + dx * t, T[1] + dy * t, T[2] + dz * t)).toBe(false);
      }
    }
  });
});
