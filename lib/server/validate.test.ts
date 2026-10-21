// Input validation for the API bodies: names that belong on a garden sign get through tidied, anything else gets a
// calm, specific message, and every care and sprinkle field is checked before the server touches the database.
import { describe, expect, it } from "vitest";
import { POND_SPECIES, SIM_SPECIES } from "@/lib/sim";
import { PLOT_LIMIT, WATER_BASE } from "./plots";
import { newToken } from "./tokens";
import { rot13 } from "./unkind";
import {
  FIRST_NAME_MAX,
  SPECIES_IDS,
  cleanFirstName,
  isClientEventId,
  isUuid,
  nameTakenMessage,
  parseCareBody,
  parseLinkOpenBody,
  parseNameCheckBody,
  parseSeedBody,
  parseSprinkleBody,
} from "./validate";

const ID = "3f6c2a9e-8b1d-4c7a-9e2f-1a2b3c4d5e6f";

describe("cleanFirstName", () => {
  it("accepts real names in any script and tidies the spacing", () => {
    expect(cleanFirstName("Priya")).toEqual({ ok: true, value: "Priya" });
    expect(cleanFirstName("  José   María ")).toEqual({ ok: true, value: "José María" });
    expect(cleanFirstName("O'Brien")).toEqual({ ok: true, value: "O'Brien" });
    expect(cleanFirstName("Mary-Anne")).toEqual({ ok: true, value: "Mary-Anne" });
    expect(cleanFirstName("प्रिया")).toEqual({ ok: true, value: "प्रिया" });
    expect(cleanFirstName("அருள்")).toEqual({ ok: true, value: "அருள்" });
    expect(cleanFirstName("Test Seed (delete me)")).toEqual({ ok: true, value: "Test Seed (delete me)" });
  });

  it("normalises to NFC so the same name is stored the same way", () => {
    const decomposed = "José";
    const r = cleanFirstName(decomposed);
    expect(r.ok && r.value).toBe("José");
  });

  it("asks kindly for a missing, long or unusual name", () => {
    for (const blank of [undefined, null, "", "   ", 42]) {
      const r = cleanFirstName(blank);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("name_required");
    }
    const long = cleanFirstName("A".repeat(25));
    expect(!long.ok && long.code).toBe("name_too_long");
    expect(cleanFirstName("A".repeat(24)).ok).toBe(true);
    for (const odd of ["<script>", "Priya 🌸", "1234", "a\u0000b", "@home"]) {
      const r = cleanFirstName(odd);
      expect(!r.ok && r.code).toBe("name_characters");
    }
  });

  it("keeps an offensive word off the sign, in calm words, at the name field (lib/server/unkind)", () => {
    const r = cleanFirstName(`Ravi ${rot13("phag")}`);
    expect(r).toMatchObject({ ok: false, code: "name_unkind", field: "firstName" });
    expect(!r.ok && r.message).toBe("That name can't go on a garden sign. Please choose another.");
    expect(parseNameCheckBody({ firstName: rot13("puhgvln") })).toMatchObject({ ok: false, code: "name_unkind" });
    expect(cleanFirstName("Kshitij").ok).toBe(true);
  });
});

