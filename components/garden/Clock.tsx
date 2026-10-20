"use client";
// Advances the shared environment once per frame, before anything else reads it.
// With autoClock on, the hour tracks real Bangalore time and is written back to
// the store only when it has drifted by more than fifteen seconds, so the UI
// stays in step without re-rendering every frame. While the bloom card is being
// photographed (lib/garden/cardShot) the garden is lit for the card instead
// (golden hour, fair weather) without the store's hour or weather changing.
import { useFrame } from "@react-three/fiber";
import { cardShot } from "@/lib/garden/cardShot";
import { updateEnv } from "@/lib/garden/env";
import { garden } from "@/lib/garden/store";
import { istNow } from "@/lib/sky/sun";

export function Clock() {
  useFrame((state, delta) => {
    const s = garden.get();
    let hour = s.hour;
    if (s.autoClock) {
      hour = istNow();
      if (Math.abs(hour - s.hour) > 1 / 240) garden.set({ hour });
    }
    const card = cardShot.active ? cardShot.light : null;
    if (card) updateEnv(card.hour, card.cloud, card.rain, card.wind, state.clock.elapsedTime, Math.min(delta, 0.1));
    else updateEnv(hour, s.cloud, s.rain, s.wind, state.clock.elapsedTime, Math.min(delta, 0.1));
  }, -10);
  return null;
}
