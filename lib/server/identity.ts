// Who is asking: device sessions and personal garden links, server-only. There are no accounts or passwords; planting
// a seed creates a person, and the browser that planted it gets a session cookie. To open the same garden on a laptop or
// an iPad, the person uses their personal garden link (private: it opens the garden for whoever holds it).
//
// Both are bearer tokens from tokens.ts (32 random bytes, base64url) stored only as SHA-256 hashes. The cookies are
// described in session-rules.ts: httpOnly, secure in production, sameSite=lax, and a device never changes garden
// without an explicit switch.
//
// A garden link is /garden#k=<token>. The token sits in the URL fragment, which browsers never send to a server, so it
// stays out of request logs and link-preview bots (Teams, Slack, Outlook Safe Links) cannot use it; the garden page
// exchanges it with POST /api/session, and GET requests have no side effects. Only the newest few links and sessions
// per person stay active, and a person can revoke every other link and device at once (POST /api/session/reset).
//
// Lifetimes and limits (session-rules.ts): a session is honoured for SESSION_TTL_DAYS after it was created and a link
// opens its garden for LINK_TTL_DAYS, whatever the browser sends; a person may start SESSIONS_PER_HOUR sessions and make
// LINKS_PER_HOUR links an hour, so no client can grow the tables without bound. scripts/prune-identity.mjs removes
// revoked and expired rows once they are a month old.
import "server-only";
import type { NextRequest } from "next/server";
import { db, transaction, type Queryable } from "./db";
import { ApiError } from "./http";
import {
  LINKS_PER_HOUR,
  SESSIONS_PER_HOUR,
  SESSION_COOKIE,
  decideLinkOpen,
  linkCutoff,
  sessionCutoff,
  underHourlyLimit,
} from "./session-rules";
import { hashToken, isTokenShape, newToken } from "./tokens";

// last_seen_at is a convenience for support and the session cap, refreshed at most hourly so reads stay reads
const TOUCH_AFTER_MS = 60 * 60 * 1000;
/** Devices signed in to one garden at once; signing in another retires the least recently seen beyond this. */
export const MAX_ACTIVE_SESSIONS = 12;
/** Garden links that work at once; making another retires the oldest beyond this. */
export const MAX_ACTIVE_LINKS = 5;

/** The first name and plot a person sees for themselves (session status, switch prompts). */
export interface PersonSummary {
  firstName: string;
  plot: number | null;
}

async function summary(q: Queryable, personId: string): Promise<PersonSummary | null> {
  const rows = await q<{ first_name: string; plot_index: number | null }[]>`
    select pe.first_name, p.plot_index
    from meadow.people pe
    left join meadow.gardens g on g.person_id = pe.id
    left join meadow.plants p on p.garden_id = g.id and p.garden_slot = 0
    where pe.id = ${personId}`;
  return rows[0] ? { firstName: rows[0].first_name, plot: rows[0].plot_index } : null;
}

async function madeInLastHour(q: Queryable, table: "sessions" | "garden_links", personId: string): Promise<number> {
  const rows = table === "sessions"
    ? await q<{ n: number }[]>`
        select count(*)::int as n from meadow.sessions where person_id = ${personId} and created_at > now() - interval '1 hour'`
    : await q<{ n: number }[]>`
        select count(*)::int as n from meadow.garden_links where person_id = ${personId} and created_at > now() - interval '1 hour'`;
  return rows[0]?.n ?? 0;
}

/**
 * Creates a session for a person (inside the caller's transaction when given one) and returns the raw token. Refuses
 * with 429 beyond SESSIONS_PER_HOUR new sessions for the garden in an hour.
 */
export async function createSession(q: Queryable, personId: string): Promise<string> {
  if (!underHourlyLimit(await madeInLastHour(q, "sessions", personId), SESSIONS_PER_HOUR)) {
    throw new ApiError(429, "too_many_devices",
      "This garden has been opened on a lot of devices in the last hour. Please try again a little later.", { retryAfterS: 900 });
  }
  const token = newToken(), hash = hashToken(token);
  await q`insert into meadow.sessions (token_hash, person_id) values (${hash}, ${personId})`;
  await q`
    update meadow.sessions set revoked_at = now()
    where person_id = ${personId} and revoked_at is null and token_hash <> ${hash}
      and token_hash not in (
        select token_hash from meadow.sessions
        where person_id = ${personId} and revoked_at is null and token_hash <> ${hash}
        order by last_seen_at desc
        limit ${MAX_ACTIVE_SESSIONS - 1})`;
  return token;
}

