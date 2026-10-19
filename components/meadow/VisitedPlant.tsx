"use client";
/* eslint-disable react-hooks/immutability --
   Three.js objects (materials, uniforms, instanced meshes, the scene's fog) are created once and then written in
   the frame loop, which is how an R3F scene animates without re-rendering; the React Compiler lint reads those
   writes as mutating a hook's value. They are intentional and never feed back into what React renders. */
// The plant being visited, drawn in full: when a plant's card is open, its real procedural plant (flowerPlant.ts,
// from that person's own seed, species and the model's live numbers from GET /api/garden/[plot]) takes the place of
// its detail level, so the visit shows their plant exactly as their garden does: its leaves, its droop or its bloom.
// It stands exactly as its detail level does (the plot's own lean and angle, lod/bands.ts plotTurn, and the same breeze)
// and dissolves in over the light plant or picture the visitor just tapped, and back out when the card closes
// (lod/handover.ts), so the plant never cuts, turns or jumps from one drawing to the other while it is being watched. A seed is still a
// seed of light in its mound (the instanced one says it best), so a plant is drawn in full from the sprout on. Only
// one plant is ever drawn this way, and it is released once it has handed back.
//
// A lotus is drawn in full by VisitedLotus.tsx (its urli and its plant, from the friend's own pond numbers; in a river
// pocket its plant alone, standing on the river's water), which mounts it hidden and compiles it; it begins to dissolve
// in once that is done, and stands level on its plot (its urli holds water), turned to its plot's angle, as its detail
// levels stand (a pocket's: the angle nearest to facing its channel, lod/bands.ts spinOfPlot). In a pocket it dissolves
// in over its light plant or picture and over the pocket's floating leaves (Plants.tsx), which are its own.
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { loadFriend, meadowData, type FriendGarden } from "@/components/meadow/data";
import { applyPlantEnv, buildFlowerPlant, dissolving, petalGlow, warmDissolve, type BuiltPlant } from "@/components/meadow/flowerPlant";
import { plotAt } from "@/components/meadow/layout";
import { bandOf, lodKindOf, plotTurnOf, SPINS, spinOfPlot, standsUpright } from "@/components/meadow/lod/bands";
import { handover, HANDOVER_SECONDS } from "@/components/meadow/lod/handover";
import { lodStatus } from "@/components/meadow/lod/LodPlants";
import { FULL_PLANT_DISSOLVE } from "@/components/meadow/lod/materials";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import { useUi } from "@/components/meadow/ui";
import { VisitedLotus } from "@/components/meadow/VisitedLotus";
import type { Quality } from "@/lib/garden/store";

interface Shown {
  friend: FriendGarden;
  /** the flower's baked plant, or null for a lotus (drawn live by VisitedLotus) */
  plant: BuiltPlant | null;
  /** this drawing of the plant (a lotus drawn again is mounted afresh, and compiled before it shows) */
  id: number;
}

let drawings = 0;

/** Plants worth drawing in full: anything past the seed. */
const drawable = (f: FriendGarden) => f.stage !== "seed";

/** Petal qualities whose dissolving shaders have been compiled this session. */
const warmed = new Set<Quality>();

