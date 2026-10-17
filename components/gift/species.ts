// What the seed picker says about each flower, read from the plant model's own numbers (lib/sim SIM_SPECIES) and the
// renderer's packet copy (lib/plant/species), so the cards stay honest if the model is retuned. Each trait is a plain
// phrase a colleague can act on: how often it wants water, how it takes the afternoon sun, how it minds soggy soil,
// and when its petals open.
import { SIM_SPECIES, type SimSpecies } from "@/lib/sim";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

/** The order the server lists the seed packets in (lib/server/validate.ts SPECIES_IDS). */
export const SEED_ORDER: readonly SpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "tefiti", "jasmine"];

/**
 * Packet lines that promise something the model (v5) does not do: no flower heals faster, and every flower keeps its
 * own clock to bloom in about two weeks. These say only what the garden shows; the others are used as they are.
 */
const HONEST_TAGLINE: Partial<Record<SpeciesId, string>> = {
  sundrop: "Glows gold at night, like a little lamp in the bed.",
  magnolia: "Big, soft petals with a blush at the heart, and a gentle scent.",
};

export type TraitKind = "thirst" | "heat" | "wet" | "opens";

export interface Trait {
  kind: TraitKind;
  /** a short phrase for the card */
  short: string;
  /** the fuller phrase for the detail */
  long: string;
  /** how far from an average plant this trait sits (0 = ordinary), to pick the card's two words */
  weight: number;
}

export interface SeedPacket {
  id: SpeciesId;
  name: string;
  tagline: string;
  /** the model's honest line on how long the real plant takes */
  about: string;
  traits: Trait[];
  /** the card's one line: its two most telling traits */
  character: string;
  image: string;
}

/**
 * Water: p is how dry the root zone gets before the plant closes up, and deeper roots (Zrmax) hold more in reserve;
 * a plant that drops a forming bud in dry soil (budDrop) counts as thirstier.
 */
function thirst(sp: SimSpecies): Trait {
  const ease = sp.p + 2 * (sp.Zrmax - 0.085) - (sp.budDrop ? 0.03 : 0);
  if (ease < 0.37) return { kind: "thirst", short: "Drinks often", long: "Likes a drink whenever the soil dries", weight: 2 };
  if (ease >= 0.47) return { kind: "thirst", short: "Copes with dry days", long: "Copes calmly with a dry day", weight: 1 };
  return { kind: "thirst", short: "Steady drinker", long: "A steady drinker", weight: 0 };
}

/** Sun: Tcrit is the leaf temperature where heat scorch starts. */
function heat(sp: SimSpecies): Trait {
  if (sp.Tcrit >= 45) return { kind: "heat", short: "Sun lover", long: "Loves full sun", weight: 1.5 };
  if (sp.Tcrit <= 42) return { kind: "heat", short: "Likes afternoon shade", long: "Grateful for shade on hot afternoons", weight: 1.5 };
  return { kind: "heat", short: "Takes the heat", long: "Takes the afternoon heat well", weight: 0 };
}

/** Wet soil: tolW divides the damage a soaked root zone does, so below 1 it suffers a little sooner. */
function wet(sp: SimSpecies): Trait {
  return sp.tolW < 1
    ? { kind: "wet", short: "Minds soggy soil", long: "A little sensitive to soggy soil", weight: 0.5 }
    : { kind: "wet", short: "Patient in wet spells", long: "A little more patient with wet soil", weight: 0.25 };
}

/** Opening: openHod is the clock hour a mature bud starts to open, openDur the hours it takes. */
function opens(sp: SimSpecies): Trait {
  if (sp.openHod >= 12) return { kind: "opens", short: "Opens at dusk", long: "Opens its petals at dusk", weight: 3 };
  if (sp.openDur >= 6) return { kind: "opens", short: "Opens slowly at dawn", long: "Opens slowly through the morning", weight: 1 };
  return { kind: "opens", short: "Opens at dawn", long: "Opens with the morning light", weight: 0.1 };
}

function sentence(a: string, b: string): string {
  return `${a}, ${b.charAt(0).toLowerCase()}${b.slice(1)}`;
}

function packet(id: SpeciesId): SeedPacket {
  const sp = SIM_SPECIES[id];
  const traits = [thirst(sp), heat(sp), wet(sp), opens(sp)];
  const [first, second] = [...traits].sort((a, b) => b.weight - a.weight);
  return {
    id,
    name: SPECIES[id].name,
    tagline: HONEST_TAGLINE[id] ?? SPECIES[id].tagline,
    about: sp.truth,
    traits,
    character: sentence(first.short, second.short),
    image: `/gift/species/${id}.webp`,
  };
}

export const SEED_PACKETS: readonly SeedPacket[] = SEED_ORDER.map(packet);

export function packetOf(id: SpeciesId): SeedPacket {
  return SEED_PACKETS.find((p) => p.id === id) ?? SEED_PACKETS[0];
}
