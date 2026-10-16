"use client";
// The owner's watering can, standing on the close-mown lawn at the bed's
// front right with its spout toward the hero: one story prop that says the
// garden is tended, and the visible end of the watering the game asks of its
// owner. Placed on the front right rather than by the path on the left so it
// also stays in a phone's narrower portrait frame. One mesh, one draw; it
// casts a shadow on the richer tiers and takes the golden-hour rim.
import { useEffect, useMemo } from "react";
import { makeWateringCan, WATERING_CAN } from "@/lib/garden/dressing";
import type { Quality } from "@/lib/garden/store";
import { gardenMaterials } from "@/components/garden/garden/materials";

export function WateringCan({ quality }: { quality: Quality }) {
  const mats = gardenMaterials();
  const lite = quality === "lite";
  const geo = useMemo(() => makeWateringCan(lite ? 16 : 28), [lite]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh
      name="watering-can"
      geometry={geo}
      material={mats.can}
      position={[WATERING_CAN.x, 0, WATERING_CAN.z]}
      rotation-y={WATERING_CAN.yaw}
      scale={WATERING_CAN.scale}
      castShadow={!lite}
      receiveShadow
    />
  );
}
