// Hand-written validation for every API body (no schema library): each parser takes the parsed JSON, checks every field
// it uses, and returns either a clean value or a calm, specific message the UI can show as it is. Pure, so the tests
// run without a server.
import type { SpeciesId } from "@/lib/plant/species";
import { PLOT_LIMIT } from "./plots";
import { isTokenShape } from "./tokens";

export type Invalid = { ok: false; code: string; message: string; field?: string };
export type Result<T> = { ok: true; value: T } | Invalid;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const invalid = (code: string, message: string, field?: string): Invalid => ({ ok: false, code, message, field });

/**
 * The seven seed packets, in the order the seed picker shows them. Kept in step with the plants.species check (the newest
 * migration), and with every other hand-kept list of species (lib/plant/species-lists.test.ts checks them all).
 */
export const SPECIES_IDS = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lotus"] as const satisfies readonly SpeciesId[];

export const CARE_KINDS = ["water", "shade", "cover", "feed", "tend", "talk", "revive", "replant"] as const;
export type CareKind = (typeof CARE_KINDS)[number];

export const FIRST_NAME_MAX = 24;
// Letters and marks of any script, digits, spaces and the punctuation real names use (O'Brien, Mary-Anne, Jr.).
const NAME_CHARS = /^[\p{L}\p{M}\p{N} .'’()-]+$/u;
const HAS_LETTER = /\p{L}/u;
const CLIENT_EVENT_ID = /^[A-Za-z0-9_.:-]{8,64}$/;
export const PARTY_CODE_MAX = 64;
// what crypto.randomUUID() makes (any RFC 9562 version), in either case
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SeedInput {
  firstName: string;
  species: SpeciesId;
  showName: boolean;
  /**
   * the client's id for this planting request (a UUID, lower-cased), so a retry after a lost response is recognised. It
   * is random and never shown, and a retry must also repeat the same name and species within a short window.
   */
  requestId: string;
  /** the code from the party's QR link (/garden?code=...), trimmed; null when the request carries none (party.ts) */
  partyCode: string | null;
}

export interface CareInput {
  kind: CareKind;
  clientEventId: string;
  /** shade and cover only: put it on (true) or take it off (false) */
  on: boolean | null;
}

export interface SprinkleInput {
  plot: number;
  clientEventId: string;
}

export interface LinkOpenInput {
  /** the personal garden link's token, from the #k= fragment of /garden */
  token: string;
  /** true when the person has seen that this device holds another garden and chose to switch */
  confirmSwitch: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isSpecies(v: unknown): v is SpeciesId {
  return typeof v === "string" && (SPECIES_IDS as readonly string[]).includes(v);
}

/** A client-generated idempotency key: 8-64 characters of letters, digits and _ . : - (a UUID fits). */
export function isClientEventId(v: unknown): v is string {
  return typeof v === "string" && CLIENT_EVENT_ID.test(v);
}

/** A UUID as crypto.randomUUID() makes it. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Tidies a first name for the garden sign: NFC, trimmed, single spaces, 1-24 characters, at least one letter. */
export function cleanFirstName(raw: unknown): Result<string> {
  if (typeof raw !== "string" || raw.trim() === "") {
    return invalid("name_required", "Please type your first name, so friends can find your flower.", "firstName");
  }
  const name = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (Array.from(name).length > FIRST_NAME_MAX) {
    return invalid("name_too_long", `That name is a little long for a garden sign; ${FIRST_NAME_MAX} characters at most, please.`, "firstName");
  }
  if (!NAME_CHARS.test(name) || !HAS_LETTER.test(name)) {
    return invalid("name_characters", "Letters, spaces, hyphens and apostrophes work best on a garden sign.", "firstName");
  }
  return ok(name);
}

const SPECIES_MESSAGE = "Please choose one of the seven seeds: rose, sundrop, magnolia, marigold, island, jasmine or lotus.";

/**
 * POST /api/seed: { firstName, species, showName?, clientEventId, partyCode? } where clientEventId is a UUID kept for
 * retries and partyCode is the code from the party's QR link. Whether the code opens planting is party.ts's call; here it
 * only has to be a short string.
 */
export function parseSeedBody(body: unknown): Result<SeedInput> {
  if (!isRecord(body)) return invalid("bad_body", "Please send the seed details as a JSON object.");
  const name = cleanFirstName(body.firstName);
  if (!name.ok) return name;
  if (!isSpecies(body.species)) return invalid("species_unknown", SPECIES_MESSAGE, "species");
  if (body.showName !== undefined && typeof body.showName !== "boolean") {
    return invalid("show_name_type", "showName should be true or false.", "showName");
  }
  if (!isUuid(body.clientEventId)) {
    return invalid("client_event_id", "Each planting needs a clientEventId made with crypto.randomUUID(), kept and sent again if you retry.", "clientEventId");
  }
  const code = body.partyCode;
  if (code !== undefined && code !== null && (typeof code !== "string" || code.trim().length > PARTY_CODE_MAX)) {
    return invalid("party_code_shape", "That party link looks garbled. Scan the QR code again, or ask a colleague for the link.", "partyCode");
  }
  return ok({
    firstName: name.value,
    species: body.species,
    showName: body.showName ?? true,
    requestId: body.clientEventId.toLowerCase(),
    partyCode: typeof code === "string" && code.trim() !== "" ? code.trim() : null,
  });
}

/** POST /api/care: { kind, clientEventId, on? } where on is required for shade and cover. */
export function parseCareBody(body: unknown): Result<CareInput> {
  if (!isRecord(body)) return invalid("bad_body", "Please send the care action as a JSON object.");
  const kind = body.kind;
  if (typeof kind !== "string" || !(CARE_KINDS as readonly string[]).includes(kind)) {
    return invalid("kind_unknown", `kind should be one of: ${CARE_KINDS.join(", ")}.`, "kind");
  }
  if (!isClientEventId(body.clientEventId)) {
    return invalid("client_event_id", "Each care action needs a clientEventId: 8-64 letters, digits or _ . : - (a UUID works).", "clientEventId");
  }
  let on: boolean | null = null;
  if (kind === "shade" || kind === "cover") {
    if (typeof body.on !== "boolean") {
      return invalid("on_required", `Say whether to put the ${kind === "shade" ? "shade cloth" : "rain cover"} on (true) or take it off (false).`, "on");
    }
    on = body.on;
  }
  return ok({ kind: kind as CareKind, clientEventId: body.clientEventId, on });
}

/** POST /api/sprinkle: { plot, clientEventId } where plot is the friend's plot in the Meadow. */
export function parseSprinkleBody(body: unknown): Result<SprinkleInput> {
  if (!isRecord(body)) return invalid("bad_body", "Please send the sprinkle as a JSON object.");
  const plot = body.plot;
  if (typeof plot !== "number" || !Number.isInteger(plot) || plot < 0 || plot >= PLOT_LIMIT) {
    return invalid("plot_unknown", "That plot is not in the Meadow; pick a friend's flower to sprinkle.", "plot");
  }
  if (!isClientEventId(body.clientEventId)) {
    return invalid("client_event_id", "Each sprinkle needs a clientEventId: 8-64 letters, digits or _ . : - (a UUID works).", "clientEventId");
  }
  return ok({ plot, clientEventId: body.clientEventId });
}

/** POST /api/session: { token, confirmSwitch? }, opening a personal garden link on this device. */
export function parseLinkOpenBody(body: unknown): Result<LinkOpenInput> {
  if (!isRecord(body)) return invalid("bad_body", "Please send the garden link as a JSON object.");
  if (!isTokenShape(body.token)) {
    return invalid("link_incomplete", "That garden link looks incomplete. Copy the whole link and open it again.", "token");
  }
  if (body.confirmSwitch !== undefined && typeof body.confirmSwitch !== "boolean") {
    return invalid("confirm_switch_type", "confirmSwitch should be true or false.", "confirmSwitch");
  }
  return ok({ token: body.token, confirmSwitch: body.confirmSwitch === true });
}
