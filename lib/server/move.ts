// Carrying a garden from the old address to the new one (lib/origin). A device keeps its garden through a session
// cookie on the address it planted at, and a cookie never crosses to another address, so a device that planted on the
// old one (meadow-phi.vercel.app, until 21 Oct) would find no garden at the new one. Its garden pages send such a
// device to GET /api/move on the old address, where the cookie is (next.config.ts): the session is exchanged for a
// fresh personal garden link, and the device goes to the new address's garden with the link in the fragment, where the
// door opens it like any personal link (a fragment never reaches a server or a log). The route then clears the old
// address's cookies, so a later visit there forwards plainly and never makes another link. A device whose session has
// ended, one past the hourly link limit, or a request on any other host goes on to the same page at the new address.
//
// A page on another site that sends someone here can only move that person's own garden to the new address, once (the
// cookie is gone after it), and learns nothing: the link travels in the redirect to the person's own browser.
import { MOVE_PAGES, OLD_HOST, PUBLIC_ORIGIN } from "@/lib/origin";

export interface MoveDeps {
  /** the person whose session this request carries, or null */
  personId: () => Promise<string | null>;
  /** a fresh personal garden link token for that person (lib/server/garden newGardenLink) */
  newLink: (personId: string) => Promise<string>;
}

export interface Move {
  /** where the device goes next */
  location: string;
  /** the garden was carried across: the old address's cookies are to be cleared */
  carried: boolean;
}

/** Where a request to GET /api/move goes, given the host it came to and its query (to: the page asked for). */
export async function moveTarget(host: string | null, query: URLSearchParams, deps: MoveDeps): Promise<Move> {
  const asked = query.get("to") ?? "/garden";
  const rest = new URLSearchParams(query);
  rest.delete("to");
  const page = MOVE_PAGES.includes(asked) ? asked : "/garden";
  const plain: Move = { location: `${PUBLIC_ORIGIN}${page}${rest.size > 0 ? `?${rest}` : ""}`, carried: false };
  if (host !== OLD_HOST) return plain;
  try {
    const personId = await deps.personId();
    if (!personId) return plain;
    const token = await deps.newLink(personId);
    return { location: `${PUBLIC_ORIGIN}/garden#k=${token}`, carried: true };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.warn(`[meadow api] a garden stayed at the old address for now: ${e?.code ?? ""} ${e?.message ?? String(err)}`);
    return plain;
  }
}
