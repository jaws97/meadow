// What the seed picker says about each flower, read from the plant model's own numbers (lib/sim SIM_SPECIES) and the
// renderer's packet copy (lib/plant/species), so the cards stay honest if the model is retuned. Each trait is a plain
// phrase a colleague can act on: how often it wants water, how it takes the afternoon sun, how it minds soggy soil,
// and when its petals open. The last seed, the lotus, grows in its own koi pond under its own model
// (lib/sim/pond.ts), so its packet says what that model does: where it lives, the jar it starts in, its koi, its
// three-day flower and its rain, with the honest line on whose care it needs most, and when.
import { POND_SPECIES, SIM_SPECIES, type SimSpecies } from "@/lib/sim";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

/** The order the server lists the seed packets in (lib/server/validate.ts SPECIES_IDS). */
export const SEED_ORDER: readonly SpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lily", "lotus"];

/**
 * Packet lines that promise something the model (v5) does not do: no flower heals faster, and every flower keeps its
 * own clock to bloom in about two weeks. These say only what the garden shows; the others are used as they are.
 */
const HONEST_TAGLINE: Partial<Record<SpeciesId, string>> = {
  sundrop: "Glows gold at night, like a little lamp in the bed.",
  magnolia: "Big, soft petals with a blush at the heart, and a gentle scent.",
};

export type TraitKind = "thirst" | "heat" | "wet" | "opens" | "jar" | "koi" | "rain";

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
  /** where it grows, when that is not the garden bed: the lotus's "In its own koi pond" */
  home?: string;
  /** an honest word on the care it asks for, shown with its nature (the lotus: it needs you most in its first days) */
  note?: string;
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

/**
 * The seed picker's honest line for the lotus (design 3.4): its first days are the ones that need you, the jar and then
 * the koi, and after that its pond carries it. The same words as lib/client/plant LOTUS_PICKER_LINE (species.test.ts
 * keeps them together), written out here so the gift flow does not load the care layer's module.
 */
export const LOTUS_NOTE = "A lotus in a pond needs you most in its first days; after that the pond looks after it, but the koi still want feeding.";

/**
 * The lotus grows in its own pond under its own model (lib/sim/pond.ts), so its traits are written from what that model
 * does rather than read from the soil numbers: it starts in a glass jar of water that only its owner freshens and
 * plants; its three young koi want a pinch at each visit (hungry koi eat a seedling's floating leaves, so it cannot
 * grow); its flower opens at dawn and closes by the afternoon on its first two days (POND_SPECIES openHod, closeHod);
 * and rain only ever tops its pond up (extra spills through the notch). The card's line leads with the lotus's
 * character: it needs you most at first, and it opens at dawn.
 */
function lotusPacket(): SeedPacket {
  const traits: Trait[] = [
    { kind: "jar", short: "Starts in a jar", long: "Starts in a glass jar of water", weight: 3 },
    { kind: "koi", short: "A pinch for the koi", long: "Tend its pond: a pinch for the koi at each visit", weight: 2 },
    { kind: "opens", short: "Opens at dawn", long: "Opens at dawn, closes by the afternoon", weight: 2.5 },
    { kind: "rain", short: "Rain only helps", long: "Rain only helps: it tops up the pond", weight: 1 },
  ];
  return {
    id: "lotus",
    name: SPECIES.lotus.name,
    tagline: SPECIES.lotus.tagline,
    about: POND_SPECIES.lotus.truth,
    traits,
    character: "Needs you most at first, opens at dawn",
    image: "/gift/species/lotus.webp",
    home: "In its own koi pond",
    note: LOTUS_NOTE,
  };
}

function packet(id: SpeciesId): SeedPacket {
  if (id === "lotus") return lotusPacket();
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
