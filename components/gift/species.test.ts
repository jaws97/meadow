// The seed packets (species.ts): seven of them in the server's order, each with its picture, a character line and
// four traits; the lotus written from its pond model, with where it lives and its honest note, in the same words the
// care layer uses.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOTUS_NOTE, SEED_ORDER, SEED_PACKETS, packetOf } from "@/components/gift/species";
import { LOTUS_PICKER_LINE } from "@/lib/client/plant";
import { ALL_SPECIES } from "@/lib/plant/species";
import { POND_SPECIES } from "@/lib/sim";
import { SPECIES_IDS } from "@/lib/server/validate";

describe("the seed packets", () => {
  it("offers all seven seeds, in the server's order, each with a picture on disk", () => {
    expect(SEED_ORDER).toEqual([...SPECIES_IDS]);
    expect([...SEED_ORDER].sort()).toEqual([...ALL_SPECIES].sort());
    expect(SEED_PACKETS.map((p) => p.id)).toEqual([...SEED_ORDER]);
    for (const p of SEED_PACKETS) {
      expect(p.image).toBe(`/gift/species/${p.id}.webp`);
      expect(existsSync(path.join(process.cwd(), "public", p.image))).toBe(true);
      expect(p.traits).toHaveLength(4);
      expect(p.character.length).toBeGreaterThan(0);
      expect(p.about.length).toBeGreaterThan(0);
    }
  });

  it("writes the lotus from its pond: a jar, the koi, a dawn flower, rain that only helps", () => {
    const lotus = packetOf("lotus");
    expect(lotus.name).toBe("Lotus");
    expect(lotus.traits.map((t) => t.kind)).toEqual(["jar", "koi", "opens", "rain"]);
    expect(lotus.traits.map((t) => t.short)).toEqual(["Starts in a jar", "A pinch for the koi", "Opens at dawn", "Rain only helps"]);
    expect(lotus.character).toBe("Needs you most at first, opens at dawn");
    expect(lotus.home).toBe("In its own koi pond");
    expect(lotus.about).toBe(POND_SPECIES.lotus.truth);
    // its flower opens before dawn and closes in the afternoon, as the trait says
    expect(POND_SPECIES.lotus.openHod).toBeLessThan(6);
    expect(POND_SPECIES.lotus.closeHod).toBeGreaterThanOrEqual(12);
  });

  it("gives the lotus the care layer's honest line, and only the lotus a home and a note", () => {
    expect(LOTUS_NOTE).toBe(LOTUS_PICKER_LINE);
    expect(packetOf("lotus").note).toBe(LOTUS_PICKER_LINE);
    for (const p of SEED_PACKETS.filter((x) => x.id !== "lotus")) {
      expect(p.home).toBeUndefined();
      expect(p.note).toBeUndefined();
      expect(p.traits.map((t) => t.kind)).toEqual(["thirst", "heat", "wet", "opens"]);
    }
  });
});