/** The person behind a session token, or null (missing, malformed, unknown, revoked or past SESSION_TTL_DAYS). */
export async function sessionPerson(token: string | undefined): Promise<string | null> {
  if (!isTokenShape(token)) return null;
  const hash = hashToken(token);
  const rows = await db()<{ person_id: string; last_seen_at: Date }[]>`
    select person_id, last_seen_at from meadow.sessions
    where token_hash = ${hash} and revoked_at is null and created_at > ${sessionCutoff()}`;
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    await db()`update meadow.sessions set last_seen_at = now() where token_hash = ${hash}`;
  }
  return row.person_id;
}

/** The person behind the request's session cookie, or null. */
export function personIdFromRequest(request: NextRequest): Promise<string | null> {
  return sessionPerson(request.cookies.get(SESSION_COOKIE)?.value);
}

/** Like personIdFromRequest, but answers 401 with a calm hint when there is no session. */
export async function requirePersonId(request: NextRequest): Promise<string> {
  const id = await personIdFromRequest(request);
  if (!id) {
    throw new ApiError(401, "no_session", "This device has no garden yet. Plant a seed, or open your personal garden link here.");
  }
  return id;
}

/**
 * Creates a personal garden link token (shown once, never stored) and retires the oldest beyond MAX_ACTIVE_LINKS.
 * Refuses with 429 beyond LINKS_PER_HOUR new links for the person in an hour.
 */
export async function createGardenLink(q: Queryable, personId: string): Promise<string> {
  if (!underHourlyLimit(await madeInLastHour(q, "garden_links", personId), LINKS_PER_HOUR)) {
    throw new ApiError(429, "too_many_links",
      "You have made several garden links in the last hour. The newest ones still work; please make another a little later.",
      { retryAfterS: 900 });
  }
  await q`
    update meadow.garden_links set revoked_at = now()
    where person_id = ${personId} and revoked_at is null
      and token_hash not in (
        select token_hash from meadow.garden_links
        where person_id = ${personId} and revoked_at is null
        order by created_at desc, token_hash
        limit ${MAX_ACTIVE_LINKS - 1})`;
  const token = newToken();
  await q`insert into meadow.garden_links (token_hash, person_id) values (${hashToken(token)}, ${personId})`;
  return token;
}

/** The private URL a person saves to open their garden on another device: the token rides in the fragment. */
export function gardenLinkUrl(origin: string, token: string): string {
  return `${origin}/garden#k=${token}`;
}

export type LinkOpenResult =
  | { kind: "invalid" }
  | { kind: "already_here"; person: PersonSummary }
  | { kind: "switch_needed"; current: PersonSummary; target: PersonSummary }
  | { kind: "signed_in"; person: PersonSummary; sessionToken: string; previousToken: string | null; switched: boolean };

/**
 * Opens a personal garden link on this device (see session-rules.ts decideLinkOpen). currentToken and prevToken are the
 * device's meadow_session and meadow_prev cookies. On a confirmed switch the current token becomes the new "switch back"
 * token and the one it replaces is revoked.
 */
