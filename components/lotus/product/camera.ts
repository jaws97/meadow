// The courtyard's camera framings, shared by the concepts page (LotusCamera.tsx) and the garden's own camera rig
// (components/garden/CameraRig.tsx, for a lotus): pure numbers, so the rig's chunk takes nothing else of the lotus.
//
// The wide framing is the concepts page's signed-off pond framing: from the landing at the tank's front, on the garden
// camera's bearing, about 23 degrees on a wide screen and 45 on a tall phone, the water with the lotus and the koi in
// the lower two thirds, the steps and the lamps round it, the laterite wall with its niche across the top. The rig
// leans in from it toward what matters at each stage, never all the way (the courtyard stays in the picture):
// - the seed's jar on the front coping, while the seed is in it (and a little more once its seedling is ready to plant);
// - the seedling gliding from the jar to its pot (the planting moment drives the subject);
// - the flower, the bud or the pod, a little.
import * as THREE from "three";
import { framingFor } from "@/lib/garden/layout";
import { lerp, smoothstep } from "@/lib/plant/prng";
import { POND } from "@/components/lotus/pond";

/**
 * The courtyard's framing for each screen shape (aspect keys as the garden's): elevation, distance, the aim's height
 * over the water and how far behind the tank's centre it is. From the landing at the tank's front: the water with the
 * lotus and the koi filling the lower two thirds from the front coping up, the steps coming down to it either side and
 * behind, the lamps on the back step, and the laterite wall with its lit niche across the top of the frame. v2.1: nearer
 * and a little higher than the first courtyard renders (2.3 m at 22 degrees on 16:10), so the water is half the frame's
 * width and a 16 cm koi about 100 px long on a 1440 px screen, and no blank landing below the coping; on a phone (whose
 * narrow width the tank fills) from higher and nearer, the front coping at the frame's foot and the lit niche at its
 * head, so neither the wall nor the landing takes the frame from the water.
 */
const POND_FRAMINGS = [
  { aspect: 0.46, elevation: THREE.MathUtils.degToRad(45), distance: 3.0, lift: 0.3, back: 0.6, fov: 54 },
  { aspect: 0.72, elevation: THREE.MathUtils.degToRad(38), distance: 2.75, lift: 0.27, back: 0.52, fov: 52 },
  { aspect: 1.0, elevation: THREE.MathUtils.degToRad(27), distance: 2.35, lift: 0.2, back: 0.38, fov: 48 },
  { aspect: 1.33, elevation: THREE.MathUtils.degToRad(24), distance: 2.12, lift: 0.24, back: 0.42, fov: 47 },
  { aspect: 1.78, elevation: THREE.MathUtils.degToRad(23.5), distance: 2.02, lift: 0.24, back: 0.42, fov: 45.4 },
] as const;

export interface PondFraming {
  aspect: number;
  elevation: number;
  distance: number;
  lift: number;
  back: number;
  fov: number;
}

export function pondFraming(aspect: number): PondFraming {
  const k = POND_FRAMINGS;
  if (aspect <= k[0].aspect) return { ...k[0] };
  if (aspect >= k[k.length - 1].aspect) return { ...k[k.length - 1] };
  let i = 1;
  while (k[i].aspect < aspect) i++;
  const t = (aspect - k[i - 1].aspect) / (k[i].aspect - k[i - 1].aspect);
  return {
    aspect,
    elevation: lerp(k[i - 1].elevation, k[i].elevation, t),
    distance: lerp(k[i - 1].distance, k[i].distance, t),
    lift: lerp(k[i - 1].lift, k[i].lift, t),
    back: lerp(k[i - 1].back, k[i].back, t),
    fov: lerp(k[i - 1].fov, k[i].fov, t),
  };
}

/** What the rig leans toward: the jar, the gliding seedling, or the plant's head (world), and how far (0..1). */
export interface CourtSubject {
  kind: "jar" | "glide" | "plant" | "none";
  at: THREE.Vector3;
  /** 0 the wide framing .. 1 the subject's close framing */
  lean: number;
}

/** The rig's goal: where it aims, from how far and how high, the lens, and the bearing (the garden camera's). */
export interface CourtShot {
  target: THREE.Vector3;
  distance: number;
  elevation: number;
  azimuth: number;
  fov: number;
}

/** How far the rig leans from the wide framing toward each kind of subject's own shot (the rest is the courtyard). */
export const LEAN = { jar: 0.55, glide: 0.6, plant: 0.15, none: 0 } as const;

