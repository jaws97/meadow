"use client";
// The doe's visit to a colleague's garden, on the day lib/garden/visitor decided at page load: a chunk of its own,
// mounted by the scene (components/garden/Scene) outside the tier layers, so a tier being prepared out of sight never
// builds a second doe, and after the camera rig, so she sees the camera where it is drawn. While the loading veil is up
// she follows the garden as it settles: the tier, and her station for the screen's shape and the flower's height
// (components/deer/stations) as the owner's plant arrives. From the reveal she keeps them, so a tier swap never
// rebuilds her mid-stride (the governor holds while she is there anyway); if the screen then turns to a shape her
// station was not chosen for, she makes her way out. She looks toward the flower: its head, as the plant writes it.
import { useThree } from "@react-three/fiber";
import { useState } from "react";
import { Doe, type VisitHooks } from "@/components/deer/Doe";
import { headHeight, screenShape, stationFor, type DeerStation } from "@/components/deer/stations";
import { env } from "@/lib/garden/env";
import { underVeil, useQuality } from "@/lib/garden/quality";
import { useGarden } from "@/lib/garden/store";
import { deerPlan, markDeerSeen } from "@/lib/garden/visitor";

const HOOKS: VisitHooks = {
  shown() {
    // seen only if the page is in front of someone
    if (document.visibilityState === "visible") markDeerSeen();
  },
  gone() {},
};

export default function DeerVisit() {
  const [plan] = useState(deerPlan);
  const veiled = useQuality((s) => underVeil(s));
  const stored = useGarden((s) => s.quality);
  const head = useGarden((s) => headHeight(s.speciesId, s.growth));
  const aspect = useThree((st) => st.size.width / Math.max(1, st.size.height));
  const forced = plan?.visit.why === "forced";
  // the owner's ?deer=1 check always finds her, at the nearest composition when none is clean
  const fitting = stationFor(aspect, head) ?? (forced ? (aspect < 0.8 ? "portrait" : "back") : null);
  // follows the garden while the veil is up, then keeps what she was shown in
  const [tier, setTier] = useState(stored);
  const [kept, setKept] = useState<{ station: DeerStation | null; shape: string }>(() => ({ station: fitting, shape: screenShape(aspect) }));
  if (veiled && tier !== stored) setTier(stored);
  if (veiled && (kept.station !== fitting || kept.shape !== screenShape(aspect))) setKept({ station: fitting, shape: screenShape(aspect) });
  if (!plan) return null;
  // with no station she is still built (and compiled with the garden), and does not show
  const stay = kept.station !== null && screenShape(aspect) === kept.shape;
  return (
    <Doe act="visit" seed={plan.seed} lookAt={env.headPos} tier={tier} station={kept.station ?? "back"} stay={stay} visit={HOOKS} />
  );
}