export async function openGardenLink(
  linkToken: string,
  currentToken: string | undefined,
  prevToken: string | undefined,
  confirmSwitch: boolean,
): Promise<LinkOpenResult> {
  if (!isTokenShape(linkToken)) return { kind: "invalid" };
  const linkHash = hashToken(linkToken);
  return transaction(async (tx): Promise<LinkOpenResult> => {
    const [link] = await tx<{ person_id: string }[]>`
      select person_id from meadow.garden_links
      where token_hash = ${linkHash} and revoked_at is null and created_at > ${linkCutoff()}`;
    if (!link) return { kind: "invalid" };
    const target = await summary(tx, link.person_id);
    if (!target) return { kind: "invalid" };
    const current = isTokenShape(currentToken)
      ? (await tx<{ person_id: string }[]>`
          select person_id from meadow.sessions
          where token_hash = ${hashToken(currentToken)} and revoked_at is null and created_at > ${sessionCutoff()}`)[0] ?? null
      : null;
    const decision = decideLinkOpen(link.person_id, current?.person_id ?? null, confirmSwitch);
    if (decision === "already_here") return { kind: "already_here", person: target };
    if (decision === "switch_needed" && current) {
      const here = await summary(tx, current.person_id);
      if (here) return { kind: "switch_needed", current: here, target };
    }
    await tx`update meadow.garden_links set last_used_at = now(), use_count = use_count + 1 where token_hash = ${linkHash}`;
    const switched = decision === "switch" && isTokenShape(currentToken);
    if (switched && isTokenShape(prevToken) && prevToken !== currentToken) {
      await tx`update meadow.sessions set revoked_at = now() where token_hash = ${hashToken(prevToken)} and revoked_at is null`;
    }
    const sessionToken = await createSession(tx, link.person_id);
    return { kind: "signed_in", person: target, sessionToken, previousToken: switched ? (currentToken as string) : null, switched };
  });
}

/**
 * Returns this device to the garden it showed before a switch: the kept session becomes current again and the current
 * one is revoked (on a shared tablet, the second person's garden does not linger). Null when there is nothing to return to.
 */
export async function switchBack(
  currentToken: string | undefined,
  prevToken: string | undefined,
): Promise<{ sessionToken: string; person: PersonSummary } | null> {
  if (!isTokenShape(prevToken)) return null;
  return transaction(async (tx) => {
    const [prev] = await tx<{ person_id: string }[]>`
      update meadow.sessions set last_seen_at = now()
      where token_hash = ${hashToken(prevToken)} and revoked_at is null and created_at > ${sessionCutoff()} returning person_id`;
    if (!prev) return null;
    const person = await summary(tx, prev.person_id);
    if (!person) return null;
    if (isTokenShape(currentToken) && currentToken !== prevToken) {
      await tx`update meadow.sessions set revoked_at = now() where token_hash = ${hashToken(currentToken)} and revoked_at is null`;
    }
    return { sessionToken: prevToken, person };
  });
}

/** Signs this device out: revokes its current and kept sessions. Returns how many were still active. */
export async function endSessions(tokens: readonly (string | undefined)[]): Promise<number> {
  let ended = 0;
  for (const token of tokens) {
    if (!isTokenShape(token)) continue;
    const rows = await db()`
      update meadow.sessions set revoked_at = now() where token_hash = ${hashToken(token)} and revoked_at is null returning 1`;
    ended += rows.length;
  }
  return ended;
}

/**
 * "Someone else has my link": revokes every garden link of the person and every session except this device's, and
 * returns a fresh link. Returns null when the device's session is not active.
 */
export async function resetAccess(currentToken: string | undefined): Promise<{ linkToken: string; signedOut: number; linksRevoked: number } | null> {
  if (!isTokenShape(currentToken)) return null;
  const keep = hashToken(currentToken);
  return transaction(async (tx) => {
    const [me] = await tx<{ person_id: string }[]>`
      select person_id from meadow.sessions where token_hash = ${keep} and revoked_at is null and created_at > ${sessionCutoff()}`;
    if (!me) return null;
    const sessions = await tx`
      update meadow.sessions set revoked_at = now()
      where person_id = ${me.person_id} and revoked_at is null and token_hash <> ${keep} returning 1`;
    const links = await tx`
      update meadow.garden_links set revoked_at = now() where person_id = ${me.person_id} and revoked_at is null returning 1`;
    const linkToken = await createGardenLink(tx, me.person_id);
    return { linkToken, signedOut: sessions.length, linksRevoked: links.length };
  });
}

/** Which gardens this device holds: the current one, and the one "switch back" would return to (when different). */
export async function sessionStatus(
  currentToken: string | undefined,
  prevToken: string | undefined,
): Promise<{ person: PersonSummary | null; previous: PersonSummary | null; personId: string | null }> {
  const [currentId, prevId] = await Promise.all([sessionPerson(currentToken), sessionPerson(prevToken)]);
  const person = currentId ? await summary(db(), currentId) : null;
  const previous = prevId && prevId !== currentId ? await summary(db(), prevId) : null;
  return { person, previous, personId: person ? currentId : null };
}
