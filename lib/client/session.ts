// The browser's side of who is asking: reading a personal garden link out of the address bar, keeping the party code
// until a seed is planted, and small fetch helpers for the session, link and seed routes (app/api/session, link, seed).
// No React here, so the pure parts are tested in node (session.test.ts).
//
// A garden link is /garden#k=<token>. The token is taken out of the address bar the moment this module loads, before
// anything else on the page runs (analytics included), and kept only in memory until POST /api/session exchanges it
// for the httpOnly session cookie. Without a link, GET /api/session starts at that same moment, so the door can open
// as soon as the page is ready instead of a round trip later. The party code from the QR link (/garden?code=...) is
// kept in sessionStorage, so a reload in the middle of choosing a seed still plants, and forgotten once the seed is in
// (or straight away on a device that already holds a garden).
//
// Addresses are rewritten with history.replaceState(null, ...): Next's router copies its own state into the entry and
// takes the new address as its own, so a later router update does not write the old one (with ?code=) back.
//
// Names are unique in the Meadow: checkNameFree asks the server before the seeds appear, and a planting can still come
// back 409 name_taken (field firstName) when someone took the name in the meantime.
//
// Retries follow the backend's rules: a planting is retried by itself only on 429 busy_planting and 503 busy or
// unavailable (and when the response was lost on the way back), honouring Retry-After with a little jitter, always with
// the same body and the same clientEventId, so the server answers a retry with the original planting instead of
// planting twice. A lost answer is tried again at once when the browser says it is back online. Every other refusal
// comes back as an ApiProblem whose message the UI shows as it is.
import type { SpeciesId } from "@/lib/plant/species";
import type { MeView } from "@/lib/server/garden";

export type { MeView };

// ---- shapes the routes answer with --------------------------------------------------------------------------------

/** The first name and plot a device's garden goes by (GET /api/session, the switch question). */
export interface PersonSummary {
  firstName: string;
  plot: number | null;
}

export interface SessionStatus {
  signedIn: boolean;
  person: PersonSummary | null;
  /** the garden "switch back" would return to, when this device switched gardens */
  previous: PersonSummary | null;
  /** whether anyone may plant without the party link (false only under MEADOW_PLANTING=party); absent from older servers */
  plantingOpen?: boolean;
  /** Google sign-in's word (lib/server/login.ts loginStatus); absent from older servers */
  login?: LoginStatus;
}

/** Google sign-in on this server, for this device (GET /api/session). */
export interface LoginStatus {
  /** sign-in is on here */
  available: boolean;
  /** a seed planted without the party link needs it */
  required: boolean;
  /** this device's garden is kept on a Google account */
  kept: boolean;
  /** an account is signed in on this device, which holds no garden yet: the seed planted next is kept on it */
  pending: boolean;
}

export type LinkOpen =
  | { kind: "open"; status: "signed_in" | "already_here" | "switched"; person: PersonSummary; canSwitchBack: boolean }
  | { kind: "switch_needed"; current: PersonSummary; target: PersonSummary; message: string }
  | { kind: "invalid"; message: string };

export interface SeedRequest {
  firstName: string;
  species: SpeciesId;
  showName: boolean;
}

export interface SeedResult {
  /** the personal garden link, /garden#k=<token>: shown once, the server keeps only its hash */
  link: string;
  replay: boolean;
  me: MeView;
}

/** A refusal or failure from the API, with the server's calm message (status 0: the request never got an answer). */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  /** seconds the server asked us to wait (Retry-After or retryAfterS), when it said */
  readonly retryAfterS: number | null;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, message: string, retryAfterS: number | null = null, body: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiProblem";
    this.status = status;
    this.code = code;
    this.retryAfterS = retryAfterS;
    this.body = body;
  }
}

export const OFFLINE_MESSAGE = "We could not reach the garden. Please check your connection and try again.";
const FALLBACK_MESSAGE = "Something went wrong on our side. Your garden is safe; please try again.";

// ---- the personal garden link in the address bar -------------------------------------------------------------------

