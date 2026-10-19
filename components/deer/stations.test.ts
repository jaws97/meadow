import { describe, expect, it } from "vitest";
import { headHeight, screenShape, stationFor } from "@/components/deer/stations";

describe("where the doe stands", () => {
  it("knows the screen shapes the camera frames differently", () => {
    expect(screenShape(0.46)).toBe("phone");
    expect(screenShape(0.72)).toBe("tabletPortrait");
    expect(screenShape(1)).toBe("square");
    expect(screenShape(1.33)).toBe("tabletLandscape");
    expect(screenShape(1.6)).toBe("laptop");
    expect(screenShape(1.78)).toBe("wide");
  });

  it("stands at the back of a laptop's garden for a rose in full bloom", () => {
    expect(stationFor(1.6, headHeight("rose", 1))).toBe("back");
    expect(stationFor(1.78, headHeight("sundrop", 1))).toBe("back");
  });

  it("comes nearer for a shorter bloom, and stays away from a young plant", () => {
    expect(stationFor(1.6, headHeight("jasmine", 1))).toBe("lawn");
    expect(stationFor(1.6, headHeight("marigold", 1))).toBeNull();
    expect(stationFor(1.6, headHeight("rose", 0.2))).toBeNull();
    expect(stationFor(1.6, 0)).toBeNull();
  });

  it("keeps to the portrait station on a phone, only where the frame leaves her room", () => {
    expect(stationFor(0.46, headHeight("rose", 1))).toBe("portrait");
    expect(stationFor(0.46, headHeight("magnolia", 1))).toBe("portrait");
    expect(stationFor(0.46, headHeight("island", 1))).toBeNull();
    expect(stationFor(1, headHeight("rose", 1))).toBeNull();
  });

  it("grows the flower's head with its cane", () => {
    expect(headHeight("rose", 1)).toBeCloseTo(1, 5);
    expect(headHeight("rose", 0.5)).toBeLessThan(headHeight("rose", 0.8));
  });
});
