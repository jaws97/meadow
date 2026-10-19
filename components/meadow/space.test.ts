// The glide mover against the river's copings, without a browser: a disc pressed against a coping and sliding along it
// rides over the joints between its barrier stones (a convex run of overlapping boxes), and the glider's autopilot,
// set down where a guest's keys had pushed it into the outer coping, drives off to a tap on the deck or the towpath
// instead of holding still against the wall until "Unstuck".
import { describe, expect, it } from "vitest";
import { Autopilot } from "@/components/meadow/autopilot";
import { meadowLayout } from "@/components/meadow/layout";
import { createCommand, createMoverState, type Mover } from "@/components/meadow/mover";
import { pushOut, type P2 } from "@/components/meadow/space";

const R = meadowLayout().river.band;
const DEG = Math.PI / 180;
const DT = 1 / 60;
/** GlideMover.tsx: its wall radius, acceleration and top speed. */
const RADIUS = 0.5;
const ACCEL = 10;
const TOP = 5;

const polar = (r: number, a: number): P2 => ({ x: r * Math.cos(a), z: r * Math.sin(a) });
const angleOf = (p: P2) => Math.atan2(p.z, p.x);

/** One glider step toward the wished velocity, as GlideMover.tsx steps: pushed out of the walls, keeping only what they allowed. */
function glide(p: P2, v: P2, wx: number, wz: number, speed: number): void {
  const len = Math.hypot(wx, wz) || 1;
  const dx = (wx / len) * speed - v.x;
  const dz = (wz / len) * speed - v.z;
  const d = Math.hypot(dx, dz);
  const k = d > ACCEL * DT ? (ACCEL * DT) / d : 1;
  v.x += dx * k;
  v.z += dz * k;
  const before = { x: p.x, z: p.z };
  const was = Math.hypot(v.x, v.z);
  p.x += v.x * DT;
  p.z += v.z * DT;
  if (pushOut(p, RADIUS)) {
    v.x = (p.x - before.x) / DT;
    v.z = (p.z - before.z) / DT;
    const now = Math.hypot(v.x, v.z);
    if (now > was) {
      v.x *= was / now;
      v.z *= was / now;
    }
  }
}

/** A glider for the autopilot to drive: the mover's state over `glide`. */
function glider(at: P2): Mover & { p: P2; v: P2; step(): void } {
  const state = createMoverState();
  const m = {
    kind: "glide" as const,
    holonomic: true,
    wheelbase: 0,
    state,
    command: createCommand(),
    p: { ...at },
    v: { x: 0, z: 0 },
    minTurnRadius: () => 0,
    steerLock: () => Math.PI / 2,
    hop: () => undefined,
    respawn: () => undefined,
    step() {
      const c = m.command;
      if (c.kind === "wish" && c.power > 0) glide(m.p, m.v, c.x, c.z, c.power * TOP);
      else glide(m.p, m.v, 0, 0, 0);
      state.position.set(m.p.x, 0, m.p.z);
      state.velocity.set(m.v.x, 0, m.v.z);
      state.speed = Math.hypot(m.v.x, m.v.z);
    },
  };
  m.step();
  return m;
}

describe("the glider at the river's copings", () => {
  it("slides along the outer coping past the joints of its barrier stones, both ways", () => {
    for (const dir of [1, -1]) {
      // pressed a centimetre into the towpath face, steering a little into the wall as it goes
      const p = polar(R.c1 + RADIUS - 0.01, 10 * DEG);
      const v = { x: 0, z: 0 };
      const a0 = angleOf(p);
      for (let i = 0; i < 120; i++) {
        const a = angleOf(p);
        const t = { x: -Math.sin(a) * dir, z: Math.cos(a) * dir };
        glide(p, v, t.x - 0.25 * Math.cos(a), t.z - 0.25 * Math.sin(a), 2);
      }
      // two seconds at 2 m/s along a 19.65 m radius is about 11.7 degrees, past two or three joints (one every 4.3)
      expect(Math.abs(angleOf(p) - a0) / DEG).toBeGreaterThan(9);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(R.c1);
    }
  });

  it("slides along the inner coping too", () => {
    for (const dir of [1, -1]) {
      const p = polar(R.c0 - RADIUS + 0.01, 10 * DEG);
      const v = { x: 0, z: 0 };
      const a0 = angleOf(p);
      for (let i = 0; i < 120; i++) {
        const a = angleOf(p);
        glide(p, v, -Math.sin(a) * dir + 0.25 * Math.cos(a), Math.cos(a) * dir + 0.25 * Math.sin(a), 2);
      }
      expect(Math.abs(angleOf(p) - a0) / DEG).toBeGreaterThan(12);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(R.c0);
    }
  });

  it("drives off from against the outer coping to a tap on the deck, the towpath or across the river", () => {
    const snag = polar(19.64, 2.8 * DEG);
    const taps: P2[] = [polar(R.mid, 45 * DEG), polar(20.45, 22 * DEG), polar(12.85, 30 * DEG), polar(R.c1 - 0.6, 45 * DEG)];
    for (const tap of taps) {
      const m = glider(snag);
      const pilot = new Autopilot();
      const goal = pilot.goTo({ x: m.p.x, z: m.p.z }, tap.x, tap.z);
      let t = 0;
      while (pilot.active && t < 30) {
        if (pilot.update(m, DT, m.command)) m.step();
        else break;
        t += DT;
      }
      expect(pilot.active, `tap at ${angleOf(tap) / DEG} deg, r ${Math.hypot(tap.x, tap.z)}`).toBe(false);
      expect(Math.hypot(m.p.x - goal.x, m.p.z - goal.z)).toBeLessThan(0.5);
    }
  });
});