export function VisitedPlant({ quality }: { quality: Quality }) {
  const card = useUi((s) => s.card);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const [loaded, setLoaded] = useState<FriendGarden | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [drawn, setDrawn] = useState<Shown | null>(null);
  const friend = loaded && loaded.plot === card ? loaded : null;
  const swayAxis = useMemo(() => new THREE.Vector3(), []);
  const swayRef = useRef<THREE.Group>(null);
  // the lotus drawing that has compiled (VisitedLotus) and may dissolve in
  const [lotusReady, setLotusReady] = useState<Shown | null>(null);

  // the dissolving shaders, compiled once the plant environment they are lit by exists (behind the opening veil)
  useEffect(() => {
    if (warmed.has(quality)) return;
    let id = 0;
    const warm = () => {
      if (!meadow.plantEnv) {
        id = window.setTimeout(warm, 250);
        return;
      }
      warmed.add(quality);
      void warmDissolve(gl, camera, scene, quality, meadow.plantEnv);
    };
    id = window.setTimeout(warm, 0);
    return () => window.clearTimeout(id);
  }, [gl, camera, scene, quality]);

  // the friend's plant for the open card (the card loads the same, so this is usually a cache hit)
  useEffect(() => {
    if (card === null || card < 0) return;
    let live = true;
    void loadFriend(card).then((r) => {
      if (live && r.ok) setLoaded(r.value);
    });
    return () => {
      live = false;
    };
  }, [card]);

  // build it a moment after the tap (so the card answers first), compiled before it begins to dissolve in
  useEffect(() => {
    if (!friend || !drawable(friend)) return;
    let live = true;
    const id = window.setTimeout(() => {
      // a lotus is mounted, dressed and compiled by VisitedLotus itself
      if (friend.species === "lotus") {
        if (live) setShown({ friend, plant: null, id: ++drawings });
        return;
      }
      const v = friend.visual;
      const plant = dissolving(
        buildFlowerPlant(
          {
            speciesId: friend.species,
            seed: friend.seed,
            growth: v.growth,
            bloom: v.bloom,
            health: v.health,
            moisture: v.moisture,
            scorch: v.scorch,
            droop: v.droop,
            flower: v.flower,
            chlorosis: v.chlorosis,
          },
          { petals: quality, leaves: "lite" },
        ),
      );
      applyPlantEnv(plant, meadow.plantEnv, meadow.plantEnvStrength);
      void gl
        .compileAsync(plant.group, camera, scene)
        .catch(() => undefined)
        .then(() => {
          if (live) setShown({ friend, plant, id: ++drawings });
          else plant.dispose();
        });
    }, 60);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [friend, quality, gl, camera, scene]);

  // the plant for the open card, while the Meadow still has that plant there
  const ready = shown && shown.friend.plot === card && meadowData.get().byPlot.get(card)?.species === shown.friend.species ? shown : null;
  // one plant drawn at a time: the one for the open card, or the last one while it hands back to its detail level
  if (drawn === null && ready !== null) setDrawn(ready);

  // a built plant is released once it is neither the latest built nor still drawn, and all of them with the Meadow
  const owned = useRef(new Set<BuiltPlant>());
  useEffect(() => {
    const set = owned.current;
    const keep = new Set<BuiltPlant>();
    if (shown?.plant) keep.add(shown.plant);
    if (drawn?.plant) keep.add(drawn.plant);
    for (const p of set) {
      if (keep.has(p)) continue;
      p.dispose();
      set.delete(p);
    }
    for (const p of keep) set.add(p);
  }, [shown, drawn]);
  useEffect(() => {
    const set = owned.current;
    return () => {
      for (const p of set) p.dispose();
      set.clear();
    };
  }, []);

  // the cheap stand-ins (Plants.tsx) leave the plot to it while it is drawn (a lotus once it is ready to be seen)
  const lotusWaits = drawn !== null && drawn.plant === null && lotusReady !== drawn;
  useEffect(() => {
    if (!drawn || lotusWaits) return;
    const plot = drawn.friend.plot;
    meadow.detailPlot = plot;
    return () => {
      if (meadow.detailPlot === plot) meadow.detailPlot = -1;
      if (handover.plot === plot) {
        handover.plot = -1;
        handover.share = 0;
      }
    };
  }, [drawn, lotusWaits]);
  const onLotusReady = useCallback((s: Shown) => setLotusReady(s), []);

  useFrame((state, dt) => {
    if (!drawn) return;
    const plot = drawn.friend.plot;
    const coming = drawn === ready;
    // a lotus still compiling keeps its light plant or picture whole (and, its card closed meanwhile, simply goes)
    if (drawn.plant === null && lotusReady !== drawn) {
      if (!coming) setDrawn(null);
      return;
    }
    // the dissolve: in while its card is open, out once it closes; a plant still drawn the old cheap way (or resting)
    // has no detail level to dissolve against, and takes over at once as it always has
    const entry = meadowData.get().byPlot.get(plot);
    const at = plotAt(plot);
    const snap = !lodStatus.ready || !entry || bandOf(entry) === null;
    let share = handover.plot === plot ? handover.share : 0;
    if (process.env.NODE_ENV !== "production" && handover.pin !== null) share = handover.pin;
    else if (snap) share = coming ? 1 : 0;
    else share = coming ? Math.min(1, share + dt / HANDOVER_SECONDS) : Math.max(0, share - dt / HANDOVER_SECONDS);
    if (!coming && share <= 0) {
      handover.plot = -1;
      handover.share = 0;
      setDrawn(null);
      if (drawn.plant === null) setLotusReady(null);
      return;
    }
    handover.plot = plot;
    handover.share = share;
    FULL_PLANT_DISSOLVE.uLodShare.value = share;
    if (at) FULL_PLANT_DISSOLVE.uLodFoot.value.set(at.x, at.y, at.z);

    // the breeze rocks it about its foot round the axis along its row, as its light plant rocks (lod/materials.ts); a
    // pocket's lotus does not rock, nor its light plant: its floating leaves lie on the still river, a few millimetres
    // over it, and would dip under the water and out again (its standing leaves and flower sway on their own stalks)
    const sway = swayRef.current;
    const t = state.clock.elapsedTime;
    if (sway && at && at.kind === "pocket") sway.quaternion.identity();
    else if (sway && at) sway.quaternion.setFromAxisAngle(swayAxis.set(-Math.sin(at.a), 0, Math.cos(at.a)), 0.02 * Math.sin(t * 0.9 + plot) + 0.008 * Math.sin(t * 2.1));
    // (a lotus lights and glows itself, VisitedLotus)
    if (!drawn.plant) return;
    applyPlantEnv(drawn.plant, meadow.plantEnv, meadow.plantEnvStrength);
    const v = drawn.friend.visual;
    const ei = petalGlow(drawn.friend.species, meadow.night, v.health, v.bloom, t);
    for (const mat of drawn.plant.petalMats) mat.emissiveIntensity = ei;
    drawn.plant.budMat.emissiveIntensity = ei * 0.3;
  });

  if (!drawn) return null;
  const plot = plotAt(drawn.friend.plot);
  if (!plot) return null;
  // (the lean of a healthy plant: a poorly one droops by its own numbers here; a lotus stands level)
  const turn = plotTurnOf(plot, false, standsUpright(lodKindOf(drawn.friend.species, plot.kind === "pocket")));
  // a pocket's lotus: from its standing plant's angle to its pocket's frame, where its floating leaves are laid out
  const pocket = plot.kind === "pocket" ? { turn: (plot.yaw ?? 0) - SPINS[spinOfPlot(plot)] } : null;
  return (
    <group position={[plot.x, plot.y, plot.z]}>
      <group ref={swayRef}>
        <group quaternion={turn} scale={PLANT_SCALE}>
          {drawn.plant ? (
            <primitive object={drawn.plant.group} />
          ) : (
            <VisitedLotus key={drawn.id} friend={drawn.friend} tier={quality} pocket={pocket} onReady={() => onLotusReady(drawn)} />
          )}
        </group>
      </group>
    </group>
  );
}
