// Hand-written validation for every API body (no schema library): each parser takes the parsed JSON, checks every field
// it uses, and returns either a clean value or a calm, specific message the UI can show as it is. Pure, so the tests
// run without a server.
import type { SpeciesId } from "@/lib/plant/species";
import { isPlotIndex } from "./plots";
import { isTokenShape } from "./tokens";
import { isUnkindName } from "./unkind";

export type Invalid = { ok: false; code: string; message: string; field?: string };
export type Result<T> = { ok: true; value: T } | Invalid;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const invalid = (code: string, message: string, field?: string): Invalid => ({ ok: false, code, message, field });

/**
 * The eight seed packets, in the order the seed picker shows them. Kept in step with the plants.species check (the newest
 * migration), and with every other hand-kept list of species (lib/plant/species-lists.test.ts checks them all).
 */
export const SPECIES_IDS = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lily", "lotus"] as const satisfies readonly SpeciesId[];

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

/**
 * Tidies a first name for the garden sign: NFC, trimmed, single spaces, 1-24 characters, at least one letter, and no
 * word that may not stand on a sign (unkind.ts).
 */
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
  if (isUnkindName(name)) return invalid("name_unkind", "That name can't go on a garden sign. Please choose another.", "firstName");
  return ok(name);
}

/**
 * What someone is told when their name is already on a sign in the Meadow: names are unique, ignoring case (the
 * people_first_name_key index on lower(first_name), migration 0007), so a friend finds the right flower. The example
 * adds an initial to their own name when that still fits on a sign.
 */
export function nameTakenMessage(name: string): string {
  const example = `${name} S`;
  const like = Array.from(example).length <= FIRST_NAME_MAX ? `, like ${example},` : "";
  return `That name is already in the Meadow. Please add an initial or a nickname${like} so friends find the right flower.`;
}

export interface NameCheckInput {
  firstName: string;
  /** as SeedInput.partyCode: the check is behind the same party code as planting */
  partyCode: string | null;
  /**
   * the planting request this device still has pending under that name (SeedInput.requestId), or null: a planting whose
   * answer was lost holds the name already, and must not make it look taken to the person who planted it
   */
  requestId: string | null;
}

/**
 * POST /api/name: { firstName, partyCode?, clientEventId? }, asking whether a name is still free before the seed is
 * chosen. clientEventId is the device's own pending planting request for that name, when it has one.
 */
export function parseNameCheckBody(body: unknown): Result<NameCheckInput> {
  if (!isRecord(body)) return invalid("bad_body", "Please send the name as a JSON object.");
  const name = cleanFirstName(body.firstName);
  if (!name.ok) return name;
  const code = parsePartyCode(body.partyCode);
  if (!code.ok) return code;
  const id = body.clientEventId;
  if (id !== undefined && id !== null && !isUuid(id)) {
    return invalid("client_event_id", "clientEventId, when sent, is the pending planting's UUID.", "clientEventId");
  }
  return ok({ firstName: name.value, partyCode: code.value, requestId: typeof id === "string" ? id.toLowerCase() : null });
}

/** The party code from a body: absent, null or blank is null; anything else must be a short string. */
function parsePartyCode(code: unknown): Result<string | null> {
  if (code !== undefined && code !== null && (typeof code !== "string" || code.trim().length > PARTY_CODE_MAX)) {
    return invalid("party_code_shape", "That party link looks garbled. Scan the QR code again, or ask a colleague for the link.", "partyCode");
  }
  return ok(typeof code === "string" && code.trim() !== "" ? code.trim() : null);
}

const SPECIES_MESSAGE = "Please choose one of the eight seeds: rose, sundrop, magnolia, marigold, island, jasmine, lily or lotus.";

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
  const code = parsePartyCode(body.partyCode);
  if (!code.ok) return code;
  return ok({
    firstName: name.value,
    species: body.species,
    showName: body.showName ?? true,
    requestId: body.clientEventId.toLowerCase(),
    partyCode: code.value,
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

/** POST /api/sprinkle: { plot, clientEventId } where plot is the friend's plot in the Meadow (a bed plot or a river pocket). */
export function parseSprinkleBody(body: unknown): Result<SprinkleInput> {
  if (!isRecord(body)) return invalid("bad_body", "Please send the sprinkle as a JSON object.");
  const plot = body.plot;
  if (typeof plot !== "number" || !isPlotIndex(plot)) {
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
