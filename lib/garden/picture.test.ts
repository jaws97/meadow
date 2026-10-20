// The visitor's picture choice (lib/garden/picture): which tier a visit opens on, the guard that drops a choice above
// Auto after a page died on it, and the menu's words. Storage is a stand-in; the guard's page events are the
// browser's and are not run here.
import { describe, expect, it } from "vitest";
import {
  above,
  clearFellBack,
  fallBack,
  fellBackNote,
  guarded,
  picture,
  pictureSummary,
  pictureWarning,
  setPictureChoice,
  startPicture,
  type PictureStorage,
} from "./picture";

function storage(seed: Record<string, unknown> = {}): PictureStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const CHOICE = "garden-picture:v1";
const GUARD = "garden-picture-guard:v1";
const FELL_BACK = "garden-picture-fell-back:v1";
const garden = { party: false, pinnedByUrl: false };

describe("the tier a visit opens on", () => {
  it("is Auto's when nothing was chosen", () => {
    const s = storage();
    expect(startPicture("lite", garden, s)).toBeNull();
    expect(picture.get()).toMatchObject({ choice: "auto", auto: "lite", applies: true, fellBack: null });
    expect(guarded()).toBe(false);
  });

  it("is the tier chosen by hand, which the guard watches when it is above Auto", () => {
    const s = storage({ [CHOICE]: { tier: "cinematic", at: 1 } });
    expect(startPicture("lite", garden, s)).toBe("cinematic");
    expect(picture.get().choice).toBe("cinematic");
    expect(guarded()).toBe(true);
  });

  it("is not watched when the choice is at or below Auto", () => {
    startPicture("balanced", garden, storage({ [CHOICE]: { tier: "lite", at: 1 } }));
    expect(guarded()).toBe(false);
    startPicture("balanced", garden, storage({ [CHOICE]: { tier: "balanced", at: 1 } }));
    expect(guarded()).toBe(false);
  });

  it("ignores a stored tier it does not know", () => {
    expect(startPicture("lite", garden, storage({ [CHOICE]: { tier: "ultra", at: 1 } }))).toBeNull();
    expect(picture.get().choice).toBe("auto");
  });

  it("is never the choice on the party screen", () => {
    const s = storage({ [CHOICE]: { tier: "cinematic", at: 1 } });
    expect(startPicture("balanced", { party: true, pinnedByUrl: false }, s)).toBeNull();
    expect(picture.get()).toMatchObject({ choice: "auto", applies: false });
    expect(guarded()).toBe(false);
    expect(s.data.has(CHOICE)).toBe(true);
  });

  it("gives way to a ?quality= pin, and the guard stands down", () => {
    const s = storage({ [CHOICE]: { tier: "cinematic", at: 1 } });
    expect(startPicture("lite", { party: false, pinnedByUrl: true }, s)).toBeNull();
    expect(picture.get()).toMatchObject({ choice: "cinematic", applies: false });
    expect(guarded()).toBe(false);
  });
});

describe("the guard", () => {
  it("drops a choice above Auto when the last page died on it, and keeps a note for the pill", () => {
    const s = storage({ [CHOICE]: { tier: "cinematic", at: 1 }, [GUARD]: { tier: "cinematic", at: 2 } });
    expect(startPicture("lite", garden, s)).toBeNull();
    expect(picture.get()).toMatchObject({ choice: "auto", fellBack: "cinematic" });
    expect(s.data.has(CHOICE)).toBe(false);
    expect(s.data.has(GUARD)).toBe(false);
    // the note outlives the visit until the pill has said it
    expect(startPicture("lite", garden, s)).toBeNull();
    expect(picture.get().fellBack).toBe("cinematic");
    clearFellBack(s);
    expect(picture.get().fellBack).toBeNull();
    expect(s.data.has(FELL_BACK)).toBe(false);
  });

  it("only clears a mark left for another tier (the choice changed since)", () => {
    const s = storage({ [CHOICE]: { tier: "balanced", at: 1 }, [GUARD]: { tier: "cinematic", at: 2 } });
    expect(startPicture("lite", garden, s)).toBe("balanced");
    expect(s.data.has(GUARD)).toBe(false);
    expect(picture.get().fellBack).toBeNull();
  });

  it("forgets a note nobody saw for a week", () => {
    const s = storage({ [FELL_BACK]: { tier: "cinematic", at: Date.now() - 8 * 24 * 3600 * 1000 } });
    startPicture("lite", garden, s);
    expect(picture.get().fellBack).toBeNull();
    expect(s.data.has(FELL_BACK)).toBe(false);
  });

  it("falls back to Auto when the graphics are lost on a choice", () => {
    const s = storage({ [CHOICE]: { tier: "balanced", at: 1 } });
    startPicture("lite", garden, s);
    fallBack(s);
    expect(picture.get()).toMatchObject({ choice: "auto", fellBack: "balanced" });
    expect(s.data.has(CHOICE)).toBe(false);
    expect(JSON.parse(s.data.get(FELL_BACK) ?? "{}").tier).toBe("balanced");
  });
});

describe("a choice made in the menu", () => {
  it("remembers the tier Auto was drawing, and Auto forgets the choice", () => {
    const s = storage();
    startPicture("balanced", garden, s);
    // the governor had stepped Auto down to lite before the visitor chose
    setPictureChoice("cinematic", "lite", s);
    expect(picture.get()).toMatchObject({ choice: "cinematic", auto: "lite" });
    expect(JSON.parse(s.data.get(CHOICE) ?? "{}").tier).toBe("cinematic");
    // from one hand choice to another, Auto's tier stays what it was
    setPictureChoice("balanced", "cinematic", s);
    expect(picture.get().auto).toBe("lite");
    setPictureChoice("auto", "balanced", s);
    expect(picture.get()).toMatchObject({ choice: "auto", auto: "lite" });
    expect(s.data.has(CHOICE)).toBe(false);
  });
});

describe("the menu's words", () => {
  it("ranks the tiers", () => {
    expect(above("cinematic", "balanced")).toBe(true);
    expect(above("balanced", "lite")).toBe(true);
    expect(above("lite", "lite")).toBe(false);
    expect(above("balanced", "cinematic")).toBe(false);
  });

  it("says what a richer picture may cost, by device", () => {
    expect(pictureWarning("phone")).toBe("May run warm on this phone");
    expect(pictureWarning("tablet")).toBe("May run warm on this tablet");
    expect(pictureWarning("laptop")).toBe("May be less smooth on this laptop");
    expect(pictureWarning("bigscreen")).toBe("May be less smooth on this screen");
  });

  it("names what is on, and what fell back", () => {
    expect(pictureSummary("auto", "lite")).toBe("Auto · Light");
    expect(pictureSummary("cinematic", "lite")).toBe("Cinematic");
    expect(fellBackNote("cinematic", "phone")).toBe("Back on Auto. Cinematic was too much for this phone last time.");
  });
});
