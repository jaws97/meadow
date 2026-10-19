// The party screen's pure decisions: the QR link, the counter and feed words,
// the feed's diffing and waiting line, the lens shift, the tour's clock and
// the golden hour. (The project's vitest include covers lib/** and tests/**;
// run these with `npx vitest run components/party` once components/** is
// added there.)
import qrcode from "qrcode-generator";
import { describe, expect, it } from "vitest";
import {
  counterNumber,
  counterWords,
  drift,
  ease,
  enqueue,
  FEED_QUEUE_MAX,
  GLIDE_S,
  gardenLink,
  goldenHour,
  HOLD_S,
  HOME,
  latestPlantings,
  lensShift,
  newPlantings,
  nextPollDelay,
  parseSnapshot,
  PARTY_CODE_MAX,
  plantedLine,
  plantingKey,
  POLL_MS,
  readPartyCode,
  readSwitch,
  seedColour,
  seedPhrase,
  showcaseHour,
  TOUR,
  TourPlayer,
  typedLink,
  type FeedPlot,
  type Planting,
} from "@/components/party/logic";

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
    expect(seedPhrase("lotus")).toBe("a Lotus");
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
    // the seventh seed is a planting like the others
    expect(parseSnapshot({ v: 1, plots: [plot(4, "Asha", "lotus")] })?.plots).toEqual([plot(4, "Asha", "lotus")]);
  });

  it("gives every seed its own dot, the lotus its petals' pink rather than the marigold's amber", () => {
    const ids = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lotus"] as const;
    const colours = ids.map(seedColour);
    expect(new Set(colours).size).toBe(ids.length);
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    // pink: red well above green, blue between them
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(seedColour("lotus").slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g + 40);
    expect(b).toBeGreaterThan(g);
    expect(seedColour("marigold")).not.toBe(seedColour("lotus"));
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
