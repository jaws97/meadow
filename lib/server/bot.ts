// Vercel BotID on planting and name checks: an invisible check, set up by instrumentation-client.ts on every page, that
// a request comes from a real browser rather than a script. It is the one brake that also holds for a script with the
// party code, which the per-network limits (network.ts) leave alone because the whole office shares one address.
//
// It never stands between a real person and their seed by mistake of its own: when the check cannot answer (Vercel's
// service down, or OIDC off for the project) the request goes on and the failure is logged, and MEADOW_BOT_CHECK=off
// (env.ts botCheckOn) turns it off altogether. On a development server BotID answers "human" by itself. Only the
// device's own BotID cookies (KP_*) and its request headers go to Vercel's check, never Meadow's cookies (botid/server
// drops the rest).
import "server-only";
import { checkBotId } from "botid/server";
import { botCheckOn } from "./env";
import { ApiError } from "./http";

/** Refuses a request BotID says came from a bot (403 not_verified); anything else goes on. */
export async function requireHuman(what: string): Promise<void> {
  if (!botCheckOn()) return;
  let isBot: boolean;
  try {
    ({ isBot } = await checkBotId());
  } catch (err) {
    console.error(`[meadow api] the bot check did not answer, so this ${what} goes on: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!isBot) return;
  console.warn(`[meadow api] a ${what} was turned away by the bot check`);
  throw new ApiError(403, "not_verified", "The garden could not check this browser just now. Please reload the page and try again.");
}