describe("parseSeedBody", () => {
  it("returns a clean seed with defaults", () => {
    expect(parseSeedBody({ firstName: " Asha ", species: "jasmine", clientEventId: ID })).toEqual({
      ok: true,
      value: { firstName: "Asha", species: "jasmine", showName: true, requestId: ID, partyCode: null },
    });
    expect(parseSeedBody({ firstName: "Asha", species: "rose", showName: false, clientEventId: ID.toUpperCase() })).toEqual({
      ok: true,
      value: { firstName: "Asha", species: "rose", showName: false, requestId: ID, partyCode: null },
    });
  });

  it("carries the party code from the QR link, trimmed, and leaves judging it to party.ts", () => {
    const r = parseSeedBody({ firstName: "Asha", species: "rose", clientEventId: ID, partyCode: " Rose-7f3k9q " });
    expect(r.ok && r.value.partyCode).toBe("Rose-7f3k9q");
    for (const none of [undefined, null, "", "   "]) {
      const n = parseSeedBody({ firstName: "Asha", species: "rose", clientEventId: ID, partyCode: none });
      expect(n.ok && n.value.partyCode).toBe(null);
    }
    for (const bad of [42, true, ["Rose"], "x".repeat(65)]) {
      const b = parseSeedBody({ firstName: "Asha", species: "rose", clientEventId: ID, partyCode: bad });
      expect(!b.ok && [b.code, b.field]).toEqual(["party_code_shape", "partyCode"]);
    }
  });

  it("requires a UUID planting id, so a retry key cannot be short or guessable", () => {
    for (const bad of [undefined, null, "", "short", "care:1712345678:ab", "12345678", "3f6c2a9e8b1d4c7a9e2f1a2b3c4d5e6f", "3f6c2a9e-8b1d-0c7a-9e2f-1a2b3c4d5e6f"]) {
      const r = parseSeedBody({ firstName: "Asha", species: "rose", clientEventId: bad });
      expect(!r.ok && [r.code, r.field]).toEqual(["client_event_id", "clientEventId"]);
    }
  });

  it("takes every species the models know: the seven of the bed and the lotus of the pond", () => {
    expect([...SPECIES_IDS].sort()).toEqual([...Object.keys(SIM_SPECIES), ...Object.keys(POND_SPECIES)].sort());
    for (const species of SPECIES_IDS) expect(parseSeedBody({ firstName: "Ravi", species, clientEventId: ID }).ok, species).toBe(true);
    // the Pink Lily joins the bed after the jasmine; the lotus stays last
    expect(SPECIES_IDS.slice(-2)).toEqual(["lily", "lotus"]);
    expect(parseSeedBody({ firstName: "Meera", species: "lily", clientEventId: ID })).toEqual({
      ok: true,
      value: { firstName: "Meera", species: "lily", showName: true, requestId: ID, partyCode: null },
    });
  });

  it("names all eight seeds when the species is unknown", () => {
    const r = parseSeedBody({ firstName: "Asha", species: "tulip", clientEventId: ID });
    expect(!r.ok && r.message).toContain("eight seeds");
    for (const species of SPECIES_IDS) expect(!r.ok && r.message, species).toContain(species);
  });

  it("names the field that is wrong", () => {
    const species = parseSeedBody({ firstName: "Asha", species: "tulip", clientEventId: ID });
    expect(!species.ok && [species.code, species.field]).toEqual(["species_unknown", "species"]);
    const show = parseSeedBody({ firstName: "Asha", species: "rose", showName: "yes", clientEventId: ID });
    expect(!show.ok && show.field).toBe("showName");
    const id = parseSeedBody({ firstName: "Asha", species: "rose", clientEventId: "short" });
    expect(!id.ok && id.field).toBe("clientEventId");
    expect(parseSeedBody(["Asha", "rose"]).ok).toBe(false);
    expect(parseSeedBody(null).ok).toBe(false);
  });
});

