// The party screen's pure decisions: the QR link, the counter and feed words,
// the feed's diffing and waiting line, the lens shift, the tour's clock, where
// the camera stands for a shot (the party's own, exactly as it always has, and
// the trailer's, with its wider limits and its pan), the coda's match to the
// party's rose, and the golden hour.
import qrcode from "qrcode-generator";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  CAMERA_FLOOR,
  codaShift,
  counterNumber,
  counterWords,
  drift,
  DRIFT_REST,
  ease,
  ELEVATION,
  enqueue,
  FEED_QUEUE_MAX,
  GLIDE_S,
  gardenLink,
  goldenHour,
  HOLD_S,
  HOME,
  latestPlantings,
  LENS_REST,
  lensShift,
  MAX_AZIMUTH,
  newPlantings,
  nextPollDelay,
  parseSnapshot,
  PARTY_CODE_MAX,
  placed,
  placeShot,
  plantedLine,
  plantingKey,
  POLL_MS,
  project,
  readPartyCode,
  readSwitch,
  seedColour,
  seedPhrase,
  showcaseHour,
  TOUR,
  TourPlayer,
  typedLink,
  type Drift,
  type FeedPlot,
  type Planting,
  type Shot,
} from "@/components/party/logic";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { framingFor, LAYOUT, type Framing } from "@/lib/garden/layout";

describe("the party code and the QR link", () => {
  it("reads the code from the screen's address, trimmed as the API trims it", () => {
    expect(readPartyCode("?code=%20Ab12xY9q%20")).toEqual({ kind: "ok", code: "Ab12xY9q" });
    expect(readPartyCode("")).toEqual({ kind: "missing" });
    expect(readPartyCode("?code=")).toEqual({ kind: "missing" });
    expect(readPartyCode("?code=%20%20")).toEqual({ kind: "missing" });
    expect(readPartyCode(`?code=${"a".repeat(PARTY_CODE_MAX)}`).kind).toBe("ok");
    expect(readPartyCode(`?code=${"a".repeat(PARTY_CODE_MAX + 1)}`)).toEqual({ kind: "too_long" });
  });

  it("always points at the live garden, with the code escaped", () => {
    expect(gardenLink("Ab12xY9q")).toBe("https://meadow-phi.vercel.app/garden?code=Ab12xY9q");
    expect(gardenLink("a b&c")).toBe("https://meadow-phi.vercel.app/garden?code=a%20b%26c");
    expect(typedLink(gardenLink("Ab12xY9q"))).toBe("meadow-phi.vercel.app/garden?code=Ab12xY9q");
  });

  it("fits a version 4 code at error correction M for a typical code, so the modules stay large", () => {
    const qr = qrcode(0, "M");
    qr.addData(gardenLink("Ab12xY9qZ7"), "Byte");
    qr.make();
    expect(qr.getModuleCount()).toBe(33);
  });

  it("reads yes/no switches", () => {
    expect(readSwitch("?tour=on", "tour")).toBe(true);
    expect(readSwitch("?tour=1", "tour")).toBe(true);
    expect(readSwitch("?panel=off", "panel")).toBe(false);
    expect(readSwitch("?panel=maybe", "panel")).toBeNull();
    expect(readSwitch("", "panel")).toBeNull();
  });
});

describe("the light", () => {
  it("lights the garden a little before sunset in Bangalore", () => {
    // 10 Nov 2026: sunset in Bangalore is close to 17:50 IST
    const h = goldenHour(new Date("2026-11-10T06:30:00Z"));
    expect(h).toBeGreaterThan(17.1);
    expect(h).toBeLessThan(17.6);
    // mid October matches the development panel's 17:36 preset to within a few minutes
    expect(Math.abs(goldenHour(new Date("2026-10-16T06:30:00Z")) - 17.6)).toBeLessThan(0.15);
  });

  it("takes an hour from the address for a rehearsal, and ignores nonsense", () => {
    const day = new Date("2026-11-10T06:30:00Z");
    expect(showcaseHour("?hour=21.5", day)).toBe(21.5);
    expect(showcaseHour("?hour=25", day)).toBe(goldenHour(day));
    expect(showcaseHour("?hour=dusk", day)).toBe(goldenHour(day));
    expect(showcaseHour("", day)).toBe(goldenHour(day));
  });
});

