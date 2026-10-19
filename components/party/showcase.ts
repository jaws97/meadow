"use client";
// The party screen's showcase, staged in the garden's store: Lijas's seed, the rose, full grown and in bloom, the clock
// held at golden hour (or the rehearsal's ?hour=), clear and dry. PartyScreen stages it before the canvas's chunk
// arrives, so the opening compiles exactly what is shown, and the trailer stages it again, under black, when it ends.
import { OWNER, showcaseHour } from "@/components/party/logic";
import { garden } from "@/lib/garden/store";

export function stageShowcase(search: string) {
  // the store's defaults are the owner's rose in full bloom and good health, whatever fields it grows
  garden.reset();
  garden.set({ seed: OWNER.seed, speciesId: OWNER.species, cloud: 0.15, rain: 0, autoClock: false, hour: showcaseHour(search) });
}
