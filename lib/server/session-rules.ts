// The device-session rules, kept pure so they are tested without a database: the cookies a device holds and what
// opening a personal garden link does to them.
//
// A device holds at most two sessions, both httpOnly (no script can read them), secure in production and sameSite=lax:
// - meadow_session, the garden this device is showing;
// - meadow_prev, the garden it showed before an explicit switch, so "switch back" works without the old link.
//
// Opening a garden link never replaces a session silently. If this device already holds a different person's garden,
// the answer is "switch_needed" (with both names), and only a second request with confirmSwitch moves the current
// session to meadow_prev and signs the device in to the link's garden. So a link shared by mistake, a link a colleague
// taps "to see my flower", or a link planted by someone else (login CSRF) cannot quietly take over a device.

export const SESSION_COOKIE = "meadow_session";
export const PREV_SESSION_COOKIE = "meadow_prev";
/** Half a year, long past a flower's bloom; after it, the personal garden link opens the garden again. */
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 180;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long the server honours a session after it was created, whatever the browser sends: a little past the cookie's
 * 180 days (the cookie is set once, at sign-in, and never extended), so a copied cookie does not work for ever.
 */
export const SESSION_TTL_DAYS = 200;
/** How long a personal garden link opens its garden: a year, as it is how a person gets back in after losing devices. */
export const LINK_TTL_DAYS = 365;
/** New sessions one garden may start in an hour (each device that opens a link, each planting retry from a new one). */
export const SESSIONS_PER_HOUR = 20;
/** New garden links one person may make in an hour (planting, retries, POST /api/link, a reset). */
export const LINKS_PER_HOUR = 10;

/** Sessions created at or before this moment are no longer honoured. */
export function sessionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SESSION_TTL_DAYS * DAY_MS);
}

/** Garden links created at or before this moment no longer open anything. */
export function linkCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - LINK_TTL_DAYS * DAY_MS);
}

/** Whether a person who already made `made` rows of a kind in the last hour may make another. */
export function underHourlyLimit(made: number, limit: number): boolean {
  return made < limit;
}

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

function cookie(name: string, value: string, maxAge: number): CookieSpec {
  return { name, value, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge };
}

/** Set-Cookie options for the device's current session (pass to NextResponse.cookies.set). */
export function sessionCookie(token: string): CookieSpec {
  return cookie(SESSION_COOKIE, token, SESSION_MAX_AGE_S);
}

/** Set-Cookie options for the session kept for "switch back". */
export function prevSessionCookie(token: string): CookieSpec {
  return cookie(PREV_SESSION_COOKIE, token, SESSION_MAX_AGE_S);
}

/** Set-Cookie options that remove a cookie (same name, path and flags, empty value, already expired). */
export function clearedCookie(name: typeof SESSION_COOKIE | typeof PREV_SESSION_COOKIE): CookieSpec {
  return cookie(name, "", 0);
}

/**
 * What opening a garden link does on a device whose current session belongs to currentPersonId (null: none):
 * already_here (the same garden: nothing to do), switch_needed (another garden is here: ask first), switch (asked and
 * confirmed: keep the current session for "switch back" and sign in), sign_in (an empty device: sign in).
 */
export function decideLinkOpen(
  targetPersonId: string,
  currentPersonId: string | null,
  confirmSwitch: boolean,
): "already_here" | "switch_needed" | "switch" | "sign_in" {
  if (currentPersonId === null) return "sign_in";
  if (currentPersonId === targetPersonId) return "already_here";
  return confirmSwitch ? "switch" : "switch_needed";
}
