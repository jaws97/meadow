// The HTTP helpers: a busy database (lock or statement timeout, dropped connection) becomes a calm 503 with
// Retry-After instead of a 500, ApiErrors keep their status and extras, and the body reader enforces JSON and a byte cap.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, BUSY_RETRY_AFTER_S, errorResponse, isBusyError, readJsonBody } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

const pgError = (code: string) => Object.assign(new Error("canceling statement due to lock timeout"), { name: "PostgresError", code });

describe("errorResponse", () => {
  it("answers lock and statement timeouts, deadlocks and lost connections with 503 busy and Retry-After", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const code of ["55P03", "57014", "25P03", "40001", "40P01", "53300", "CONNECT_TIMEOUT", "ECONNRESET"]) {
      expect(isBusyError(pgError(code))).toBe(true);
      const res = errorResponse(pgError(code));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe(String(BUSY_RETRY_AFTER_S));
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.json()).toMatchObject({ error: "busy" });
    }
  });

  it("keeps other failures a gentle 500 that reveals nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(pgError("42P01"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("server_error");
    expect(JSON.stringify(body)).not.toContain("lock timeout");
    expect(log).toHaveBeenCalledOnce();
  });

  it("passes an ApiError through with its extras, and Retry-After when it carries retryAfterS", async () => {
    const res = errorResponse(new ApiError(429, "busy_planting", "Please try again.", { retryAfterS: 10 }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("10");
    expect(await res.json()).toEqual({ error: "busy_planting", message: "Please try again.", retryAfterS: 10 });
    expect(errorResponse(new ApiError(409, "already_planted", "x", { plot: 3 })).headers.get("retry-after")).toBeNull();
  });
});

describe("readJsonBody", () => {
  const post = (body: string, headers: Record<string, string>) => new Request("http://x/api", { method: "POST", body, headers });

  it("requires a JSON content type", async () => {
    await expect(readJsonBody(post("kind=water", { "content-type": "application/x-www-form-urlencoded" }))).rejects.toMatchObject({ status: 415 });
    await expect(readJsonBody(post("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
  });

  it("refuses a body over the cap, by declared length before reading and by bytes after", async () => {
    await expect(readJsonBody(post("{}", { "content-type": "application/json", "content-length": "999999" }), 100)).rejects.toMatchObject({ status: 413 });
    // 40 three-byte characters: 40 UTF-16 units but 120 bytes
    const wide = JSON.stringify({ n: "ம".repeat(40) });
    await expect(readJsonBody(post(wide, { "content-type": "application/json" }), 100)).rejects.toMatchObject({ status: 413 });
  });

  it("parses valid JSON and names malformed JSON", async () => {
    expect(await readJsonBody(post('{"a":1}', { "content-type": "application/json; charset=utf-8" }))).toEqual({ a: 1 });
    await expect(readJsonBody(post("{nope", { "content-type": "application/json" }))).rejects.toMatchObject({ status: 400, code: "bad_json" });
  });
});