describe("unique names", () => {
  it("asks for an initial or a nickname, suggesting one from the person's own name when it still fits on a sign", () => {
    const m = nameTakenMessage("Asha");
    expect(m).toMatch(/^That name is already in the Meadow\./);
    expect(m).toContain("like Asha S,");
    const long = "A".repeat(FIRST_NAME_MAX - 1);
    expect(nameTakenMessage(long)).not.toContain("like");
    expect(nameTakenMessage(long)).toMatch(/nickname so friends find the right flower\.$/);
  });

  it("parses the name step's question as planting parses the name and the party code", () => {
    expect(parseNameCheckBody({ firstName: "  Asha   K ", partyCode: " Rose-7f3k9q " })).toEqual({
      ok: true,
      value: { firstName: "Asha K", partyCode: "Rose-7f3k9q", requestId: null },
    });
    expect(parseNameCheckBody({ firstName: "Asha" })).toEqual({ ok: true, value: { firstName: "Asha", partyCode: null, requestId: null } });
    // the device's own pending planting under that name, so a planting whose answer was lost does not look taken
    const own = parseNameCheckBody({ firstName: "Asha", clientEventId: "3F2504E0-4F89-41D3-9A0C-0305E82C3301" });
    expect(own.ok && own.value.requestId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    const badId = parseNameCheckBody({ firstName: "Asha", clientEventId: "short" });
    expect(badId.ok === false && badId.field).toBe("clientEventId");
    const blank = parseNameCheckBody({ firstName: "  " });
    expect(blank.ok === false && blank.field).toBe("firstName");
    const code = parseNameCheckBody({ firstName: "Asha", partyCode: 7 });
    expect(code.ok === false && code.code).toBe("party_code_shape");
    expect(parseNameCheckBody(null).ok).toBe(false);
  });
});

describe("parseCareBody", () => {
  it("accepts every care kind, with on/off for shade and cover only", () => {
    for (const kind of ["water", "feed", "tend", "talk", "revive", "replant"]) {
      expect(parseCareBody({ kind, clientEventId: ID })).toEqual({ ok: true, value: { kind, clientEventId: ID, on: null } });
    }
    expect(parseCareBody({ kind: "shade", clientEventId: ID, on: true })).toEqual({ ok: true, value: { kind: "shade", clientEventId: ID, on: true } });
    expect(parseCareBody({ kind: "cover", clientEventId: ID, on: false })).toEqual({ ok: true, value: { kind: "cover", clientEventId: ID, on: false } });
    // "on" is ignored where it means nothing
    expect(parseCareBody({ kind: "water", clientEventId: ID, on: true })).toEqual({ ok: true, value: { kind: "water", clientEventId: ID, on: null } });
  });

  it("declines unknown kinds, a missing on/off and a missing or malformed clientEventId", () => {
    const kind = parseCareBody({ kind: "prune", clientEventId: ID });
    expect(!kind.ok && kind.code).toBe("kind_unknown");
    const on = parseCareBody({ kind: "shade", clientEventId: ID });
    expect(!on.ok && on.code).toBe("on_required");
    const onType = parseCareBody({ kind: "cover", clientEventId: ID, on: 1 });
    expect(!onType.ok && onType.code).toBe("on_required");
    for (const bad of [undefined, "", "abc", "x".repeat(65), "has space 123", "semi;colon1"]) {
      const r = parseCareBody({ kind: "water", clientEventId: bad });
      expect(!r.ok && r.code).toBe("client_event_id");
    }
  });
});

describe("parseSprinkleBody", () => {
  it("accepts a plot inside the Meadow: a bed plot or a lotus pocket in the river", () => {
    expect(parseSprinkleBody({ plot: 0, clientEventId: ID })).toEqual({ ok: true, value: { plot: 0, clientEventId: ID } });
    expect(parseSprinkleBody({ plot: PLOT_LIMIT - 1, clientEventId: ID }).ok).toBe(true);
    expect(parseSprinkleBody({ plot: WATER_BASE, clientEventId: ID }).ok).toBe(true);
    expect(parseSprinkleBody({ plot: 2055, clientEventId: ID }).ok).toBe(true);
  });

  it("declines plots outside it and non-integers", () => {
    for (const plot of [-1, PLOT_LIMIT, 1999, 2056, 2000.5, 1.5, "3", "2000", null, Number.NaN]) {
      const r = parseSprinkleBody({ plot, clientEventId: ID });
      expect(!r.ok && r.code).toBe("plot_unknown");
    }
    expect(parseSprinkleBody({ plot: 3 }).ok).toBe(false);
  });
});

describe("isClientEventId", () => {
  it("takes UUIDs and short opaque ids, nothing else", () => {
    expect(isClientEventId(ID)).toBe(true);
    expect(isClientEventId("care:1712345678:ab")).toBe(true);
    expect(isClientEventId("1234567")).toBe(false);
    expect(isClientEventId(12345678)).toBe(false);
  });
});

describe("isUuid", () => {
  it("takes what crypto.randomUUID() makes, in either case", () => {
    for (let i = 0; i < 50; i++) expect(isUuid(crypto.randomUUID())).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    expect(isUuid("care:1712345678:ab")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("parseLinkOpenBody", () => {
  it("takes a link token and an optional confirmSwitch", () => {
    const token = newToken();
    expect(parseLinkOpenBody({ token })).toEqual({ ok: true, value: { token, confirmSwitch: false } });
    expect(parseLinkOpenBody({ token, confirmSwitch: true })).toEqual({ ok: true, value: { token, confirmSwitch: true } });
  });

  it("declines a cut-off token or a non-boolean confirmSwitch", () => {
    const token = newToken();
    for (const bad of [undefined, "", token.slice(0, 42), token + "x", "#k=" + token, 42]) {
      const r = parseLinkOpenBody({ token: bad });
      expect(!r.ok && r.code).toBe("link_incomplete");
    }
    const sw = parseLinkOpenBody({ token, confirmSwitch: "yes" });
    expect(!sw.ok && sw.field).toBe("confirmSwitch");
    expect(parseLinkOpenBody(token).ok).toBe(false);
  });
});
