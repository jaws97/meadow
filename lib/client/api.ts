// The browser's side of the garden API (app/api/**): one fetch wrapper that turns every answer into a calm result the
// UI can show as it is, the idempotency ids care and planting send, and the retry rules the backend asks for.
//
// Every error body from the API is { error: code, message, ...extra } (lib/server/http.ts) and its message is written to
// be shown to people unchanged. A request that never reaches the server, or an answer that is not the API's JSON, gets a
// gentle fallback of the same shape, so a caller never has to choose between a code and a message: it shows `message`.
//
// Retries: only 429 busy_planting and 503 busy / unavailable are retried by themselves, after the server's Retry-After
// (or retryAfterS) plus jitter, so a crowd told to wait does not come back in step, and always with the SAME body: the
// same clientEventId makes a retry idempotent on the server. A request that never got an answer (offline, a dropped
// connection) is retried the same way, twice at most, which the same id makes just as safe. Every other answer,
// including the other 429s (too_soon, too_many_links, too_many_devices, too_many_changes), comes straight back for the
// UI to show kindly.

export interface ApiOk<T> {
  ok: true;
  status: number;
  data: T;
}

export interface ApiFail {
  ok: false;
  /** the HTTP status, or 0 when no answer arrived */
  status: number;
  /** the API's stable code (too_soon, no_session, ...), or offline / server_error for the fallbacks */
  code: string;
  /** calm, ready to show */
  message: string;
  /** when a declined action is welcome again (ISO), when the server said */
  retryAt: string | null;
  /** everything else the error body carried */
  extra: Record<string, unknown>;
}

export type ApiResult<T> = ApiOk<T> | ApiFail;

export interface RequestOptions {
  signal?: AbortSignal;
  /** retry busy answers and lost requests by themselves (see the header); on by default for POST */
  retry?: boolean;
  /** the longest the retries may wait in all, ms */
  maxWaitMs?: number;
}

export const OFFLINE_MESSAGE = "The garden could not be reached just now. Please check the connection and try again.";
export const SERVER_MESSAGE = "Something went wrong on our side. Your garden is safe; please try again.";

/** Answers worth waiting out: the planting throttle, and a database that is busy or resting for a moment. */
export function isRetryable(status: number, code: string): boolean {
  if (status === 429) return code === "busy_planting";
  if (status === 503) return code === "busy" || code === "unavailable";
  return false;
}

/**
 * How long to wait before retry number `attempt` (1, 2, ...): the server's Retry-After when it gave one (header or
 * retryAfterS), else a short backoff, plus up to 40% and a second and a half of jitter.
 */
export function retryDelayMs(retryAfter: number | null, attempt: number, random: () => number = Math.random): number {
  const base = retryAfter !== null && retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 1500 * 2 ** (attempt - 1));
  return Math.round(base * (1 + 0.4 * random()) + 1500 * random());
}

const MAX_ATTEMPTS = 4;
const LOST_RETRIES = 2;

/**
 * A fresh idempotency id: crypto.randomUUID() where the browser offers it (secure contexts only), else a version 4
 * UUID from crypto.getRandomValues, so a phone on the office network's plain-http preview gets one too.
 */
export function newEventId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function retryAfterOf(res: Response, body: Record<string, unknown>): number | null {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;
  return typeof body.retryAfterS === "number" && body.retryAfterS > 0 ? body.retryAfterS : null;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): ApiFail {
  const retryAt = typeof extra.retryAt === "string" ? extra.retryAt : null;
  return { ok: false, status, code, message, retryAt, extra };
}

type Attempt<T> = { result: ApiResult<T>; retryAfter: number | null; lost: boolean };

async function once<T>(method: "GET" | "POST", path: string, body: unknown, signal?: AbortSignal): Promise<Attempt<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal,
    });
  } catch {
    return { result: fail(0, signal?.aborted ? "aborted" : "offline", OFFLINE_MESSAGE), retryAfter: null, lost: true };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // not the API's JSON (a proxy page, a cut-off answer): handled below
  }
  if (res.ok) {
    return parsed === null
      ? { result: fail(res.status, "server_error", SERVER_MESSAGE), retryAfter: null, lost: false }
      : { result: { ok: true, status: res.status, data: parsed as T }, retryAfter: null, lost: false };
  }
  const b = isRecord(parsed) ? parsed : {};
  const code = typeof b.error === "string" ? b.error : res.status >= 500 ? "server_error" : "unexpected";
  const message = typeof b.message === "string" && b.message.trim() !== "" ? b.message : SERVER_MESSAGE;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) if (k !== "error" && k !== "message") extra[k] = v;
  return { result: fail(res.status, code, message, extra), retryAfter: retryAfterOf(res, b), lost: false };
}

async function request<T>(method: "GET" | "POST", path: string, body: unknown, opts: RequestOptions): Promise<ApiResult<T>> {
  const retry = opts.retry ?? method === "POST";
  const budget = opts.maxWaitMs ?? 30_000;
  let waited = 0;
  let lostRetries = 0;
  for (let attempt = 1; ; attempt++) {
    const { result, retryAfter, lost } = await once<T>(method, path, body, opts.signal);
    if (result.ok || !retry || opts.signal?.aborted || attempt >= MAX_ATTEMPTS) return result;
    const again = lost ? lostRetries++ < LOST_RETRIES : isRetryable(result.status, result.code);
    if (!again) return result;
    const delay = retryDelayMs(retryAfter, attempt);
    if (waited + delay > budget) return result;
    waited += delay;
    await wait(delay, opts.signal);
    if (opts.signal?.aborted) return result;
  }
}

/** GET a JSON endpoint. Not retried unless asked: the callers poll anyway. */
export function getJson<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  return request<T>("GET", path, undefined, { retry: false, ...opts });
}

/** POST a JSON body (always as application/json, {} when there is none), retried as the header describes. */
export function postJson<T>(path: string, body: unknown = {}, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  return request<T>("POST", path, body, opts);
}
