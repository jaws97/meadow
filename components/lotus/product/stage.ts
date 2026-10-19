// What the courtyard tells the rest of the garden, framework-free and tiny (the garden's camera rig and scene import it
// without taking the courtyard's code with them):
// - the camera's subject (courtSubject): the courtyard writes it every frame (the jar, the gliding seedling, the
//   plant's head) and the rig leans toward it (product/camera.ts);
// - the swap's wait: when a soil flower gives way to a lotus behind the soft dim, the scene asks for the courtyard to
//   be ready (courtyardPending, held by lib/garden/swapGate) and the courtyard, once its code has arrived and it has
//   compiled and pre-drawn itself out of sight, says so (courtyardReady). The wait lasts exactly as long as the dim
//   does: when the swap gives up on it (its code still not in), the courtyard is no longer expected, so one that mounts
//   after that shows itself at once rather than preparing hidden with nothing over it.
import * as THREE from "three";
import type { CourtSubject } from "@/components/lotus/product/camera";
import { onSwapOverdue } from "@/lib/garden/swapGate";

export const courtSubject: CourtSubject = { kind: "none", at: new THREE.Vector3(), lean: 0 };

let pending: { promise: Promise<void>; resolve: () => void } | null = null;

/** A courtyard is on its way in behind the dim: the promise settles once it is ready to be seen. */
export function courtyardPending(): Promise<void> {
  if (!pending) {
    let resolve = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    pending = { promise, resolve };
  }
  return pending.promise;
}

/** Whether a courtyard is expected behind the dim (so the one mounting now should prepare itself before it shows). */
export function courtyardExpected(): boolean {
  return pending !== null;
}

/** The courtyard is compiled and pre-drawn (or no longer wanted, or no longer waited for): the dim may lift. */
export function courtyardReady(): void {
  pending?.resolve();
  pending = null;
}

// the swap stopped waiting with the dim lifting: whatever courtyard comes now comes in the open
onSwapOverdue((gaveUp) => {
  if (gaveUp) courtyardReady();
});
