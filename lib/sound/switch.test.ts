import { describe, expect, it } from "vitest";
import { parseSoundSwitch } from "@/lib/sound/switch";

describe("the address's sound switch", () => {
  it("is nothing when the address has no ?sound", () => {
    expect(parseSoundSwitch(null)).toBeNull();
  });

  it("is on for a bare ?sound and for 1, on, yes and true, in any case", () => {
    for (const word of ["", "1", "on", "YES", "True"]) expect(parseSoundSwitch(word)).toBe("on");
  });

  it("is off for 0, off, no and false, with spaces around them ignored", () => {
    for (const word of [" off ", "0", "No", "false"]) expect(parseSoundSwitch(word)).toBe("off");
  });

  it("is nothing for any other word", () => {
    for (const word of ["maybe", "2", "onn", "of"]) expect(parseSoundSwitch(word)).toBeNull();
  });
});