/**
 * Each subject's own shot, for a tall screen and a wide one: how far, how high, and where in the frame the subject sits
 * (a share of the lens's half-height below its middle). The jar from about a metre, looking down on it in the lower
 * third with the water and the pot beyond; the gliding seedling a little wider; the flower from about one and a half
 * metres on the wide framing's angle, held a touch low so the water and its leaves are under it.
 */
const SHOTS = {
  jar: { distance: [1.9, 1.15], elevation: [48, 33], below: 0.38 },
  glide: { distance: [2.1, 1.35], elevation: [46, 32], below: 0.2 },
  plant: { distance: [2.45, 1.55], elevation: [44, 22], below: 0.12 },
} as const;

const dir = (elevation: number, azimuth: number, out: THREE.Vector3) =>
  out.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));

/**
 * The courtyard's shot for a screen of `aspect` leaning toward `subject`, into `out`: the wide framing blended with
 * the subject's own shot (SHOTS), which is composed so the subject sits where it should in the frame (the camera placed
 * on the ray through it at that angle below the lens's middle, the aim then a shot's distance along the lens).
 */
export function courtShot(aspect: number, subject: CourtSubject, out: CourtShot): CourtShot {
  const p = pondFraming(aspect);
  const f = framingFor(aspect);
  const wide = smoothstep(0.46, 1.33, aspect);
  out.target.set(POND.cx + 0.02, POND.waterY + p.lift, POND.cz - p.back);
  out.distance = p.distance;
  out.elevation = p.elevation;
  out.azimuth = f.azimuth;
  out.fov = p.fov;
  const k = Math.min(1, Math.max(0, subject.lean));
  if (subject.kind === "none" || k <= 0) return out;
  const s = SHOTS[subject.kind];
  const distance = lerp(s.distance[0], s.distance[1], wide);
  const elevation = THREE.MathUtils.degToRad(lerp(s.elevation[0], s.elevation[1], wide));
  const below = s.below * THREE.MathUtils.degToRad(p.fov / 2);
  // the camera on the ray through the subject at `below` under the lens's middle, then the aim along the lens
  const camera = dir(elevation + below, f.azimuth, scratch).multiplyScalar(distance).add(subject.at);
  const aim = dir(elevation, f.azimuth, scratch2).multiplyScalar(-distance).add(camera);
  // across the screen it follows the subject only part of the way (less on a tall phone, whose width the tank fills),
  // so the jar at the coping's corner never pushes the pond out of the frame
  aim.x = lerp(out.target.x, aim.x, lerp(0.3, 0.75, wide));
  out.target.lerp(aim, k);
  out.distance = lerp(out.distance, distance, k);
  out.elevation = lerp(out.elevation, elevation, k);
  return out;
}

const scratch = new THREE.Vector3();
const scratch2 = new THREE.Vector3();

/** The seed's jar on its coping slab: the subject's point is this far over the glass's foot, and the glass this tall. */
const JAR_AT_OVER_FOOT = 0.05;
const JAR_H = 0.11;

/**
 * What the care layer's lens shift keeps in the open part of the view for the courtyard (CameraRig.shiftLens): from
 * the subject's top (the flower's height over the pot) down to the front coping, with the back coping kept clear of the
 * name pill. While the seed is in its jar the jar is the one thing to look at: the pot's crown down to the jar's foot,
 * centred above the care card when they fit and otherwise the jar's foot just clear of it, and only the jar's own top
 * kept clear of the name pill (a tall card on a phone may lift the back of the pond out of the frame, never the jar).
 * World points, into the three vectors.
 */
export function courtLensPoints(subject: CourtSubject, headY: number, head: THREE.Vector3, foot: THREE.Vector3, cap: THREE.Vector3) {
  if (subject.kind === "jar") {
    head.set(POND.cx + POND.potX, POND.copingY + 0.12, POND.potZ);
    foot.copy(subject.at).setY(subject.at.y - JAR_AT_OVER_FOOT);
    cap.copy(subject.at).setY(subject.at.y - JAR_AT_OVER_FOOT + JAR_H);
    return;
  }
  head.set(POND.cx + POND.potX, Math.min(POND.waterY + 0.4, Math.max(headY, POND.copingY + 0.12)), POND.potZ);
  foot.set(POND.cx, POND.copingY, POND.cz + POND.rz + 0.06);
  cap.set(POND.cx, POND.copingY, POND.cz - POND.rz - 0.06);
}
