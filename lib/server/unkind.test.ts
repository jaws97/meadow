// Words that may not stand on a garden sign: whole words in English and Indian languages, digit stand-ins, accents,
// stretched letters and spelled-out words are caught, while real names that only hide a rude word are left alone. The
// rude words are written in ROT13 here too, as the lists keep them.
import { describe, expect, it } from "vitest";
import { isUnkindName, rot13 } from "./unkind";

describe("isUnkindName", () => {
  it("catches a listed word on its own or beside a real name, in any case", () => {
    expect(isUnkindName(rot13("shpx"))).toBe(true);
    expect(isUnkindName(rot13("shpx").toUpperCase())).toBe(true);
    expect(isUnkindName(`Ravi ${rot13("phag")}`)).toBe(true);
    expect(isUnkindName(rot13("puhgvln"))).toBe(true);
    expect(isUnkindName(rot13("gurivqvln"))).toBe(true);
    expect(isUnkindName(rot13("ynawn"))).toBe(true);
  });

  it("reads digits as the letters they stand in for, and drops accents", () => {
    expect(isUnkindName(rot13("5u1g"))).toBe(true);
    expect(isUnkindName(rot13("süpx"))).toBe(true);
  });

  it("finds a root inside a longer word, stretched letters and all", () => {
    expect(isUnkindName(rot13("zbgureshpxre"))).toBe(true);
    expect(isUnkindName(rot13("shhhhpx"))).toBe(true);
    expect(isUnkindName(rot13("oubfqvjnyr"))).toBe(true);
  });

  it("reads a name typed letter by letter as one word", () => {
    expect(isUnkindName(rot13("s h p x").toUpperCase())).toBe(true);
    expect(isUnkindName(rot13("f-r-k"))).toBe(true);
    expect(isUnkindName("A K")).toBe(false);
  });

  it("leaves real names alone, even those that hide a rude word or share one with another language", () => {
    for (const name of [
      "Asha", "Asha K", "Priya S", "Kshitij", "Shital", "Shitanshu", "Hancock", "Cockburn", "Dickson", "Nazia",
      "Pornima", "Purnima", "Sonu Nigam", "Cassandra", "Hassan", "Bassi", "Ana L", "Anal", "Annal", "Kutti", "Sunni",
      "Andi", "Patti", "Sule", "Şule", "Kike", "Gandhi", "Lundgren", "Fukuda", "Hitesh", "Chutney", "Mary-Anne",
      "O'Brien", "José María", "प्रिया", "அருள்", "A friend",
    ]) {
      expect(isUnkindName(name), name).toBe(false);
    }
  });
});
