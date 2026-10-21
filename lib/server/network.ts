// Per-network limits on what a script could do in bulk without the party link: plant seeds (each one takes a name off
// everyone else, names being unique in the Meadow) and check names. The Meadow-wide limits on strangers' seeds
// (rules.ts openPlantingWait) keep the Meadow and the party screen from being crowded, but one script could use them
// all up and leave real visitors waiting; these keep any one network to what a household or an office team would plant.
//
// A seed or name check with the party code is never limited by network: the whole office shares one address at the
// party. (A script with the party code is BotID's to catch, lib/server/bot.ts; and the code is changed on the party's
// morning.)
//
// Nothing about the address is kept that could be read back or followed: the network (an IPv4 address, or an IPv6
// address's /64, which one home or phone holds whole) is scrambled with HMAC-SHA-256 under a key derived from
// MEADOW_LOGIN_KEY and the IST day, so a mark says only "the same network as another mark of the same day", and marks of
// different days cannot be matched. scripts/prune-identity.mjs removes them after two days. Pure apart from reading
// the key from the environment (env.ts networkKey), so the tests run without a database.
import { createHmac } from "node:crypto";
import { networkKey } from "./env";

/** Seeds without the party code one network may plant in an hour, and in an IST day. */
export const SEEDS_PER_NETWORK_HOUR = 5;
export const SEEDS_PER_NETWORK_DAY = 15;
/** Names one network may check without the party code in an hour (the name step asks once per name tried). */
export const NAME_CHECKS_PER_NETWORK_HOUR = 60;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;
/** The longest address text kept as it is when it cannot be read as an address. */
const RAW_MAX = 64;

/** The eight groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(a: string): string[] | null {
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  return groups.length === 8 && groups.every((g) => HEXTET.test(g)) ? groups : null;
}

/**
 * The network an address belongs to, as the limits count it: an IPv4 address itself (an IPv4-mapped IPv6 address read
 * as one), an IPv6 address's /64, or the text itself (trimmed and shortened) when it is neither.
 */
export function networkOf(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith("[") && a.includes("]")) a = a.slice(1, a.indexOf("]"));
  a = a.split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) a = mapped[1];
  const v4 = IPV4.exec(a);
  if (v4 && v4.slice(1).every((o) => Number(o) <= 255)) return v4.slice(1).map(Number).join(".");
  const v6 = a.includes(":") ? ipv6Groups(a) : null;
  if (v6) return `${v6.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
  return a.slice(0, RAW_MAX);
}

/**
 * The address a request came from, as Vercel's edge reports it (x-real-ip, else the first x-forwarded-for entry; the
 * edge sets both and overwrites whatever a client sent), or null off Vercel when neither is there.
 */
export function clientAddress(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

/** The mark for a network on an IST day (YYYY-MM-DD) under a key: 32 bytes that cannot be read back. */
export function networkMark(network: string, istDay: string, key: string): Buffer {
  const dayKey = createHmac("sha256", key).update("meadow network marks", "utf8").digest();
  return createHmac("sha256", dayKey).update(`${istDay}|${network}`, "utf8").digest();
}

/** The request's network mark for today, or null when there is no key (production without MEADOW_LOGIN_KEY). */
export function requestMark(headers: Headers, istDay: string): Buffer | null {
  const key = networkKey();
  if (key === null) return null;
  return networkMark(networkOf(clientAddress(headers) ?? "local"), istDay, key);
}

/** Whether one more seed without the party code may come from a network that planted `recent` (this hour, today). */
export function networkSeedWait(recent: { hour: number; day: number }): "go" | "hour" | "day" {
  if (recent.day >= SEEDS_PER_NETWORK_DAY) return "day";
  if (recent.hour >= SEEDS_PER_NETWORK_HOUR) return "hour";
  return "go";
}

/** Whether one more name check without the party code may come from a network that checked `inHour` this hour. */
export function networkNameWait(inHour: number): "go" | "hour" {
  return inHour >= NAME_CHECKS_PER_NETWORK_HOUR ? "hour" : "go";
}
