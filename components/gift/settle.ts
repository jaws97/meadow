// When a different garden comes in (a switch, a switch back), the care layer dims the whole page for a moment while
// the new plant is built (lib/client/plant.ts swapTo, a body-level night at z-index 12). A note like "Now showing
// Ravi's garden on this device" read under that night is never seen, so the door waits for this: the care layer has
// that person's plant, it is the one the garden shows, and the dim has lifted. A garden that cannot be fetched
// (offline, no plant) gives up waiting after a while.
//
// Read-only use of the plant and garden stores. lib/client/plant is loaded lazily, as the care layer itself is: loaded
// with the page, it would put a remembered plant into the garden even for a visitor the care layer never starts for.
import { garden } from "@/lib/garden/store";
import type { PersonSummary } from "@/lib/client/session";

type PlantStore = (typeof import("@/lib/client/plant"))["plantStore"];

function settledFor(plantStore: PlantStore, person: PersonSummary): boolean {
  const s = plantStore.get();
  // nothing is coming in: no plant to show, or no answer to show it from
  if (s.phase === "signed-out" || s.phase === "no-plant" || s.phase === "unreachable") return s.swap === "none";
  const me = s.me;
  if (!me || s.swap !== "none") return false;
  if (me.person.firstName !== person.firstName) return false;
  if (person.plot !== null && me.plant.plot !== person.plot) return false;
  const g = garden.get();
  return g.seed === me.plant.seed && g.speciesId === me.plant.species;
}

/**
 * Calls `then` once this person's garden is on screen with the swap dim gone, or after `maxMs` whatever happens.
 * Returns a cancel.
 */
export function afterGardenSettles(person: PersonSummary, then: () => void, maxMs = 9000): () => void {
  let over = false;
  const offs: Array<() => void> = [];
  const stop = () => {
    over = true;
    offs.forEach((off) => off());
  };
  const finish = () => {
    if (over) return;
    stop();
    then();
  };
  const cap = setTimeout(finish, maxMs);
  offs.push(() => clearTimeout(cap));
  import("@/lib/client/plant").then(
    ({ plantStore }) => {
      if (over) return;
      const check = () => {
        if (settledFor(plantStore, person)) finish();
      };
      offs.push(plantStore.subscribe(check), garden.subscribe(check));
      // the care layer mounts in the same commit and starts its fetch: look once it has had the chance to say "starting"
      const first = setTimeout(check, 60);
      offs.push(() => clearTimeout(first));
    },
    finish,
  );
  return stop;
}
