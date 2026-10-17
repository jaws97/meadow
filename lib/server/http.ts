// Small HTTP helpers shared by the route handlers: one error type with a status, a stable code and a calm message the
// UI can show as it is; JSON responses that are never cached unless a route says so; and a bounded JSON body reader.
//
// Error bodies look like { error: "too_soon", message: "...", ...extra }. A database that is busy (a lock or statement
// timeout from db.ts's transaction(), a serialisation failure, a dropped or refused connection) is answered with 503
// "busy" and Retry-After, so the UI can simply try again; other unexpected failures are logged by name, code and message
// only (postgres.js errors carry no credentials) and answered with a gentle 500, never a stack trace.
import type { Invalid } from "./validate";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  static invalid(v: Invalid): ApiError {
    return new ApiError(400, v.code, v.message, v.field ? { field: v.field } : {});
  }
}

/** Raised by lib/server/db.ts when no connection string is configured. */
export class DbUnavailableError extends Error {
  constructor() {
    super("database not configured");
    this.name = "DbUnavailableError";
  }
}

/** Personal responses: never stored by a browser or a CDN. */
export const NO_STORE = "private, no-store";

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: { "Cache-Control": NO_STORE, ...init.headers },
  });
}

/**
 * Postgres and driver error codes that mean "busy right now, try again": lock_not_available, query_canceled (statement
 * timeout), idle_in_transaction_session_timeout, serialization_failure, deadlock_detected, too_many_connections,
 * connection failures, and postgres.js's own connection errors.
 */
const BUSY_CODES = new Set([
  "55P03", "57014", "25P03", "40001", "40P01", "53300", "57P01", "08000", "08001", "08003", "08004", "08006",
  "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
]);
export const BUSY_RETRY_AFTER_S = 5;

export function isBusyError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && BUSY_CODES.has(code);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const retry = err.extra.retryAfterS;
    return json(
      { error: err.code, message: err.message, ...err.extra },
      { status: err.status, headers: typeof retry === "number" ? { "Retry-After": String(Math.ceil(retry)) } : {} },
    );
  }
  if (err instanceof DbUnavailableError) {
    return json({ error: "unavailable", message: "The garden is resting for a moment. Please try again shortly." }, { status: 503 });
  }
  const e = err as { name?: string; code?: string; message?: string };
  if (isBusyError(err)) {
    console.warn(`[meadow api] busy: ${e?.name ?? "Error"} ${e?.code}: ${e?.message ?? ""}`);
    return json(
      { error: "busy", message: "The garden is very busy for a moment. Please try again in a few seconds.", retryAfterS: BUSY_RETRY_AFTER_S },
      { status: 503, headers: { "Retry-After": String(BUSY_RETRY_AFTER_S) } },
    );
  }
  console.error(`[meadow api] ${e?.name ?? "Error"}${e?.code ? ` ${e.code}` : ""}: ${e?.message ?? String(err)}`);
  return json({ error: "server_error", message: "Something went wrong on our side. Your garden is safe; please try again." }, { status: 500 });
}

/**
 * Reads a small JSON body: requires a JSON content type (which also keeps cross-site form posts out, and makes a
 * cross-origin fetch need a CORS preflight this API never answers) and a size cap in bytes, checked against
 * Content-Length before reading when the client sends one.
 */
export async function readJsonBody(request: Request, maxBytes = 4096): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new ApiError(415, "json_required", "Please send JSON (Content-Type: application/json).");
  }
  const tooLarge = () => new ApiError(413, "too_large", "That request is larger than the garden expects.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw tooLarge();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "bad_json", "That request was not valid JSON.");
  }
}