/** 32 random bytes as unpadded base64url (lib/server/tokens.ts). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface TakenLink {
  /** the token from #k=, when it looks like one */
  token: string | null;
  /** a link arrived but was cut short (#k= with a damaged token, or ?link=invalid from the old /api/link/<token> form) */
  incomplete: boolean;
  /** the address to show instead: the same page without #k= and ?link= */
  cleaned: string | null;
}

/**
 * Splits a query string or fragment ("a=1&b", with or without its leading ? or #) into its parts, and gives back the
 * rest without the named ones, untouched: URLSearchParams would rewrite a bare "?nopanel" as "?nopanel=".
 */
export function splitParams(part: string, names: readonly string[]): { rest: string; found: Map<string, string> } {
  const found = new Map<string, string>();
  const kept: string[] = [];
  for (const seg of part.replace(/^[?#]/, "").split("&")) {
    if (seg === "") continue;
    const eq = seg.indexOf("=");
    let key = eq < 0 ? seg : seg.slice(0, eq);
    let value = eq < 0 ? "" : seg.slice(eq + 1);
    try {
      key = decodeURIComponent(key.replace(/\+/g, " "));
      value = decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      // a malformed escape: compare it as it stands
    }
    if (names.includes(key)) {
      if (!found.has(key)) found.set(key, value);
    } else kept.push(seg);
  }
  return { rest: kept.join("&"), found };
}

/** Pure: reads #k= and ?link=invalid from a location's parts and says what the address bar should become. */
export function parseLinkLocation(pathname: string, search: string, hash: string): TakenLink {
  const fragment = splitParams(hash, ["k"]);
  const query = splitParams(search, ["link"]);
  const k = fragment.found.get("k") ?? null;
  const oldFormInvalid = query.found.get("link") === "invalid";
  if (k === null && !oldFormInvalid) return { token: null, incomplete: false, cleaned: null };
  const q = oldFormInvalid ? query.rest : search.replace(/^\?/, "");
  const f = k !== null ? fragment.rest : hash.replace(/^#/, "");
  const token = k !== null && TOKEN_RE.test(k) ? k : null;
  return {
    token,
    incomplete: oldFormInvalid || (k !== null && token === null),
    cleaned: `${pathname}${q ? `?${q}` : ""}${f ? `#${f}` : ""}`,
  };
}

let taken: TakenLink | undefined;

function readLocation(): TakenLink {
  const { pathname, search, hash } = window.location;
  const found = parseLinkLocation(pathname, search, hash);
  if (found.cleaned !== null) {
    try {
      window.history.replaceState(null, "", found.cleaned);
    } catch {
      // a sandboxed frame may refuse; the token is still only ever sent to our own API
    }
  }
  return found;
}

/**
 * Takes the garden link token out of the address bar (once per page load) and returns it. Called when this module
 * loads in the browser, so the token is gone from the URL before any other script, analytics included, can read it.
 */
export function takeGardenLink(): TakenLink {
  if (taken) return taken;
  if (typeof window === "undefined") return { token: null, incomplete: false, cleaned: null };
  taken = readLocation();
  return taken;
}

/**
 * A link pasted into the address bar of a page that is already open only changes the fragment (no reload): the page
 * calls this on hashchange to take that token out as well. Null when the new fragment holds no garden link.
 */
export function takeLinkFromHashChange(): TakenLink | null {
  const found = readLocation();
  if (found.cleaned === null) return null;
  taken = found;
  return found;
}

/** Forgets the token once it has been used (or declined), so a later re-render cannot post it again. */
export function forgetGardenLink(): void {
  taken = { token: null, incomplete: false, cleaned: null };
}

// ---- the party code ------------------------------------------------------------------------------------------------

/** The party code kept for this tab (sessionStorage); the opening's first-look script checks for it too (lib/garden/opening). */
export const PARTY_CODE_KEY = "garden-party-code:v1";
const CODE_KEY = PARTY_CODE_KEY;
/** lib/server/validate.ts PARTY_CODE_MAX */
const PARTY_CODE_MAX = 64;

/** The party code from ?code= (kept in sessionStorage for this tab), or the one kept earlier; null when there is none. */
export function capturePartyCode(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = splitParams(window.location.search, ["code"]).found.get("code")?.trim() ?? "";
  if (fromUrl && fromUrl.length <= PARTY_CODE_MAX) {
    try {
      window.sessionStorage.setItem(CODE_KEY, fromUrl);
    } catch {
      // storage blocked: the code still rides in the address bar for this visit
    }
    return fromUrl;
  }
  try {
    return window.sessionStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

/**
 * After a seed is planted, or on a device that already holds a garden: drops the kept code and takes ?code= out of the
 * address bar, so a bookmark or a shared address is just /garden.
 */
export function forgetPartyCode(): void {
  try {
    window.sessionStorage.removeItem(CODE_KEY);
  } catch {
    // nothing kept
  }
  const { pathname, search, hash } = window.location;
  const query = splitParams(search, ["code"]);
  if (!query.found.has("code")) return;
  try {
    window.history.replaceState(null, "", `${pathname}${query.rest ? `?${query.rest}` : ""}${hash}`);
  } catch {
    // harmless to leave
  }
}

// ---- Google sign-in -----------------------------------------------------------------------------------------------

/**
 * How a Google sign-in ended, as its return answers /garden?signin=... (lib/server/login-rules.ts SignInResult):
 * welcome (the account's garden opened here), plant (signed in: now a name and a seed), kept (this garden is now kept on
 * the account), taken (that account keeps another garden), elsewhere (this garden is kept on another account),
 * cancelled, failed, unavailable.
 */
export type SignInResult = "welcome" | "plant" | "kept" | "taken" | "elsewhere" | "cancelled" | "failed" | "unavailable";
const SIGN_IN_RESULTS: ReadonlySet<string> = new Set(["welcome", "plant", "kept", "taken", "elsewhere", "cancelled", "failed", "unavailable"]);
let signInResult: SignInResult | null | undefined;

/** How the sign-in this page came back from ended (once per page load), taken out of the address bar; null for none. */
export function takeSignInResult(): SignInResult | null {
  if (signInResult !== undefined) return signInResult;
  if (typeof window === "undefined") return null;
  const { pathname, search, hash } = window.location;
  const query = splitParams(search, ["signin"]);
  const raw = query.found.get("signin") ?? "";
  signInResult = SIGN_IN_RESULTS.has(raw) ? (raw as SignInResult) : null;
  if (query.found.has("signin")) {
    try {
      window.history.replaceState(null, "", `${pathname}${query.rest ? `?${query.rest}` : ""}${hash}`);
    } catch {
      // harmless to leave
    }
  }
  return signInResult;
}

/**
 * Starts a Google sign-in (GET /api/login/google): "garden" from a device that holds no garden (opens the account's
 * garden here, or plants one kept on it), "keep" to keep this device's garden on the account.
 */
export function signInWithGoogle(forWhat: "garden" | "keep"): void {
  // a whole-page visit (the route answers with Google's own page), never a router push
  window.location.assign(new URL(`/api/login/google?for=${forWhat}`, window.location.origin).href);
}

/**
 * A browser built into another app (Instagram's, Facebook's, LinkedIn's, Snapchat's, TikTok's, LINE's, WeChat's, or an
 * Android web view), where Google signs no one in: "android" or "ios", for which way out to offer; null for a browser.
 */
export function inAppBrowser(ua: string): "android" | "ios" | null {
  if (!/Instagram|FBAN|FBAV|FB_IAB|FBIOS|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|\bLine\/|MicroMessenger|; wv\)/i.test(ua)) return null;
  return /Android/i.test(ua) ? "android" : "ios";
}

/** Android's way out of an app's own browser: the same page in Chrome (an intent: address, read by Android alone). */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;end`;
}

// ---- the first name, checked as the server checks it ---------------------------------------------------------------

// Mirrors lib/server/validate.ts cleanFirstName (that module also loads node:crypto, so it cannot ship to the browser);
// session.test.ts checks both give the same answer.
export const FIRST_NAME_MAX = 24;
const NAME_CHARS = /^[\p{L}\p{M}\p{N} .'’()-]+$/u;
const HAS_LETTER = /\p{L}/u;

export type NameCheck = { ok: true; name: string } | { ok: false; code: string; message: string };

export function checkFirstName(raw: string): NameCheck {
  if (raw.trim() === "") {
    return { ok: false, code: "name_required", message: "Please type your first name, so friends can find your flower." };
  }
  const name = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (Array.from(name).length > FIRST_NAME_MAX) {
    return { ok: false, code: "name_too_long", message: `That name is a little long for a garden sign; ${FIRST_NAME_MAX} characters at most, please.` };
  }
  if (!NAME_CHARS.test(name) || !HAS_LETTER.test(name)) {
    return { ok: false, code: "name_characters", message: "Letters, spaces, hyphens and apostrophes work best on a garden sign." };
  }
  return { ok: true, name };
}

// ---- ids --------------------------------------------------------------------------------------------------------------

/** A UUID v4 as the seed route expects; built from getRandomValues where randomUUID is missing (plain http on a LAN). */
export function newClientEventId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// A planting whose answer was lost (a dropped connection, a reload mid-request) must be retried with the same id, or
// the server would plant a second seed. The request is kept in sessionStorage until it succeeds; a new request with
// the same name, species and choice of sign reuses its id while the server still recognises it (half an hour).
const PENDING_KEY = "garden-seed-request:v1";
const PENDING_MAX_MS = 25 * 60_000;

interface PendingSeed extends SeedRequest {
  id: string;
  at: number;
}

/** The clientEventId for this request: the kept one when the details match a recent attempt, else a fresh one. */
export function seedRequestId(req: SeedRequest, now = Date.now()): string {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (raw) {
      const p = JSON.parse(raw) as PendingSeed;
      if (p.firstName === req.firstName && p.species === req.species && p.showName === req.showName && now - p.at < PENDING_MAX_MS) {
        return p.id;
      }
    }
  } catch {
    // unreadable: start afresh
  }
  const id = newClientEventId();
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...req, id, at: now } satisfies PendingSeed));
  } catch {
    // storage blocked: retries within this page still reuse the id
  }
  return id;
}

/** The last seed request this tab started and has not seen succeed, to restore the form after a reload. */
export function pendingSeed(now = Date.now()): SeedRequest | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingSeed;
    return now - p.at < PENDING_MAX_MS ? { firstName: p.firstName, species: p.species, showName: p.showName } : null;
  } catch {
    return null;
  }
}

/** The id of this tab's pending seed request under exactly this name, or null (none, another name, or too old). */
export function pendingSeedId(firstName: string, now = Date.now()): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingSeed;
    return p.firstName === firstName && now - p.at < PENDING_MAX_MS && typeof p.id === "string" ? p.id : null;
  } catch {
    return null;
  }
}

function forgetPendingSeed(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // nothing kept
  }
}

/** Starts a fresh id for the next attempt (after the server said this one was used for a different seed). */
export function dropSeedRequestId(): void {
  forgetPendingSeed();
}

// ---- fetch ------------------------------------------------------------------------------------------------------------

function retryAfterOf(res: Response, body: Record<string, unknown>): number | null {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header >= 0) return header;
  return typeof body.retryAfterS === "number" ? body.retryAfterS : null;
}

async function api<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    throw new ApiProblem(0, "offline", OFFLINE_MESSAGE);
  }
  let body: Record<string, unknown> = {};
  try {
    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // not JSON (a proxy's error page): treated as a plain failure below
  }
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    const message = typeof body.message === "string" ? body.message : FALLBACK_MESSAGE;
    throw new ApiProblem(res.status, code, message, retryAfterOf(res, body), body);
  }
  return body as T;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

/** Like sleep, but over as soon as the browser says the connection is back (a lost answer need not wait out its backoff). */
function sleepUntilOnline(ms: number, signal?: AbortSignal): Promise<void> {
  if (typeof window === "undefined") return sleep(ms, signal);
  return new Promise<void>((resolve, reject) => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(t);
      window.removeEventListener("online", soon);
      signal?.removeEventListener("abort", stop);
    };
    const finish = () => {
      done();
      resolve();
    };
    // a moment after "online" for the network to settle (a captive portal, a radio waking up)
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(finish, 400);
    };
    const stop = () => {
      done();
      reject(new DOMException("Aborted", "AbortError"));
    };
    t = setTimeout(finish, ms);
    window.addEventListener("online", soon);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Whether a failed planting may be sent again by itself: the planting throttle (429 busy_planting), a busy or resting
 * database (503 busy, unavailable), or no answer at all (the response may have been lost after the seed went in; the
 * same clientEventId makes the retry safe). Every other refusal is the person's to read.
 */
export function isRetryablePlanting(p: ApiProblem): boolean {
  if (p.status === 0) return true;
  if (p.status === 429) return p.code === "busy_planting";
  if (p.status === 503) return p.code === "busy" || p.code === "unavailable";
  return false;
}

/**
 * How long to wait before retry number `attempt` (1, 2, ...): at least what the server asked (Retry-After), plus up to
 * half again and a second of jitter so a crowd told to wait does not return in step; a lost answer backs off 2, 4, 8 s.
 */
export function retryDelayMs(p: ApiProblem, attempt: number, rand: () => number = Math.random): number {
  const base = p.status === 0 ? Math.min(8, 2 ** attempt) : Math.max(1, p.retryAfterS ?? 5);
  return Math.round(base * 1000 * (1 + 0.5 * rand()) + 1000 * rand());
}

/** Lost answers are retried this many times; busy answers until this long has passed since the first try. */
const OFFLINE_RETRIES = 3;
const BUSY_DEADLINE_MS = 3 * 60_000;
export const BUSY_GIVE_UP_MESSAGE = "The garden is very busy just now. Your seed is safe in your hand; please try again in a minute.";

export interface PlantOptions {
  signal?: AbortSignal;
  /**
   * told before each automatic wait, so the planting moment can say why: problem.status 0 is a lost connection (tried
   * again when the browser is back online), anything else a busy garden
   */
  onWait?: (info: { attempt: number; waitMs: number; problem: ApiProblem }) => void;
}

/**
 * POST /api/seed. The party code rides along when there is one; the clientEventId is reused for any retry of the same
 * request (seedRequestId), so a lost answer or a second tap never plants twice. On success the kept request and the
 * party code are forgotten and the session cookie is set (httpOnly, by the server).
 */
export async function plantSeed(req: SeedRequest, partyCode: string | null, opts: PlantOptions = {}): Promise<SeedResult> {
  const clientEventId = seedRequestId(req);
  const body = { ...req, clientEventId, ...(partyCode ? { partyCode } : {}) };
  const started = Date.now();
  let offline = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await api<SeedResult>("/api/seed", { method: "POST", body, signal: opts.signal });
      forgetPendingSeed();
      forgetPartyCode();
      return result;
    } catch (err) {
      if (!(err instanceof ApiProblem)) throw err;
      if (!isRetryablePlanting(err)) throw err;
      if (err.status === 0 && ++offline > OFFLINE_RETRIES) throw err;
      const waitMs = retryDelayMs(err, err.status === 0 ? offline : attempt);
      if (err.status !== 0 && Date.now() + waitMs - started > BUSY_DEADLINE_MS) {
        throw new ApiProblem(err.status, err.code, BUSY_GIVE_UP_MESSAGE, err.retryAfterS, err.body);
      }
      opts.onWait?.({ attempt, waitMs, problem: err });
      await (err.status === 0 ? sleepUntilOnline(waitMs, opts.signal) : sleep(waitMs, opts.signal));
    }
  }
}

export interface NameFree {
  available: boolean;
  /** the server's words when the name is taken, else null */
  message: string | null;
}

/** How long the name step waits for an answer before going on without one (the planting checks again anyway). */
const NAME_CHECK_TIMEOUT_MS = 6000;

/**
 * POST /api/name: whether a name is still free in the Meadow (names are unique, ignoring case). A name the garden would
 * not put on a sign at all (a 400 about firstName, say an offensive word) comes back as not available, in the server's
 * words. Null when the garden could not say in time (offline, busy, an old party link): the name step then goes on,
 * and the planting checks again.
 */
export async function checkNameFree(firstName: string, partyCode: string | null): Promise<NameFree | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NAME_CHECK_TIMEOUT_MS);
  // this tab's own planting under that name, if its answer was lost: the server must not count it as someone else's
  const own = pendingSeedId(firstName);
  try {
    const r = await api<{ available?: unknown; message?: unknown }>("/api/name", {
      method: "POST",
      body: { firstName, ...(partyCode ? { partyCode } : {}), ...(own ? { clientEventId: own } : {}) },
      signal: ctrl.signal,
    });
    if (typeof r.available !== "boolean") return null;
    return { available: r.available, message: typeof r.message === "string" ? r.message : null };
  } catch (err) {
    if (err instanceof ApiProblem && err.status === 400 && err.body.field === "firstName") return { available: false, message: err.message };
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Busy answers on reads and link exchanges are retried a couple of times by themselves; the rest are shown. */
async function withBusyRetry<T>(run: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const busy = err instanceof ApiProblem && (err.status === 0 || (err.status === 503 && (err.code === "busy" || err.code === "unavailable")));
      if (!busy || attempt >= tries) throw err;
      await sleep(retryDelayMs(err, attempt));
    }
  }
}

/** GET /api/session: which gardens this device holds (the cookies are httpOnly, so only the server can say). */
export function getSession(): Promise<SessionStatus> {
  return withBusyRetry(() => api<SessionStatus>("/api/session"));
}

let sessionAhead: Promise<SessionStatus> | null = null;

/**
 * The GET /api/session this module started as the page loaded (when the address held no garden link), once; null
 * after that, so every later question gets a fresh answer.
 */
export function takeSessionAhead(): Promise<SessionStatus> | null {
  const p = sessionAhead;
  sessionAhead = null;
  return p;
}

interface LinkOpenBody {
  status: "signed_in" | "already_here" | "switched";
  person: PersonSummary;
  canSwitchBack?: boolean;
}

/**
 * POST /api/session with a garden link token: signs this device in, or answers switch_needed (409, ask the person
 * first, then call again with confirmSwitch) or invalid (404, the link was replaced or revoked; 400, cut short).
 */
export async function openGardenLink(token: string, confirmSwitch = false): Promise<LinkOpen> {
  try {
    const r = await withBusyRetry(() => api<LinkOpenBody>("/api/session", { method: "POST", body: { token, confirmSwitch } }));
    return { kind: "open", status: r.status, person: r.person, canSwitchBack: r.canSwitchBack === true };
  } catch (err) {
    if (err instanceof ApiProblem && err.status === 409 && err.code === "switch_needed") {
      const { current, target } = err.body as { current?: PersonSummary; target?: PersonSummary };
      if (current && target) return { kind: "switch_needed", current, target, message: err.message };
    }
    if (err instanceof ApiProblem && (err.code === "link_invalid" || err.code === "link_incomplete")) {
      return { kind: "invalid", message: err.message };
    }
    throw err;
  }
}

/** POST /api/session/back: returns this device to the garden it showed before a switch. */
export async function switchBack(): Promise<PersonSummary> {
  const r = await api<{ status: string; person: PersonSummary }>("/api/session/back", { method: "POST", body: {} });
  return r.person;
}

/** POST /api/link: a fresh personal garden link for this device's garden (the newest five keep working). */
export async function newGardenLink(): Promise<string> {
  const r = await api<{ link: string }>("/api/link", { method: "POST", body: {} });
  return r.link;
}

// ---- as the page loads ---------------------------------------------------------------------------------------------
//
// At the end of the module so everything above is defined; module evaluation is still before the page hydrates.

if (typeof window !== "undefined") {
  const link = takeGardenLink();
  // a link changes the answer (it is exchanged first), so the session is only asked ahead without one
  if (!link.token && !link.incomplete && window.location.pathname.startsWith("/garden")) {
    sessionAhead = getSession();
    // whoever takes it handles a failure; until then it must not count as unhandled
    sessionAhead.catch(() => {});
  }
}
