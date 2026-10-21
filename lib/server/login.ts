// Google sign-in in the database (login-rules.ts holds the rules, google.ts the talk with Google): the garden each
// account keeps (meadow.logins, by the account's scrambled number only), the accounts signed in on a device that holds
// no garden yet (meadow.login_starts, for the seed planted next there), and the end of a sign-in, which opens the
// account's garden on the device, keeps the device's garden on the account, or holds the account for a planting.
// Server-only; the routes under app/api/login/google, GET /api/session and plantSeed (garden.ts) call these.
import "server-only";
import { PUBLIC_ORIGIN } from "@/lib/origin";
import { db, transaction, type Queryable } from "./db";
import { googleSignIn, isProduction } from "./env";
import { createSession, sessionPerson } from "./identity";
import { LOGIN_START_MAX_AGE_S, decideSignIn, resultOf, type LoginIntent, type SignInResult } from "./login-rules";
import { hashToken, isTokenShape, newToken } from "./tokens";

/** Where Google sends a sign-in back: the live address in production (the one registered with Google), else this server. */
export function signInCallback(requestOrigin: string): string {
  return `${isProduction() ? PUBLIC_ORIGIN : requestOrigin}/api/login/google/callback`;
}

/**
 * The person whose garden an account keeps, or null. A garden let go of ("Sign out other devices" from a device that
 * held it before the account did, identity.ts resetAccess) is kept on it no longer.
 */
export async function accountPerson(q: Queryable, subject: Buffer): Promise<string | null> {
  const [row] = await q<{ person_id: string }[]>`
    select person_id from meadow.logins where subject_hash = ${subject} and forgotten_at is null`;
  return row?.person_id ?? null;
}

/** Whether a person's garden is kept on a Google account. */
async function personKept(q: Queryable, personId: string): Promise<boolean> {
  const [row] = await q<{ n: number }[]>`
    select count(*)::int as n from meadow.logins where person_id = ${personId} and forgotten_at is null`;
  return (row?.n ?? 0) > 0;
}

/** The account a device's login cookie holds for the seed planted next (unused, and from the last hour), or null. */
export async function loginStartSubject(q: Queryable, token: string | undefined): Promise<Buffer | null> {
  if (!isTokenShape(token)) return null;
  const since = new Date(Date.now() - LOGIN_START_MAX_AGE_S * 1000);
  const [row] = await q<{ subject_hash: Buffer }[]>`
    select subject_hash from meadow.login_starts
    where token_hash = ${hashToken(token)} and used_at is null and created_at > ${since}`;
  return row?.subject_hash ?? null;
}

/** Keeps a new garden on the account the device signed in with (inside the planting's own transaction). */
export async function keepPlanting(q: Queryable, token: string, subject: Buffer, personId: string): Promise<void> {
  await q`insert into meadow.logins (subject_hash, person_id) values (${subject}, ${personId})`;
  await q`update meadow.login_starts set used_at = now() where token_hash = ${hashToken(token)}`;
}

export interface LoginStatus {
  /** Google sign-in is on here (env.ts googleSignIn), offered and never required */
  available: boolean;
  /** the device's garden is kept on an account */
  kept: boolean;
  /** an account is signed in on this device, which holds no garden yet: the seed planted next is kept on it */
  pending: boolean;
}

/** GET /api/session's word on sign-in, for the device's garden (`personId`) or its login cookie when it has none. */
export async function loginStatus(personId: string | null, loginToken: string | undefined): Promise<LoginStatus> {
  if (!googleSignIn()) return { available: false, kept: false, pending: false };
  const kept = personId ? await personKept(db(), personId) : false;
  const pending = personId ? false : (await loginStartSubject(db(), loginToken)) !== null;
  return { available: true, kept, pending };
}

export interface SignInDone {
  result: SignInResult;
  /** a garden opened here: the device's new session, and the one kept for "switch back" when it showed another */
  sessionToken: string | null;
  previousToken: string | null;
  /** no garden on the account: the token that holds it for the seed planted next on this device */
  loginToken: string | null;
}

/**
 * Ends a sign-in whose account is now known (by its scrambled number): opens the account's garden on this device (the
 * device's own other garden, if any, is kept for "switch back", as a confirmed link switch keeps it, identity.ts),
 * keeps the device's garden on the account, or holds the account for the seed planted next here.
 */
export async function finishSignIn(
  intent: LoginIntent,
  subject: Buffer,
  currentToken: string | undefined,
  prevToken: string | undefined,
): Promise<SignInDone> {
  const devicePerson = await sessionPerson(currentToken);
  return transaction(async (tx): Promise<SignInDone> => {
    const account = await accountPerson(tx, subject);
    const deviceKept = devicePerson ? await personKept(tx, devicePerson) : false;
    const outcome = decideSignIn(intent, account, devicePerson, deviceKept);
    const done: SignInDone = { result: resultOf(outcome), sessionToken: null, previousToken: null, loginToken: null };
    if (outcome.kind === "open") {
      // the device's hold on the garden began when the garden was kept on this account (session-rules.ts)
      const sessionToken = await createSession(tx, outcome.personId, { account: subject });
      await tx`update meadow.logins set last_used_at = now() where subject_hash = ${subject} and forgotten_at is null`;
      const switched = outcome.switchFrom !== null && isTokenShape(currentToken);
      if (switched && isTokenShape(prevToken) && prevToken !== currentToken) {
        await tx`update meadow.sessions set revoked_at = now() where token_hash = ${hashToken(prevToken)} and revoked_at is null`;
      }
      return { ...done, sessionToken, previousToken: switched ? (currentToken as string) : null };
    }
    if (outcome.kind === "plant") {
      const token = newToken();
      await tx`insert into meadow.login_starts (token_hash, subject_hash) values (${hashToken(token)}, ${subject})`;
      return { ...done, loginToken: token };
    }
    if (outcome.kind === "keep") {
      await tx`insert into meadow.logins (subject_hash, person_id) values (${subject}, ${outcome.personId})`;
    }
    return done;
  });
}
