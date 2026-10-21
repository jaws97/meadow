// Runs on every page before it becomes interactive (Next.js's instrumentation-client): sets up Vercel BotID's invisible
// check for planting and name checks (lib/server/bot.ts), whose requests then carry its proof that a real browser sent
// them.
//
// A personal garden link's key rides in the address's fragment (/garden#k=...) until the garden page takes it out of
// the address bar as its script loads (lib/client/session.ts). BotID starts only once it is gone, so no part of the check
// ever sees the key. A page whose key is never taken (none should be) starts no check, and a planting from it would be
// answered with the calm "please reload the page" (lib/server/bot.ts).
import { initBotId } from "botid/client/core";

const PROTECT = [
  { path: "/api/seed", method: "POST" },
  { path: "/api/name", method: "POST" },
];
/** How often to look again for the key to be gone, and for how long at most. */
const WAIT_STEP_MS = 100;
const WAIT_MAX_MS = 15_000;

const holdsKey = () => /[#&]k=/.test(window.location.hash);

function start() {
  try {
    initBotId({ protect: PROTECT });
  } catch {
    // the check is a brake on scripts: a page where it cannot start still shows the garden
  }
}

if (!holdsKey()) start();
else {
  const since = Date.now();
  const look = () => {
    if (!holdsKey()) start();
    else if (Date.now() - since < WAIT_MAX_MS) setTimeout(look, WAIT_STEP_MS);
  };
  setTimeout(look, WAIT_STEP_MS);
}