describe("the counter and the feed", () => {
  const plot = (i: number, name: string, species: FeedPlot["species"] = "rose"): FeedPlot => ({ plot: i, name, species });

  it("speaks plainly", () => {
    expect(plantedLine({ name: "Priya", species: "jasmine" })).toBe("Priya planted a Night Jasmine");
    expect(plantedLine({ name: "Arun", species: "rose" })).toBe("Arun planted an Enchanted Rose");
    expect(plantedLine({ name: "A friend", species: "marigold" })).toBe("A friend planted a Marigold");
    expect(plantedLine({ name: "Ravi", species: "island" })).toBe("Ravi planted an Island Bloom");
    expect(plantedLine({ name: "Test Seed", species: "lotus" })).toBe("Test Seed planted a Lotus");
    expect(plantedLine({ name: "Meera", species: "lily" })).toBe("Meera planted a Pink Lily");
    expect(seedPhrase("lotus")).toBe("a Lotus");
    expect(seedPhrase("lily")).toBe("a Pink Lily");
    expect(counterWords(1)).toBe("seed planted");
    expect(counterWords(2)).toBe("seeds planted");
    expect(counterWords(0)).toBe("seeds planted");
    expect(counterNumber(128)).toBe("128");
    expect(counterNumber(1234)).toBe("1,234");
  });

  it("parses the Meadow snapshot defensively", () => {
    const snap = parseSnapshot({
      v: 1,
      h: 10,
      at: "x",
      count: 3,
      plots: [plot(0, "Priya", "jasmine"), { plot: 1, species: "cactus", name: "Bad" }, { plot: 2.5, species: "rose", name: "X" }, plot(3, "  ")],
    });
    expect(snap).toEqual({ count: 3, plots: [plot(0, "Priya", "jasmine"), plot(3, "A friend")] });
    expect(parseSnapshot({ v: 2, plots: [] })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ v: 1, plots: [plot(0, "A")] })?.count).toBe(1);
    // the lotus and the Pink Lily, the seeds that joined later, are plantings like the others
    expect(parseSnapshot({ v: 1, plots: [plot(4, "Asha", "lotus")] })?.plots).toEqual([plot(4, "Asha", "lotus")]);
    expect(parseSnapshot({ v: 1, plots: [plot(5, "Meera", "lily")] })?.plots).toEqual([plot(5, "Meera", "lily")]);
  });

  it("gives every seed its own dot, the lotus its petals' pink rather than the marigold's amber", () => {
    const ids = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lily", "lotus"] as const;
    const colours = ids.map(seedColour);
    expect(new Set(colours).size).toBe(ids.length);
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    // pink: red well above green, blue between them
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(seedColour("lotus").slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g + 40);
    expect(b).toBeGreaterThan(g);
    expect(seedColour("marigold")).not.toBe(seedColour("lotus"));
  });

  it("gives the Pink Lily a dot of its own among the other pinks: the rose's red, the magnolia's blush, the lotus's petals", () => {
    // CIELAB distance (CIE76): about 2 is the least two colours side by side can be told apart by; small dots on a
    // dark screen, seen across a room, want far more
    const lab = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
      const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(f);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const apart = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
    expect(seedColour("lily")).toBe("#f36fc8");
    for (const other of ["rose", "magnolia", "lotus"] as const) expect(apart(seedColour("lily"), seedColour(other)), other).toBeGreaterThan(30);
  });

  it("finds new plantings oldest first, and the latest ones newest first, in the snapshot's sowing order", () => {
    const known = new Set([plantingKey(plot(0, "Priya"))]);
    const plots = [plot(0, "Priya"), plot(2, "Ravi", "island"), plot(5, "Meera", "sundrop")];
    expect(newPlantings(known, plots).map((p) => p.name)).toEqual(["Ravi", "Meera"]);
    expect(latestPlantings(plots, 2).map((p) => p.name)).toEqual(["Meera", "Ravi"]);
    expect(latestPlantings(plots, 9).map((p) => p.name)).toEqual(["Meera", "Ravi", "Priya"]);
    expect(latestPlantings(plots, 0)).toEqual([]);
    // a removed test plant's plot taken by someone else is a new planting
    expect(newPlantings(known, [plot(0, "Asha")]).map((p) => p.name)).toEqual(["Asha"]);
  });

  it("does not take a lotus in the river (its plot numbered past every bed) for the newest planting", () => {
    // sown in this order: a lotus into pocket 2003, then a rose into bed plot 40
    const plots = [plot(2003, "Lata", "lotus"), plot(40, "Arun", "rose")];
    expect(latestPlantings(plots, 1).map((p) => p.name)).toEqual(["Arun"]);
    expect(newPlantings(new Set(), plots).map((p) => p.name)).toEqual(["Lata", "Arun"]);
  });

  it("keeps the waiting line short in a rush", () => {
    const queue: Planting[] = [];
    const fresh = Array.from({ length: FEED_QUEUE_MAX + 3 }, (_, i) => ({ key: String(i), name: `N${i}`, species: "rose" as const }));
    expect(enqueue(queue, fresh)).toBe(3);
    expect(queue).toHaveLength(FEED_QUEUE_MAX);
    expect(queue[0].name).toBe("N3");
  });

  it("polls every few seconds and backs off to a minute on failures", () => {
    expect(nextPollDelay(0, 0.5)).toBe(POLL_MS);
    expect(nextPollDelay(1, 0.5)).toBe(POLL_MS * 2);
    expect(nextPollDelay(20, 0.5)).toBe(60_000);
    expect(nextPollDelay(0, 0)).toBeLessThan(nextPollDelay(0, 1));
  });
});

describe("the lens", () => {
  it("brings the rose into the open space left of a side panel, never past 30 % of the frame", () => {
    const s = lensShift({ left: 1236, top: 96, width: 588, height: 887 }, { width: 1920, height: 1080 });
    expect(s.y).toBe(0);
    expect(s.x).toBeGreaterThan(0.12);
    expect(s.x).toBeLessThan(0.16);
    const wide = lensShift({ left: 400, top: 96, width: 300, height: 800 }, { width: 800, height: 1080 });
    expect(wide.x).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it("lifts the garden a little over a bottom panel, and rests without one", () => {
    const s = lensShift({ left: 36, top: 340, width: 318, height: 480 }, { width: 390, height: 844 });
    expect(s.x).toBe(0);
    expect(s.y).toBeGreaterThan(0.05);
    expect(s.y).toBeLessThanOrEqual(0.14);
    expect(lensShift(null, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 0 });
  });
});

describe("the camera", () => {
  it("eases from rest to rest", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it("rests at home, tours shot by shot, and glides home when stopped", () => {
    const tour = new TourPlayer();
    expect(tour.step(0)).toEqual(HOME);
    tour.setOn(true, 10);
    expect(tour.step(10)).toEqual(HOME);
    const half = tour.step(10 + GLIDE_S / 2);
    expect(half.dolly).toBeCloseTo((HOME.dolly + TOUR[1].dolly) / 2);
    expect(tour.step(10 + GLIDE_S)).toEqual(TOUR[1]);
    // held, then on to the next shot
    tour.step(10 + GLIDE_S + HOLD_S);
    expect(tour.step(10 + 2 * GLIDE_S + HOLD_S)).toEqual(TOUR[2]);
    // stopped mid-glide it heads home from where it is, without a jump
    const t = 10 + 2 * GLIDE_S + 2 * HOLD_S + GLIDE_S / 3;
    tour.step(10 + 2 * GLIDE_S + 2 * HOLD_S);
    const at = { ...tour.step(t) };
    tour.setOn(false, t);
    expect(tour.step(t)).toEqual(at);
    expect(tour.step(t + GLIDE_S)).toEqual(HOME);
  });

  it("keeps every shot inside the garden room", () => {
    for (const s of TOUR) {
      expect(Math.abs(0.123 + s.yaw)).toBeLessThan(0.62);
      expect(s.dolly).toBeGreaterThanOrEqual(0.66);
    }
  });

  it("wanders gently", () => {
    const d = { yaw: 0, lift: 0, dolly: 1 };
    for (let t = 0; t < 600; t += 0.5) {
      drift(t, 1, d);
      expect(Math.abs(d.yaw)).toBeLessThan(0.06);
      expect(Math.abs(d.lift)).toBeLessThan(0.02);
      expect(Math.abs(d.dolly - 1)).toBeLessThan(0.03);
    }
  });
});

describe("placing the camera", () => {
  /** PartyCamera's place() as it was before placeShot, kept here to prove the party's own camera never moved. */
  function placeBefore(camera: THREE.PerspectiveCamera, f: Framing, head: THREE.Vector3, s: Readonly<Shot>, d: Readonly<Drift>) {
    const TARGET = LAYOUT.camera.target;
    const aimY = Math.min(1.05, Math.max(0.2, head.y * f.targetRise + f.targetLift));
    const aim = new THREE.Vector3(TARGET[0], aimY, TARGET[2]).lerp(head, s.focus);
    const azimuth = Math.min(0.68, Math.max(-0.68, f.azimuth + s.yaw + d.yaw));
    const elevation = Math.min(0.6, Math.max(0.06, f.elevation + s.lift + d.lift));
    const distance = f.distance * s.dolly * d.dolly;
    const flat = Math.cos(elevation) * distance;
    const offset = new THREE.Vector3(Math.sin(azimuth) * flat, Math.sin(elevation) * distance, Math.cos(azimuth) * flat);
    camera.position.copy(aim).add(offset);
    if (camera.position.y < 0.12) camera.position.y = 0.12;
    camera.lookAt(aim);
    const fov = f.fov * s.zoom;
    if (Math.abs(camera.fov - fov) > 0.005) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
  /** What PartyCamera now does with a placing. */
  function placeNow(camera: THREE.PerspectiveCamera, f: Framing, head: THREE.Vector3, s: Readonly<Shot>, d: Readonly<Drift>) {
    const at = placeShot(f, head, s, d, placed());
    camera.position.set(at.position.x, at.position.y, at.position.z);
    camera.lookAt(at.look.x, at.look.y, at.look.z);
    if (Math.abs(camera.fov - at.fov) > 0.005) {
      camera.fov = at.fov;
      camera.updateProjectionMatrix();
    }
  }

  const ASPECTS = [16 / 9, 16 / 10];
  const framing = (aspect: number) => framingFor(Math.round(aspect / 0.02) * 0.02);

  it("places the party's camera exactly as it always has, for home and every shot of the tour, at 16:9 and 16:10", () => {
    const heads = [new THREE.Vector3(0, HERO_GROUND_Y + 1.12, 0), new THREE.Vector3(0.04, 1.2, -0.03), new THREE.Vector3(0, 0.3, 0)];
    const drifts: Drift[] = [{ ...DRIFT_REST }, drift(13, 1, { yaw: 0, lift: 0, dolly: 1 }), drift(41, 0.4, { yaw: 0, lift: 0, dolly: 1 })];
    for (const aspect of ASPECTS)
      for (const shot of [HOME, ...TOUR])
        for (const head of heads)
          for (const d of drifts) {
            const before = new THREE.PerspectiveCamera(40, aspect, 0.05, 80);
            const now = new THREE.PerspectiveCamera(40, aspect, 0.05, 80);
            placeBefore(before, framing(aspect), head, shot, d);
            placeNow(now, framing(aspect), head, shot, d);
            expect(now.position.toArray()).toEqual(before.position.toArray());
            expect(now.quaternion.toArray()).toEqual(before.quaternion.toArray());
            expect(now.fov).toBe(before.fov);
          }
  });

  it("gives the trailer its wider limits, and the party none of them", () => {
    const f = framing(16 / 9);
    const head = { x: 0, y: 1.26, z: 0 };
    const low = { yaw: 0, lift: -0.9, dolly: 0.3, focus: 1, zoom: 1 };
    const high = { yaw: 2, lift: 2, dolly: 0.5, focus: 1, zoom: 1 };
    expect(placeShot(f, head, low, DRIFT_REST, placed()).elevation).toBe(ELEVATION.party[0]);
    expect(placeShot(f, head, low, DRIFT_REST, placed(), LENS_REST, true).elevation).toBe(ELEVATION.trailer[0]);
    expect(placeShot(f, head, high, DRIFT_REST, placed(), LENS_REST, true).elevation).toBe(ELEVATION.trailer[1]);
    expect(placeShot(f, head, high, DRIFT_REST, placed(), LENS_REST, true).azimuth).toBe(MAX_AZIMUTH);
    // a low shot round a seed never goes under the lawn
    expect(placeShot(f, { x: 0, y: 0.167, z: 0 }, low, DRIFT_REST, placed(), LENS_REST, true).position.y).toBe(CAMERA_FLOOR);
  });

  it("pans from the shot's pivot toward the lens's point, and the camera stays where the shot put it", () => {
    const f = framing(16 / 9);
    const head = { x: 0, y: 1.26, z: 0 };
    const s = { yaw: 0.2, lift: 0.02, dolly: 0.29, focus: 1, zoom: 0.75 };
    const plain = placeShot(f, head, s, DRIFT_REST, placed());
    const doe = { x: -1.85, y: 1.15, z: -1.75 };
    const panned = placeShot(f, head, s, DRIFT_REST, placed(), { ...LENS_REST, look: 0.42, target: doe });
    expect(panned.position).toEqual(plain.position);
    expect(panned.look.x).toBeCloseTo(head.x + (doe.x - head.x) * 0.42, 9);
    expect(panned.look.z).toBeCloseTo(head.z + (doe.z - head.z) * 0.42, 9);
    // the rose to the right, the doe to the left of it
    const rose = project(panned, head, 16 / 9, { x: 0, y: 0 });
    const her = project(panned, doe, 16 / 9, { x: 0, y: 0 });
    expect(rose.x).toBeGreaterThan(0.3);
    expect(her.x).toBeLessThan(rose.x);
    // the look point is dead centre
    const centre = project(panned, panned.look, 16 / 9, { x: 0, y: 0 });
    expect(Math.abs(centre.x) + Math.abs(centre.y)).toBeLessThan(1e-9);
  });

  it("projects as three's camera does", () => {
    const f = framing(16 / 10);
    const at = placeShot(f, { x: 0, y: 1.2, z: 0 }, TOUR[2], DRIFT_REST, placed());
    const camera = new THREE.PerspectiveCamera(at.fov, 16 / 10, 0.05, 80);
    camera.position.set(at.position.x, at.position.y, at.position.z);
    camera.lookAt(at.look.x, at.look.y, at.look.z);
    camera.updateMatrixWorld();
    for (const p of [new THREE.Vector3(-0.683, 1.18, -0.458), new THREE.Vector3(1.15, 1.2, -2.9), new THREE.Vector3(0.3, 0.2, 0.4)]) {
      const mine = project(at, p, 16 / 10, { x: 0, y: 0 });
      const theirs = p.clone().project(camera);
      expect(mine.x).toBeCloseTo(theirs.x, 9);
      expect(mine.y).toBeCloseTo(theirs.y, 9);
    }
  });

  it("matches the coda's seed to the party's rose beside the panel, at 35 % across", () => {
    const full = { x: 0, y: 1.26, z: 0 };
    for (const aspect of ASPECTS) {
      const m = codaShift(framing(aspect), aspect, full, { x: 0.143, y: 0 }, { x: 0, y: 0, screenX: 0 });
      expect(m.x).toBeGreaterThan(0.14);
      expect(m.x).toBeLessThan(0.16);
      expect(m.y).toBeGreaterThan(0.07);
      expect(m.y).toBeLessThan(0.09);
      expect(m.screenX).toBeCloseTo(0.35, 2);
    }
  });
});
